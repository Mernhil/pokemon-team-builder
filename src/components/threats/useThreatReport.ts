import { useEffect, useMemo, useState } from 'react';
import type { Dex } from '@/data/dex';
import { useMetaFor } from '@/data/useMeta';
import { REGULATION_MANIFEST } from '@/domain/formats';
import type { FieldConditions } from '@/domain/battle/conditions';
import { metaSets, type MetaSet } from '@/domain/metaSets';
import { pickSpeedSnapshot, type PickedSnapshot } from '@/domain/speedTiers';
import { summarize, type ThreatCell, type ThreatJob, type ThreatSummary } from '@/domain/threats';
import type { FormatRules, Team } from '@/domain/types';
import { startThreatJob } from '@/workers/threatClient';

const champRegIds = REGULATION_MANIFEST.regulations
  .filter((r) => r.game === 'champions')
  .sort((a, b) => b.start.localeCompare(a.start))
  .map((r) => r.id);

const NO_ROWS: (ThreatCell[] | undefined)[] = [];

export interface ThreatReport {
  /** Which regulation's numbers, or undefined when nothing is published (or still loading). */
  picked?: PickedSnapshot;
  /** The meta data is still loading. */
  loading: boolean;
  threats: MetaSet[];
  members: { slot: number; set: Team['slots'][number] & object }[];
  /** One entry per threat; undefined until that row has been calculated. */
  rows: (ThreatCell[] | undefined)[];
  done: boolean;
  error?: string;
  summaries: ThreatSummary[];
  job?: ThreatJob;
}

/**
 * Runs the Threat engine for a team in a Web Worker (see src/workers) and returns rows as they
 * arrive. Restarts, debounced, when the team, the field or the threat count changes.
 */
export function useThreatReport({ dex, format, team, count, field, delay = 150 }: { dex: Dex; format: FormatRules; team: Team; count: number; field: FieldConditions; delay?: number }): ThreatReport {
  const metaFor = useMetaFor();
  const champions = format.datasetId === 'champions';
  const picked = useMemo(
    () => (champions && metaFor ? pickSpeedSnapshot(format.regulationId, champRegIds, metaFor) : undefined),
    [champions, format.regulationId, metaFor],
  );
  const threats = useMemo(() => (picked ? metaSets(picked.snapshot, dex, format, count) : []), [picked, dex, format, count]);
  const members = useMemo(() => team.slots.flatMap((set, slot) => (set ? [{ slot, set }] : [])), [team.slots]);
  const job = useMemo<ThreatJob | undefined>(
    () =>
      threats.length && members.length
        ? {
            datasetId: format.datasetId,
            formatId: format.id,
            members,
            threats: threats.map((t) => ({ key: t.speciesId, speciesId: t.speciesId, usagePct: t.usagePct, set: t.set, megaMode: t.megaMode })),
            field,
          }
        : undefined,
    [threats, members, format.datasetId, format.id, field],
  );

  const [state, setState] = useState<{ job?: ThreatJob; rows: (ThreatCell[] | undefined)[]; done: boolean; error?: string }>({ rows: [], done: false });
  useEffect(() => {
    if (!job) return;
    // State from an earlier job is replaced by the first message of this one (never set synchronously here).
    const mine = (s: typeof state) => (s.job === job ? s : { job, rows: [] as (ThreatCell[] | undefined)[], done: false });
    let run: ReturnType<typeof startThreatJob> | undefined;
    const timer = setTimeout(() => {
      run = startThreatJob(job, {
        onRow: (i, cells) => setState((s0) => { const s = mine(s0); return { ...s, rows: Object.assign([...s.rows], { [i]: cells }) }; }),
        onDone: () => setState((s) => ({ ...mine(s), done: true })),
        onError: (message) => setState((s) => ({ ...mine(s), done: true, error: message })),
      });
    }, delay);
    return () => {
      clearTimeout(timer);
      run?.cancel();
    };
  }, [job, delay]);

  const current = state.job === job;
  const rows = current ? state.rows : NO_ROWS;
  const summaries = useMemo(() => (job && current && rows.length ? summarize(dex, job, rows as ThreatCell[][]) : []), [dex, job, current, rows]);
  return { picked, loading: champions && !metaFor, threats, members, rows, done: current ? state.done : !job, error: current ? state.error : undefined, summaries, job };
}
