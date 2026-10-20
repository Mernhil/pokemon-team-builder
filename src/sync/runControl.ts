/**
 * Which sync run is the live one. A phone can suspend the app with a request in flight; that request may never
 * answer, and a run that is "still running" forever would make every later "Sync now", foregrounding and 3-minute
 * tick join the dead run. So a run older than a limit is abandoned: its requests are aborted, whoever awaits it is
 * released, and (through `isCurrent`) it can no longer write to the stores or save a cursor. Pure: no React, no
 * stores, no fetch, so it is tested with fake timers.
 */
export interface RunContext {
  /** Aborted when the run is abandoned: pass it to the requests. */
  signal: AbortSignal;
  /** False once the run was abandoned: check after every await, before writing anything. */
  isCurrent: () => boolean;
}

interface Run<R> {
  startedAt: number;
  controller: AbortController;
  abandon: () => void;
  promise: Promise<R>;
}

export function createRunController<R>(deps: {
  execute: (ctx: RunContext) => Promise<R>;
  /** What an abandoned run resolves to (for whoever was awaiting it). */
  abandoned: R;
  /** A run older than this is dropped when a new one is wanted. */
  maxAgeMs: number;
  now?: () => number;
}) {
  const now = deps.now ?? Date.now;
  let current: Run<R> | undefined;

  const abandonCurrent = () => {
    const run = current;
    if (!run) return false;
    current = undefined;
    run.abandon();
    return true;
  };

  return {
    /** The run in progress, or a new one (a run older than `maxAgeMs` is abandoned first). */
    start(): Promise<R> {
      if (current && now() - current.startedAt > deps.maxAgeMs) abandonCurrent();
      if (current) return current.promise;
      const controller = new AbortController();
      let release!: (r: R) => void;
      const dropped = new Promise<R>((resolve) => (release = resolve));
      const run: Run<R> = {
        startedAt: now(),
        controller,
        abandon: () => {
          controller.abort();
          release(deps.abandoned);
        },
        promise: undefined as unknown as Promise<R>,
      };
      const isCurrent = () => current === run;
      // Current before it starts: a run may check `isCurrent` before its first await.
      current = run;
      const executed = deps.execute({ signal: controller.signal, isCurrent }).finally(() => {
        if (current === run) current = undefined;
      });
      run.promise = Promise.race([executed, dropped]);
      return run.promise;
    },
    /** Abandons the run in progress when it has been going longer than `ms` (the app is back in front after a suspension). */
    abandonOlderThan(ms: number): boolean {
      return !!current && now() - current.startedAt > ms && abandonCurrent();
    },
    /** Abandons the run in progress whatever its age (a flush is about to replace it). */
    abandon: abandonCurrent,
    running: () => current !== undefined,
    /** How long the run in progress has been going, or undefined. */
    age: () => (current ? now() - current.startedAt : undefined),
  };
}
