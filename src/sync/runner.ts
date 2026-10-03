/**
 * Runs cloud sync in the browser: on start, when the window regains focus, a few seconds after the
 * teams or the match log change, and on demand ("Sync now"). Lazy-loaded, and only once sync is on.
 */
import { sanitizeMatch, sanitizeTeam } from '@/domain/sanitize';
import type { LocalDoc } from '@/domain/sync';
import type { PullResponse, PushDoc, PushResponse } from '@/domain/syncProtocol';
import type { Match } from '@/domain/matches';
import type { Team } from '@/domain/types';
import { useMatchStore } from '@/store/matchStore';
import { useTeamStore } from '@/store/teamStore';
import { noticeMessages, type UpdateNotice } from '@/domain/syncNotices';
import type { PushDoc as PushDocT, SharedResponse } from '@/domain/syncProtocol';
import { toast } from '@/store/toastStore';
import { syncOnce, type LocalStore, type SyncApi } from './engine';
import { syncSharedOnce, type SharedApi, type SharedLocal } from './shared';
import { useSharedStore } from './sharedStore';
import { syncAvailable, useSyncStore } from './syncStore';

/** True while sync itself is writing to the stores, so those writes don't trigger another run. */
let applying = false;

/** The real stores as the engine sees them. Incoming documents go through the same sanitisers as saved data. */
export const storeAdapter: LocalStore = {
  list: () => [
    // Teams from other people's folders are synced by shared.ts, never as my own documents.
    ...Object.values(useTeamStore.getState().teams).filter((t) => !t.shared).map((t): LocalDoc => ({ id: t.id, kind: 'team', updatedAt: t.updatedAt, json: t })),
    ...Object.values(useMatchStore.getState().matches).map((m): LocalDoc => ({ id: m.id, kind: 'match', updatedAt: m.updatedAt, json: m })),
  ],
  apply: ({ upserts, deletes }) => {
    const teams: Team[] = [];
    const matches: Match[] = [];
    for (const d of upserts) {
      if (d.kind === 'team') {
        const t = sanitizeTeam(d.json);
        if (t && t.id === d.id) teams.push({ ...t, updatedAt: d.updatedAt });
      } else {
        const m = sanitizeMatch(d.json);
        if (m && m.id === d.id) matches.push({ ...m, updatedAt: d.updatedAt });
      }
    }
    const del = (kind: 'team' | 'match') => deletes.filter((x) => x.kind === kind).map((x) => x.id);
    applying = true;
    try {
      if (teams.length || del('team').length) useTeamStore.getState().applySynced(teams, del('team'));
      if (matches.length || del('match').length) useMatchStore.getState().applySynced(matches, del('match'));
    } finally {
      applying = false;
    }
  },
};

class SyncHttpError extends Error {
  kind: 'signin' | 'setup' | 'offline' | 'other';
  constructor(message: string, kind: 'signin' | 'setup' | 'offline' | 'other') {
    super(message);
    this.kind = kind;
  }
}

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    // redirect: 'manual' so an expired Access session (a redirect to the login page) is noticed, not followed.
    res = await fetch(path, { method, credentials: 'same-origin', redirect: 'manual', headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new SyncHttpError("Couldn't reach the server. You may be offline.", 'offline');
  }
  if (res.type === 'opaqueredirect' || res.status === 401 || res.status === 403) throw new SyncHttpError('Your sign-in has expired. Reload the page to sign in again.', 'signin');
  if (res.status === 501) throw new SyncHttpError("Sync isn't set up on this deployment yet (see docs/SYNC.md).", 'setup');
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('json')) throw new SyncHttpError(res.status === 404 ? "This deployment has no sync service." : `Unexpected response (HTTP ${res.status}).`, 'setup');
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new SyncHttpError(json.error ?? `HTTP ${res.status}`, 'other');
  return json;
}

export const httpApi: SyncApi = {
  pull: (since) => request<PullResponse>('GET', `/api/sync?since=${since}`),
  push: (docs: PushDoc[]) => request<PushResponse>('POST', '/api/sync', { docs }),
};

