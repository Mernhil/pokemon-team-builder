/// <reference lib="webworker" />
/**
 * Runs Threat report jobs off the main thread (6 members × up to 30 threats × 2 directions × 4
 * moves × formes is a lot of @smogon/calc calls). A thin wrapper around the pure engine, so results
 * are identical to running it on the main thread. Rows stream back as they finish; a newer job or a
 * cancel stops the current one between rows. Cells are memoised for the worker's lifetime.
 */
import { Dex } from '@/data/dex';
import type { Dataset } from '@/domain/types';
import { runThreatRow, type ThreatCache, type ThreatCell, type ThreatJob } from '@/domain/threats';

export type WorkerRequest = { type: 'init'; datasetId: string; data: Dataset } | { type: 'run'; id: number; job: ThreatJob } | { type: 'cancel'; id: number };
export type WorkerResponse =
  | { type: 'row'; id: number; index: number; cells: ThreatCell[] }
  | { type: 'done'; id: number }
  | { type: 'error'; id: number; message: string };

// The page sends the dataset it already loaded (one 'init' per dataset), so the worker doesn't bundle a second copy of it.
const dexes = new Map<string, Dex>();
const cache: ThreatCache = new Map();
const cancelled = new Set<number>();
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    dexes.set(msg.datasetId, new Dex(msg.data));
    return;
  }
  if (msg.type === 'cancel') {
    cancelled.add(msg.id);
    return;
  }
  const { id, job } = msg;
  try {
    const dex = dexes.get(job.datasetId);
    if (!dex) throw new Error(`The worker has no dataset "${job.datasetId}"`);
    for (let i = 0; i < job.threats.length; i++) {
      if (cancelled.has(id)) return;
      const cells = runThreatRow(dex, job, i, cache);
      (self as unknown as Worker).postMessage({ type: 'row', id, index: i, cells } satisfies WorkerResponse);
      await tick(); // lets a cancel message in
    }
    (self as unknown as Worker).postMessage({ type: 'done', id } satisfies WorkerResponse);
  } catch (err) {
    (self as unknown as Worker).postMessage({ type: 'error', id, message: (err as Error).message } satisfies WorkerResponse);
  }
};
