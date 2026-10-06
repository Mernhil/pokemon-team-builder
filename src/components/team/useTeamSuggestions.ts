import { useEffect, useMemo, useState } from 'react';
import type { Dex } from '@/data/dex';
import { useMetaFor } from '@/data/useMeta';
import { defaultField } from '@/domain/battle/conditions';
import { REGULATION_MANIFEST } from '@/domain/formats';
import type { MetaSet } from '@/domain/metaSets';
import { pickSpeedSnapshot } from '@/domain/speedTiers';
import { TOP_N, applyThreatAnswers, problemThreats, shortlist, suggestCheap, threatJobFor, type ProblemThreat, type Suggestion } from '@/domain/teamSuggest';
import type { ThreatCell } from '@/domain/threats';
import type { FormatRules, Team } from '@/domain/types';
import { startThreatJob } from '@/workers/threatClient';
import { useThreatReport } from '../threats/useThreatReport';

const champRegIds = REGULATION_MANIFEST.regulations
  .filter((r) => r.game === 'champions')
  .sort((a, b) => b.start.localeCompare(a.start))
  .map((r) => r.id);

export interface TeamSuggestions {
  loading: boolean;
  /** Best first; the cheap ranking shows at once and refines as the threat answers arrive. */
  suggestions: Suggestion[];
  /** The threats the shortlist is checked against. */
  problems: ProblemThreat[];
  /** The threat checks have finished. */
  done: boolean;
  snapshotName?: string;
}

/**
 * Ranks teammates for a team: the four cheap components at once, then the threat component for a
 * shortlist, computed in the threat worker (never on the main thread's critical path), with the
 * list re-ranked as each threat's row arrives. Mount it only when the panel is open.
 */
export function useTeamSuggestions({ dex, format, team, includeAll }: { dex: Dex; format: FormatRules; team: Team; includeAll: boolean }): TeamSuggestions {
  const metaFor = useMetaFor();
  const picked = useMemo(
    () => (format.datasetId === 'champions' && metaFor ? pickSpeedSnapshot(format.regulationId, champRegIds, metaFor) : undefined),
    [format.datasetId, format.regulationId, metaFor],
  );
  const snapshot = picked?.snapshot;
  const cheap = useMemo(() => (metaFor ? suggestCheap({ dex, format, team, snapshot, includeAll }) : []), [metaFor, dex, format, team, snapshot, includeAll]);
  const list = useMemo(() => shortlist(cheap), [cheap]);

  // Which threats beat several of mine: the Threat report's rows for this team (already worker-backed).
  const field = useMemo(() => defaultField(), []);
  const report = useThreatReport({ dex, format, team, count: 20, field, delay: 300 });
  const problems = useMemo(() => (report.done ? problemThreats(report.threats.map((t) => t.speciesId), report.rows) : []), [report.done, report.threats, report.rows]);
  const problemSets = useMemo(() => problems.flatMap((p) => report.threats.filter((t): t is MetaSet => t.speciesId === p.speciesId)), [problems, report.threats]);
  const job = useMemo(() => threatJobFor(format, list, problemSets), [format, list, problemSets]);

  const [state, setState] = useState<{ job?: typeof job; rows: (ThreatCell[] | undefined)[]; done: boolean }>({ rows: [], done: false });
  useEffect(() => {
    if (!job) return;
    const mine = (s: typeof state) => (s.job === job ? s : { job, rows: [] as (ThreatCell[] | undefined)[], done: false });
    const run = startThreatJob(job, {
      onRow: (i, cells) => setState((s0) => { const s = mine(s0); return { ...s, rows: Object.assign([...s.rows], { [i]: cells }) }; }),
      onDone: () => setState((s) => ({ ...mine(s), done: true })),
      onError: () => setState((s) => ({ ...mine(s), done: true })),
    });
    return () => run.cancel();
  }, [job]);

  const current = state.job === job;
  const rows = current ? state.rows : [];
  const suggestions = useMemo(
    () => (job && rows.length ? applyThreatAnswers(dex, cheap, list, problems, rows) : cheap).slice(0, TOP_N),
    [dex, cheap, list, problems, rows, job],
  );
  const done = !!metaFor && report.done && (!job || (current && state.done));
  return { loading: !metaFor, suggestions, problems, done, snapshotName: snapshot?.source.name };
}
