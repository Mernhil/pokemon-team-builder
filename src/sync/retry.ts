import type { SyncErrorKind } from './http';

/** After a network failure, try again after these waits, then leave it to the next trigger (focus, online, the 3-minute tick). */
export const RETRY_DELAYS_MS = [10_000, 30_000, 120_000] as const;
/** While the app is visible it syncs at least this often. */
export const PERIODIC_MS = 3 * 60_000;

/** A lost connection or a server hiccup may pass; a sign-in that expired or a deployment that isn't set up won't until someone acts. */
export const retriable = (kind: SyncErrorKind): boolean => kind === 'offline' || kind === 'other';

export type RunResult = { ok: true } | { ok: false; kind: SyncErrorKind };

/**
 * Runs `run` on demand and re-runs it with backoff while it fails in a way that may pass. A trigger (focus, online, a
 * change, "Sync now") cancels the pending retry and starts the schedule again from the first wait.
 */
export function createRetrier(deps: { run: () => Promise<RunResult>; setTimer?: (fn: () => void, ms: number) => unknown; clearTimer?: (t: unknown) => void; delays?: readonly number[] }) {
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  const delays = deps.delays ?? RETRY_DELAYS_MS;
  let timer: unknown;
  let attempt = 0;

  const cancel = () => {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
  };
  const go = async (): Promise<void> => {
    cancel();
    const r = await deps.run();
    if (r.ok || !retriable(r.kind) || attempt >= delays.length) {
      attempt = 0;
      return;
    }
    cancel();
    timer = setTimer(() => void go(), delays[attempt++]);
  };
  return {
    trigger: (): Promise<void> => {
      attempt = 0;
      return go();
    },
    cancel: () => {
      cancel();
      attempt = 0;
    },
  };
}