export const sharedApi: SharedApi = {
  shared: () => request<SharedResponse>('GET', '/api/shared'),
  push: (owner, docs: PushDocT[]) => request<PushResponse>('POST', '/api/shared', { owner, docs }),
};

/** Shared teams in the real team store; every write is marked as sync's own so it doesn't trigger another run. */
export const sharedLocal: SharedLocal = {
  teams: () => Object.fromEntries(Object.entries(useTeamStore.getState().teams).filter(([, t]) => t.shared)),
  apply: (upserts, deletes) => {
    applying = true;
    try {
      useTeamStore.getState().applySynced(upserts, deletes);
    } finally {
      applying = false;
    }
  },
};

/** Everything other people shared with me. Returns the toasts to show. */
async function syncShared(deviceName: string): Promise<UpdateNotice[]> {
  const shared = useSharedStore.getState();
  const out = await syncSharedOnce({ local: sharedLocal, api: sharedApi, folders: shared.folders, save: (f) => useSharedStore.getState().setFolders(f), deviceName });
  useSharedStore.getState().setFriends(out.friends);
  for (const f of out.added) toast(`${f.ownerName || f.owner} shared a team with you (${f.role === 'edit' ? 'you can edit it' : 'view only'}). Find it under Teams → Shared with me.`);
  if (out.removed.length) toast(`${out.removed.length === 1 ? `“${out.removed[0]}”` : `${out.removed.length} shared teams`} ${out.removed.length === 1 ? 'is' : 'are'} no longer shared with you.`);
  return out.notices;
}

let running: Promise<void> | undefined;
let again = false;

/** Syncs now, or joins the run already in progress. Resolves when done; errors are recorded in the store, not thrown. */
export function syncNow(): Promise<void> {
  if (!syncAvailable()) return Promise.resolve();
  if (running) return running;
  const store = useSyncStore.getState();
  store.begin();
  running = (async () => {
    try {
      const { cursor, known, deviceName } = useSyncStore.getState();
      const { stats } = await syncOnce({ store: storeAdapter, api: httpApi, state: { cursor, known }, save: (s) => useSyncStore.getState().saveState(s), deviceName });
      // A teammate editing one of my shared teams comes back through my own documents, marked with who did it.
      const notices: UpdateNotice[] = stats.received
        .filter((d) => d.kind === 'team' && d.by && !d.deleted && d.json)
        .map((d) => ({ teamId: d.id, teamName: (d.json as { name: string }).name, who: d.by!, updatedAt: d.updatedAt }));
      try {
        notices.push(...(await syncShared(deviceName)));
      } catch (e) {
        // Sharing is an extra: a failure here must not hide that my own sync worked.
        useSharedStore.getState().setError(e instanceof Error ? e.message : String(e));
      }
      const now = Date.now();
      for (const m of noticeMessages(notices, now)) toast(m);
      useSyncStore.getState().succeed(stats);
    } catch (e) {
      useSyncStore.getState().fail(e instanceof Error ? e.message : String(e));
    } finally {
      running = undefined;
      if (again) {
        again = false;
        void syncNow();
      }
    }
  })();
  return running;
}

let stopAuto: (() => void) | undefined;

/** Starts the automatic triggers; returns a function that stops them. Safe to call twice. */
export function startAutoSync(): () => void {
  stopAuto?.();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const soon = () => {
    if (applying) return;
    // Changed while a run is going: that run may have missed it, so go once more when it ends.
    if (running) {
      again = true;
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(() => void syncNow(), 5000);
  };
  const onFocus = () => void syncNow();
  const onVisible = () => document.visibilityState === 'visible' && void syncNow();
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onVisible);
  const unsubTeams = useTeamStore.subscribe((s, prev) => s.teams !== prev.teams && soon());
  const unsubMatches = useMatchStore.subscribe((s, prev) => s.matches !== prev.matches && soon());
  void syncNow();
  stopAuto = () => {
    clearTimeout(timer);
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onVisible);
    unsubTeams();
    unsubMatches();
    stopAuto = undefined;
  };
  return stopAuto;
}
