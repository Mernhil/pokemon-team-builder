import { useEffect, useMemo, useState } from 'react';
import type { Dex } from '@/data/dex';
import { useMetaFor } from '@/data/useMeta';
import type { FieldConditions } from '@/domain/battle/conditions';
import { REGULATION_MANIFEST } from '@/domain/formats';
import { buildCandidates, evaluateCandidate, rankMatches, type Candidate, type Condition, type Match } from '@/domain/reverseSearch';
import { pickSpeedSnapshot, type PickedSnapshot } from '@/domain/speedTiers';
import type { FormatRules } from '@/domain/types';

const champRegIds = REGULATION_MANIFEST.regulations
  .filter((r) => r.game === 'champions')
  .sort((a, b) => b.start.localeCompare(a.start))
  .map((r) => r.id);

/** Candidates checked per slice before yielding to the browser, so typing and scrolling stay smooth. */
const SLICE = 12;

export interface ReverseSearch {
  /** The meta numbers behind the "most-used set" builds, or undefined (not Champions, or none published). */
  picked?: PickedSnapshot;
  loading: boolean;
  candidates: Candidate[];
  matches: Match[];
  checked: number;
  done: boolean;
}

/**
 * Runs the reverse search in slices on the main thread (a few hundred cheap calcs) and returns the
 * ranked matches as they accumulate. Restarts, debounced, whenever the conditions or the field change.
 */
export function useReverseSearch({ dex, format, conditions, field, delay = 200 }: { dex: Dex; format: FormatRules; conditions: Condition[]; field: FieldConditions; delay?: number }): ReverseSearch {
  const metaFor = useMetaFor();
  const champions = format.datasetId === 'champions';
  const picked = useMemo(
    () => (champions && metaFor ? pickSpeedSnapshot(format.regulationId, champRegIds, metaFor) : undefined),
    [champions, format.regulationId, metaFor],
  );
  const loading = champions && !metaFor;
  const candidates = useMemo(() => (loading ? [] : buildCandidates(dex, format, picked?.snapshot)), [dex, format, picked, loading]);
  const job = useMemo(() => (conditions.length && candidates.length ? { conditions, field, candidates } : undefined), [conditions, field, candidates]);

  const [state, setState] = useState<{ job?: typeof job; matches: Match[]; checked: number; done: boolean }>({ matches: [], checked: 0, done: false });
  useEffect(() => {
    if (!job) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const found: Match[] = [];
    let next = 0;
    const slice = () => {
      if (cancelled) return;
      const end = Math.min(next + SLICE, job.candidates.length);
      for (; next < end; next++) {
        const m = evaluateCandidate(dex, job.candidates[next], job.conditions, job.field);
        if (m) found.push(m);
      }
      const done = next >= job.candidates.length;
      setState({ job, matches: rankMatches(found), checked: next, done });
      if (!done) timer = setTimeout(slice, 0);
    };
    timer = setTimeout(slice, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [dex, job, delay]);

  const current = !!job && state.job === job;
  return { picked, loading, candidates, matches: current ? state.matches : [], checked: current ? state.checked : 0, done: job ? current && state.done : true };
}
