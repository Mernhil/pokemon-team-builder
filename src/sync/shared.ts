/**
 * One run of "sync what other people shared with me": mirrors folders I can view, merges my edits to
 * folders I can edit (with the same engine and rules as my own documents), drops folders that are no
 * longer shared, and collects friends' match logs. Like engine.ts it knows nothing about React or fetch.
 */
import { reconcileViewer, folderKey, teamsOfFolder } from '@/domain/sharedSync';
import { sanitizeMatch, sanitizeTeam } from '@/domain/sanitize';
import type { LocalDoc } from '@/domain/sync';
import type { UpdateNotice } from '@/domain/syncNotices';
import type { Match } from '@/domain/matches';
import type { PushDoc, PushResponse, SharedResponse } from '@/domain/syncProtocol';
import type { SharedMark, Team } from '@/domain/types';
import { syncOnce, type LocalStore, type SyncApi } from './engine';
import type { SharedFolder, SharedMatches } from './sharedStore';

export interface SharedApi {
  shared(): Promise<SharedResponse>;
  push(owner: string, docs: PushDoc[]): Promise<PushResponse>;
}

/** The teams on this device that came from shared folders. */
export interface SharedLocal {
  teams(): Record<string, Team>;
  /** Teams already carry their mark; deletes are ids. */
  apply(upserts: Team[], deletes: string[]): void;
}

export interface SharedOutcome {
  folders: Record<string, SharedFolder>;
  friends: SharedMatches[];
  notices: UpdateNotice[];
  /** Folders that appeared for the first time. */
  added: SharedFolder[];
  /** Teams (top-level) that stopped being shared with me. */
  removed: string[];
  conflicts: number;
  pushed: number;
}

const markOf = (f: { owner: string; ownerName?: string; folderId: string; role: 'view' | 'edit' }): SharedMark => ({ owner: f.owner, ownerName: f.ownerName, folderId: f.folderId, role: f.role });
const sameMark = (a: SharedMark | undefined, b: SharedMark) => !!a && a.owner === b.owner && a.ownerName === b.ownerName && a.folderId === b.folderId && a.role === b.role;
const stripMark = (t: Team): Team => ({ ...t, shared: undefined });

export async function syncSharedOnce(deps: {
  local: SharedLocal;
  api: SharedApi;
  folders: Record<string, SharedFolder>;
  save?: (folders: Record<string, SharedFolder>) => void;
  deviceName: string;
  now?: () => number;
}): Promise<SharedOutcome> {
  const now = deps.now ?? Date.now;
  const first = await deps.api.shared();
  const you = new Set([first.you.email, first.you.displayName].filter(Boolean));
  const out: SharedOutcome = { folders: {}, friends: [], notices: [], added: [], removed: [], conflicts: 0, pushed: 0 };

  const upserts: Team[] = [];
  const deletes: string[] = [];
  const noteChange = (f: SharedFolder, id: string, name: string, updatedAt: number, by?: string) => {
    if (by && you.has(by)) return;
    out.notices.push({ teamId: id, teamName: name, who: by ?? f.ownerName ?? f.owner, updatedAt });
  };

  for (const r of first.folders) {
    const key = folderKey(r.owner, r.folderId);
    const prev = deps.folders[key];
    const mark = markOf(r);
    const entry: SharedFolder = { owner: r.owner, ownerName: r.ownerName, folderId: r.folderId, role: r.role, known: prev?.known ?? {} };
    if (!prev) out.added.push(entry);
    const here = () => teamsOfFolder(deps.local.teams(), r.owner, r.folderId);

    if (r.role === 'view') {
      const res = reconcileViewer(here().map((t): LocalDoc => ({ id: t.id, kind: 'team', updatedAt: t.updatedAt, json: t })), r.docs);
      for (const d of res.upserts) {
        const t = sanitizeTeam(d.json);
        if (t && t.id === d.id) upserts.push({ ...t, updatedAt: d.updatedAt, shared: mark });
      }
      deletes.push(...res.deletes.map((d) => d.id));
      entry.known = res.known;
      if (prev) for (const u of res.updated) noteChange(entry, u.id, u.name, u.updatedAt, u.by);
    } else {
      // Editor: the same merge as my own documents, against this folder only.
      let calls = 0;
      const api: SyncApi = {
        pull: async () => {
          const docs = calls++ === 0 ? r.docs : ((await deps.api.shared()).folders.find((x) => x.owner === r.owner && x.folderId === r.folderId)?.docs ?? []);
          return { docs, cursor: docs.reduce((m, d) => Math.max(m, d.seq), 0), more: false };
        },
        push: (docs) => deps.api.push(r.owner, docs),
      };
      const store: LocalStore = {
        list: () => here().map((t): LocalDoc => ({ id: t.id, kind: 'team', updatedAt: t.updatedAt, json: stripMark(t) })),
        apply: ({ upserts: ups, deletes: dels }) => {
          for (const d of ups) {
            const t = sanitizeTeam(d.json);
            if (t && t.id === d.id) upserts.push({ ...t, updatedAt: d.updatedAt, shared: mark });
          }
          deletes.push(...dels.map((d) => d.id));
          // The engine reads the store again on its next pass: keep it current.
          deps.local.apply(upserts.splice(0), deletes.splice(0));
        },
      };
      const { state, stats } = await syncOnce({ store, api, state: { cursor: 0, known: entry.known }, save: () => undefined, deviceName: deps.deviceName, now });
      entry.known = state.known;
      out.conflicts += stats.conflicts;
      out.pushed += stats.pushed;
      if (prev) for (const d of stats.received) if (d.kind === 'team' && !d.deleted && d.json) noteChange(entry, d.id, (d.json as Team).name, d.updatedAt, d.by);
    }
    // A changed owner name or role is stamped onto the teams already here.
    for (const t of here()) if (!sameMark(t.shared, mark) && !upserts.some((u) => u.id === t.id) && !deletes.includes(t.id)) upserts.push({ ...t, shared: mark });
    out.folders[key] = entry;
  }

  // Folders that are no longer shared with me: their teams go.
  for (const [key, f] of Object.entries(deps.folders)) {
    if (out.folders[key]) continue;
    for (const t of teamsOfFolder(deps.local.teams(), f.owner, f.folderId)) {
      deletes.push(t.id);
      if (!t.groupId) out.removed.push(t.name);
    }
  }
  // …and any team marked as shared that no folder claims (a leftover from an older state).
  const claimed = new Set(Object.keys(out.folders));
  for (const t of Object.values(deps.local.teams())) if (t.shared && !claimed.has(folderKey(t.shared.owner, t.shared.folderId)) && !deletes.includes(t.id)) deletes.push(t.id);

  if (upserts.length || deletes.length) deps.local.apply(upserts, deletes);
  deps.save?.(out.folders);

  out.friends = first.matches.map((m): SharedMatches => {
    const matches: Match[] = [];
    for (const d of m.docs) {
      if (d.deleted || d.json === undefined) continue;
      const x = sanitizeMatch(d.json);
      if (x && x.id === d.id) matches.push({ ...x, updatedAt: d.updatedAt });
    }
    return { owner: m.owner, name: m.ownerName, matches };
  });
  return out;
}
