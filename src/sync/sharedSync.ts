/**
 * Sync for what other people shared with me: their folders arrive as teams marked `shared` in the
 * team store, their match log as a read-only list. Edits I make to a folder shared with edit rights
 * go back to its owner through the same merge rule as my own teams; when both of us changed a team,
 * the version that loses is kept as a team of my own, so nothing is lost.
 */
import { sanitizeMatch, sanitizeTeam } from '@/domain/sanitize';
import { sharedNotices, type SharedChange, type SharedMatch } from '@/domain/sharing';
import { conflictLabel, type LocalDoc } from '@/domain/sync';
import type { PushDoc, PushResponse, SharedPullResponse } from '@/domain/syncProtocol';
import { cloneTeam } from '@/domain/team';
import type { Team } from '@/domain/types';
import { useTeamStore } from '@/store/teamStore';
import { toast } from '@/store/toastStore';
import { whileApplying } from './applying';
import { syncOnce, type LocalStore, type SyncApi } from './engine';
import { request } from './http';
import { useShareStore } from './shareStore';
import { loadShares } from './sharesApi';

type Owned = NonNullable<Team['shared']>;

/** The server's view of what is shared with me, as one sync run sees it. */
export interface SharedDeps {
  api?: { shares: () => Promise<unknown>; pull: () => Promise<SharedPullResponse>; push: (docs: (PushDoc & { owner: string })[]) => Promise<PushResponse> };
  deviceName: string;
  now?: () => number;
}

const httpApi: NonNullable<SharedDeps['api']> = {
  shares: loadShares,
  pull: () => request<SharedPullResponse>('GET', '/api/shared'),
  push: (docs) => request<PushResponse>('POST', '/api/shared', { docs }),
};

/** A team the loser of a conflict becomes: my own, top level, named after where it came from. */
export const keepAsMine = (loser: Team, _winner: Team, deviceName: string, now: number): Team => cloneTeam(loser, `${loser.name} (${conflictLabel(deviceName, now).replace(/^Conflict copy /, 'conflict copy ')})`);

export async function syncShared(deps: SharedDeps): Promise<{ changes: SharedChange[] }> {
  const api = deps.api ?? httpApi;
  const now = deps.now ?? Date.now;
  const teamStore = useTeamStore;
  const shareStore = useShareStore;

  // Nothing shared with me and no shared copies here: nothing to ask the server for.
  await api.shares();
  const hasCopies = Object.values(teamStore.getState().teams).some((t) => t.shared) || shareStore.getState().matches.length > 0;
  if (shareStore.getState().received.length === 0 && !hasCopies) return { changes: [] };

  const info = new Map<string, Owned>();
  let pulled: SharedPullResponse | undefined;

  const store: LocalStore = {
    list: () =>
      Object.values(teamStore.getState().teams)
        .filter((t) => t.shared)
        .map((t): LocalDoc => {
          info.set(t.id, t.shared!);
          const { shared: _shared, ...json } = t; // the server's version has no marker, so compare without it
          return { id: t.id, kind: 'team', updatedAt: t.updatedAt, json };
        }),
    apply: ({ upserts, deletes }) => {
      const teams: Team[] = [];
      for (const d of upserts) {
        const t = sanitizeTeam(d.json);
        if (!t || t.id !== d.id) continue;
        const owner = info.get(d.id);
        teams.push({ ...t, updatedAt: d.updatedAt, shared: owner }); // no owner: a conflict copy, which is mine
      }
      whileApplying(() => teamStore.getState().applySynced(teams, deletes.map((x) => x.id)));
    },
  };

  const engineApi: SyncApi = {
    pull: async () => {
      pulled = await api.pull();
      for (const d of pulled.docs) if (d.kind === 'team') info.set(d.id, { owner: d.owner, role: d.role });
      shareStore.getState().setNames(pulled.names);
      return { docs: pulled.docs.filter((d) => d.kind === 'team'), cursor: 0, more: false };
    },
    push: (docs) => {
      const withOwner = docs.flatMap((d) => {
        const o = info.get(d.id) ?? (d.json && typeof d.json === 'object' ? info.get((d.json as Team).groupId ?? '') : undefined);
        return o ? [{ ...d, owner: o.owner }] : [];
      });
      return withOwner.length ? api.push(withOwner) : Promise.resolve({ results: [] });
    },
  };

  const { stats } = await syncOnce({
    store,
    api: engineApi,
    state: { cursor: 0, known: shareStore.getState().known },
    save: (s) => shareStore.getState().saveKnown(s.known),
    deviceName: deps.deviceName,
    now,
    copyFor: keepAsMine,
  });

  // ---- Reconcile with what the server says is shared with me right now ----
  const docs = pulled?.docs ?? [];
  const live = new Map(docs.filter((d) => d.kind === 'team' && !d.deleted).map((d) => [d.id, d]));
  const stale: string[] = [];
  const retag: Team[] = [];
  for (const t of Object.values(teamStore.getState().teams)) {
    if (!t.shared) continue;
    const remote = live.get(t.id);
    if (!remote) stale.push(t.id); // no longer shared with me (or deleted by its owner)
    else if (remote.owner !== t.shared.owner || remote.role !== t.shared.role) retag.push({ ...t, shared: { owner: remote.owner, role: remote.role } });
  }
  if (stale.length || retag.length) whileApplying(() => teamStore.getState().applySynced(retag, stale));
  if (stale.length) {
    const known = { ...shareStore.getState().known };
    for (const id of stale) delete known[`team:${id}`];
    shareStore.getState().saveKnown(known);
  }

  // Their match log: a read-only copy, replaced whole.
  const matches: SharedMatch[] = [];
  for (const d of docs) {
    if (d.kind !== 'match' || d.deleted) continue;
    const m = sanitizeMatch(d.json);
    if (m && m.id === d.id) matches.push({ ...m, updatedAt: d.updatedAt, owner: d.owner });
  }
  matches.sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt);
  shareStore.getState().setMatches(matches);

  // "<name> updated '<team>' 2 h ago"
  const teams = teamStore.getState().teams;
  const changes: SharedChange[] = stats.changed
    .filter((c) => c.kind === 'team' && info.has(c.id) && teams[c.id])
    .map((c) => ({ kind: 'team', name: teams[c.id].name, owner: info.get(c.id)!.owner, updatedAt: c.updatedAt, existed: c.existed }));
  return { changes };
}

/** Runs sharing sync and announces what the other person changed. */
export async function syncSharedWithNotices(deviceName: string): Promise<void> {
  const { changes } = await syncShared({ deviceName });
  for (const line of sharedNotices(changes, useShareStore.getState().names, Date.now())) toast(line);
}
