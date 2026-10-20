/**
 * Runs cloud sync in the browser: on start, when the window regains focus, a few seconds after the
 * teams or the match log change, when the connection comes back, every 3 minutes while visible, and on demand ("Sync now").
 * When the app goes to the background with unsent edits it sends them at once (a keepalive push), because a phone
 * freezes timers and may never run the 5-second debounce. A run that hangs (a suspended request) is abandoned after
 * a timeout or when the app comes back to the front. Lazy-loaded, and only once sync is on.
 */
import { sanitizeMatch, sanitizeTeam } from '@/domain/sanitize';
import { localChanges, type LocalDoc } from '@/domain/sync';
import type { PullResponse, PushDoc, PushResponse } from '@/domain/syncProtocol';
import type { Match } from '@/domain/matches';
import type { Team } from '@/domain/types';
import { useMatchStore } from '@/store/matchStore';
import { useTeamStore } from '@/store/teamStore';
import { whileApplying, isApplying } from './applying';
import { KEEPALIVE_MAX_BYTES, RunAbandoned, syncOnce, type LocalStore, type SyncApi } from './engine';
import { REQUEST_TIMEOUT_MS, SyncHttpError, request } from './http';
import { PERIODIC_MS, createRetrier, type RunResult } from './retry';
import { createRunController } from './runControl';
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

/** The sync API over HTTP; a run's requests are aborted when it is abandoned. */
export const makeHttpApi = (signal?: AbortSignal): SyncApi => ({
  pull: (since) => request<PullResponse>('GET', `/api/sync?since=${since}`, undefined, { signal }),
  push: (docs: PushDoc[], opts) => request<PushResponse>('POST', '/api/sync', { docs }, { signal, keepalive: opts?.keepalive }),
});
export const httpApi: SyncApi = makeHttpApi();

/** How many documents differ from what the server last confirmed (edited, new or deleted here). */
export const pendingChanges = (): number => localChanges(storeAdapter.list(), useSyncStore.getState().known, Date.now()).length;

/** A run older than this is dropped when a new one is wanted, whatever the individual requests are doing. */
export const MAX_RUN_MS = 90_000;

let again = false;
/** When the background flush that is running started (visibilitychange and pagehide both fire: the second must not cancel the first). */
let flushStartedAt = 0;
/** The next run is the background flush (read once, as the run starts). */
let nextFlush = false;

const ABANDONED: RunResult = { ok: true };

/** One run. Errors are recorded in the store, not thrown; an abandoned run writes nothing and says nothing. */
const controller = createRunController<RunResult>({
  maxAgeMs: MAX_RUN_MS,
  abandoned: ABANDONED,
  execute: async ({ signal, isCurrent }) => {
    if (!syncAvailable()) return { ok: true };
    const flush = nextFlush;
    nextFlush = false;
    const store = useSyncStore.getState();
    store.begin();
    try {
      const { cursor, known, deviceName } = store;
      const { stats } = await syncOnce({
        store: storeAdapter,
        api: makeHttpApi(signal),
        state: { cursor, known },
        save: (s) => isCurrent() && useSyncStore.getState().saveState(s),
        deviceName,
        isCurrent,
        flush: flush ? { maxBytes: KEEPALIVE_MAX_BYTES } : undefined,
      });
      // What others shared with me comes after my own documents, so a failure there doesn't hide this run's result.
      if (!flush) await syncSharedWithNotices(deviceName, isCurrent);
      if (!isCurrent()) return ABANDONED;
      // Unsent edits are only forgotten once the server confirmed them (a flush may have fitted only some).
      if (flush) useSyncStore.getState().endFlush(pendingChanges() > 0);
      else useSyncStore.getState().succeed(stats, pendingChanges() > 0);
      return { ok: true };
    } catch (e) {
      if (e instanceof RunAbandoned || !isCurrent()) return ABANDONED;
      const kind = e instanceof SyncHttpError ? e.kind : 'other';
      useSyncStore.getState().fail(e instanceof Error ? e.message : String(e), kind, e instanceof SyncHttpError ? e.status : undefined);
      return { ok: false, kind };
    } finally {
      if (isCurrent() && again) {
        again = false;
        // After this run is over (it is still "current" until its promise settles).
        setTimeout(() => void syncNow(), 0);
      }
    }
  },
});

/** Retries a failed run after 10 s, 30 s and 2 min, unless the sign-in expired or sync isn't set up (src/sync/retry.ts). */
const retrier = createRetrier({ run: () => controller.start() });

/** Syncs now (or joins the run in progress) and restarts the retry schedule. Resolves when done. */
export const syncNow = (): Promise<void> => retrier.trigger();

let stopAuto: (() => void) | undefined;

/** Starts the automatic triggers; returns a function that stops them. Safe to call twice. */
export function startAutoSync(): () => void {
  stopAuto?.();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const soon = () => {
    if (isApplying()) return;
    // Persisted at once, so an edit made just before the app is killed is still known to be unsent next start.
    if (!useSyncStore.getState().dirty) useSyncStore.getState().setDirty(true);
    // Changed while a run is going: that run may have missed it, so go once more when it ends.
    if (controller.running()) {
      again = true;
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(() => void syncNow(), 5000);
  };
  /** The app comes (back) to the front: a run that has hung since before it was suspended is replaced. */
  const foreground = () => {
    controller.abandonOlderThan(REQUEST_TIMEOUT_MS);
    void syncNow();
  };
  /** The app is going to the background: send unsent edits now, while the page can still make a request. */
  const flush = () => {
    if (!syncAvailable() || !useSyncStore.getState().enabled) return;
    if (!useSyncStore.getState().dirty && pendingChanges() === 0) return;
    if (controller.running() && Date.now() - flushStartedAt < REQUEST_TIMEOUT_MS) return;
    clearTimeout(timer);
    retrier.cancel();
    controller.abandon();
    nextFlush = true;
    flushStartedAt = Date.now();
    void controller.start();
  };
  const onFocus = () => foreground();
  const onVisibility = () => (document.visibilityState === 'visible' ? foreground() : flush());
  // The connection is back: no need to wait for the next retry.
  const onOnline = () => foreground();
  // A phone app stays open for days; changes made on another device arrive without having to leave and return.
  const tick = setInterval(() => document.visibilityState === 'visible' && void syncNow(), PERIODIC_MS);
  window.addEventListener('focus', onFocus);
  window.addEventListener('online', onOnline);
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', onVisibility);
  const unsubTeams = useTeamStore.subscribe((s, prev) => s.teams !== prev.teams && soon());
  const unsubMatches = useMatchStore.subscribe((s, prev) => s.matches !== prev.matches && soon());
  void syncNow();
  stopAuto = () => {
    clearTimeout(timer);
    clearInterval(tick);
    retrier.cancel();
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('pagehide', flush);
    document.removeEventListener('visibilitychange', onVisibility);
    unsubTeams();
    unsubMatches();
    stopAuto = undefined;
  };
  return stopAuto;
}
