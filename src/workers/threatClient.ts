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
  running.set(id, h);
  w.postMessage({ type: 'run', id, job } satisfies WorkerRequest);
  return {
    cancel: () => {
      if (running.delete(id)) w.postMessage({ type: 'cancel', id } satisfies WorkerRequest);
    },
  };
}
