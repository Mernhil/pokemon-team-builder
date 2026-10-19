/**
 * Runs cloud sync in the browser: on start, when the window regains focus, a few seconds after the
 * teams or the match log change, when the connection comes back, every 3 minutes while visible, and on demand ("Sync now"). Lazy-loaded, and only once sync is on.
 */
import { sanitizeMatch, sanitizeTeam } from '@/domain/sanitize';
import type { LocalDoc } from '@/domain/sync';
import type { PullResponse, PushDoc, PushResponse } from '@/domain/syncProtocol';
import type { Match } from '@/domain/matches';
import type { Team } from '@/domain/types';
import { useMatchStore } from '@/store/matchStore';
import { useTeamStore } from '@/store/teamStore';
import { whileApplying, isApplying } from './applying';
import { syncOnce, type LocalStore, type SyncApi } from './engine';
import { SyncHttpError, request } from './http';
import { PERIODIC_MS, createRetrier, type RunResult } from './retry';
import { syncSharedWithNotices } from './sharedSync';
import { syncAvailable, useSyncStore } from './syncStore';

/** The real stores as the engine sees them. Incoming documents go through the same sanitisers as saved data. */
export const storeAdapter: LocalStore = {
  list: () => [
    // Folders other people shared with me are not mine to sync here (sharedSync.ts does those).
    ...Object.values(useTeamStore.getState().teams).filter((t) => !t.shared).map((t): LocalDoc => ({ id: t.id, kind: 'team', updatedAt: t.updatedAt, json: t })),
    ...Object.values(useMatchStore.getState().matches).map((m): LocalDoc => ({ id: m.id, kind: 'match', updatedAt: m.updatedAt, json: m })),
  ],
  apply: ({ upserts, deletes }) => {
    const teams: Team[] = [];
    const matches: Match[] = [];
    for (const d of upserts) {
      if (d.kind === 'team') {
        const t = sanitizeTeam(d.json);
        if (t && t.id === d.id) teams.push({ ...t, shared: undefined, updatedAt: d.updatedAt });
      } else {
        const m = sanitizeMatch(d.json);
        if (m && m.id === d.id) matches.push({ ...m, updatedAt: d.updatedAt });
      }
    }
    const del = (kind: 'team' | 'match') => deletes.filter((x) => x.kind === kind).map((x) => x.id);
    whileApplying(() => {
      if (teams.length || del('team').length) useTeamStore.getState().applySynced(teams, del('team'));
      if (matches.length || del('match').length) useMatchStore.getState().applySynced(matches, del('match'));
    });
  },
};

export const httpApi: SyncApi = {
  pull: (since) => request<PullResponse>('GET', `/api/sync?since=${since}`),
  push: (docs: PushDoc[]) => request<PushResponse>('POST', '/api/sync', { docs }),
};

let running: Promise<RunResult> | undefined;
let again = false;

/** One run, or the one already in progress. Errors are recorded in the store, not thrown. */
function runOnce(): Promise<RunResult> {
  if (!syncAvailable()) return Promise.resolve({ ok: true });
  if (running) return running;
  useSyncStore.getState().begin();
  running = (async (): Promise<RunResult> => {
    try {
      const { cursor, known, deviceName } = useSyncStore.getState();
      const { stats } = await syncOnce({ store: storeAdapter, api: httpApi, state: { cursor, known }, save: (s) => useSyncStore.getState().saveState(s), deviceName });
      // What others shared with me comes after my own documents, so a failure there doesn't hide this run's result.
      await syncSharedWithNotices(deviceName);
      useSyncStore.getState().succeed(stats);
      return { ok: true };
    } catch (e) {
      const kind = e instanceof SyncHttpError ? e.kind : 'other';
      useSyncStore.getState().fail(e instanceof Error ? e.message : String(e), kind, e instanceof SyncHttpError ? e.status : undefined);
      return { ok: false, kind };
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

/** Retries a failed run after 10 s, 30 s and 2 min, unless the sign-in expired or sync isn't set up (src/sync/retry.ts). */
const retrier = createRetrier({ run: runOnce });

/** Syncs now (or joins the run in progress) and restarts the retry schedule. Resolves when done. */
export const syncNow = (): Promise<void> => retrier.trigger();

let stopAuto: (() => void) | undefined;

/** Starts the automatic triggers; returns a function that stops them. Safe to call twice. */
export function startAutoSync(): () => void {
  stopAuto?.();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const soon = () => {
    if (isApplying()) return;
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
  // The connection is back: no need to wait for the next retry.
  const onOnline = () => void syncNow();
  // A phone app stays open for days; changes made on another device arrive without having to leave and return.
  const tick = setInterval(() => document.visibilityState === 'visible' && void syncNow(), PERIODIC_MS);
  window.addEventListener('focus', onFocus);
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);
  const unsubTeams = useTeamStore.subscribe((s, prev) => s.teams !== prev.teams && soon());
  const unsubMatches = useMatchStore.subscribe((s, prev) => s.matches !== prev.matches && soon());
  void syncNow();
  stopAuto = () => {
    clearTimeout(timer);
    clearInterval(tick);
    retrier.cancel();
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisible);
    unsubTeams();
    unsubMatches();
    stopAuto = undefined;
  };
  return stopAuto;
}
