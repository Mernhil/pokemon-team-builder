import { loadDex } from '@/data/dex';
import { runThreatRow, type ThreatCache, type ThreatCell, type ThreatJob } from '@/domain/threats';
import type { WorkerRequest, WorkerResponse } from './threats.worker';

export interface ThreatRun {
  cancel: () => void;
}

interface Handlers {
  onRow: (index: number, cells: ThreatCell[]) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

/** Browsers without Web Workers fall back to the main thread. */
const CAN_USE_WORKER = typeof Worker !== 'undefined';

let worker: Worker | undefined;
/** Datasets already sent to the current worker. */
const seeded = new Set<string>();
let workerBroken = false;
let nextId = 1;
const running = new Map<number, Handlers>();

function getWorker(): Worker | undefined {
  if (workerBroken || !CAN_USE_WORKER) return undefined;
  if (worker) return worker;
  try {
    const w = new Worker(new URL('./threats.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      const h = running.get(msg.id);
      if (!h) return;
      if (msg.type === 'row') h.onRow(msg.index, msg.cells);
      else {
        running.delete(msg.id);
        if (msg.type === 'done') h.onDone();
        else h.onError(msg.message);
      }
    };
    // A worker that can't start (blocked, old browser): finish what is running on the main thread.
    w.onerror = () => {
      workerBroken = true;
      worker = undefined;
      w.terminate();
    };
    seeded.clear();
    worker = w;
    return w;
  } catch {
    workerBroken = true;
    return undefined;
  }
}

const mainCache: ThreatCache = new Map();

/** Same engine, on the main thread, one row per macrotask so the page stays responsive. */
function runOnMainThread(job: ThreatJob, h: Handlers): ThreatRun {
  let stopped = false;
  void (async () => {
    try {
      const dex = await loadDex(job.datasetId);
      for (let i = 0; i < job.threats.length; i++) {
        if (stopped) return;
        h.onRow(i, runThreatRow(dex, job, i, mainCache));
        await new Promise<void>((r) => setTimeout(r, 0));
      }
      if (!stopped) h.onDone();
    } catch (e) {
      if (!stopped) h.onError((e as Error).message);
    }
  })();
  return { cancel: () => void (stopped = true) };
}

/** Starts a job; rows arrive through `onRow` as they finish. Cancel when its inputs change. */
export function startThreatJob(job: ThreatJob, h: Handlers): ThreatRun {
  const w = getWorker();
  if (!w) return runOnMainThread(job, h);
  const id = nextId++;
  let cancelled = false;
  running.set(id, h);
  // The worker has no copy of the data: send it the dataset the page already loaded, once, then the job.
  loadDex(job.datasetId).then(
    (dex) => {
      if (cancelled) return;
      if (worker === w && !seeded.has(job.datasetId)) {
        w.postMessage({ type: 'init', datasetId: job.datasetId, data: dex.data } satisfies WorkerRequest);
        seeded.add(job.datasetId);
      }
      w.postMessage({ type: 'run', id, job } satisfies WorkerRequest);
    },
    (e: Error) => {
      if (running.delete(id)) h.onError(e.message);
    },
  );
  return {
    cancel: () => {
      cancelled = true;
      if (running.delete(id)) w.postMessage({ type: 'cancel', id } satisfies WorkerRequest);
    },
  };
}
