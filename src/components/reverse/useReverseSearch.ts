import { useEffect, useMemo, useState } from 'react';
import type { Dex } from '@/data/dex';
import { useMetaFor } from '@/data/useMeta';
import type { FieldConditions } from '@/domain/battle/conditions';
import { REGULATION_MANIFEST } from '@/domain/formats';
import { buildCandidates, evaluateCandidate, rankMatches, withRequiredMoves, type Candidate, type Condition, type Match } from '@/domain/reverseSearch';
import { useReverseBuilds } from '@/store/reverseBuildStore';
import { pickSpeedSnapshot, type PickedSnapshot } from '@/domain/speedTiers';
import type { FormatRules } from '@/domain/types';

const champRegIds = REGULATION_MANIFEST.regulations
  .filter((r) => r.game === 'champions')
  .sort((a, b) => b.start.localeCompare(a.start))
  .map((r) => r.id);

/** Candidates checked per slice before yielding to the browser, so typing and scrolling stay smooth. */
const SLICE = 12;

const knowing = (dex: Dex, list: Candidate[], knowsKey: string, regulationId: string | undefined) =>
  knowsKey ? list.flatMap((c) => withRequiredMoves(dex, c, knowsKey.split(','), regulationId) ?? []) : list;

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
export function useReverseSearch({ dex, format, conditions, knows = [], field, delay = 200 }: { dex: Dex; format: FormatRules; conditions: Condition[]; /** Move ids every answer has to know. */ knows?: string[]; field: FieldConditions; delay?: number }): ReverseSearch {
  const metaFor = useMetaFor();
  const champions = format.datasetId === 'champions';
  const picked = useMemo(
    () => (champions && metaFor ? pickSpeedSnapshot(format.regulationId, champRegIds, metaFor) : undefined),
    [champions, format.regulationId, metaFor],
  );
  const loading = champions && !metaFor;
  const snapshot = picked?.snapshot;
  const overrides = useReverseBuilds((s) => s.overrides);
  const tryStones = useReverseBuilds((s) => s.tryStones);
  // The slow, sliced search covers the meta and default builds only, so editing one species' build never
  // restarts it; the (few) custom builds are calculated right away and replace their species' results.
  const everyone = useMemo(() => (loading ? [] : buildCandidates(dex, format, snapshot, { tryStones })), [dex, format, snapshot, tryStones, loading]);
  const customIds = useMemo(() => new Set(Object.keys(overrides)), [overrides]);
  const custom = useMemo(
    () => (loading || customIds.size === 0 ? [] : buildCandidates(dex, format, snapshot, { tryStones, overrides, only: customIds })),
    [dex, format, snapshot, tryStones, overrides, customIds, loading],
  );
  // Only Pokémon that can learn every required move, each built to know them.
  const knowsKey = knows.join(',');
  const candidates = useMemo(() => knowing(dex, everyone, knowsKey, format.regulationId), [dex, everyone, knowsKey, format.regulationId]);
  const customCandidates = useMemo(() => knowing(dex, custom, knowsKey, format.regulationId), [dex, custom, knowsKey, format.regulationId]);
  const job = useMemo(() => ((conditions.length || knowsKey) && candidates.length ? { conditions, field, candidates } : undefined), [conditions, knowsKey, field, candidates]);
  const customMatches = useMemo(
    () => (conditions.length || knowsKey ? customCandidates.flatMap((c) => evaluateCandidate(dex, c, conditions, field) ?? []) : []),
    [customCandidates, conditions, knowsKey, field, dex],
  );

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
  const all = useMemo(() => [...candidates.filter((c) => !customIds.has(c.speciesId)), ...customCandidates], [candidates, customCandidates, customIds]);
  const matches = useMemo(
    () => rankMatches([...(current ? state.matches : []).filter((m) => !customIds.has(m.candidate.speciesId)), ...customMatches]),
    [current, state.matches, customMatches, customIds],
  );
  return { picked, loading, candidates: all, matches, checked: current ? state.checked : 0, done: job ? current && state.done : true };
}
