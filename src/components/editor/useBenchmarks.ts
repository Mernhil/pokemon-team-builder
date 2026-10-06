import { useEffect, useMemo, useState } from 'react';
import type { Dex } from '@/data/dex';
import { useMetaFor } from '@/data/useMeta';
import type { BenchmarkResult } from '@/domain/benchmarkEval';
import { REGULATION_MANIFEST } from '@/domain/formats';
import type { MetaSnapshot } from '@/domain/meta';
import type { FormatRules, PokemonSet } from '@/domain/types';

type Eval = typeof import('@/domain/benchmarkEval');
let loaded: Eval | undefined;

const newestFirst = REGULATION_MANIFEST.regulations
  .filter((r) => r.game === 'champions')
  .sort((a, b) => b.start.localeCompare(a.start))
  .map((r) => r.id);

/**
 * Where each Pokémon's benchmarks stand (met / not met / can't check), for the sets of one format. The
 * checking needs the damage engine, so it loads the first time any set has a benchmark; until then (and
 * while the meta data loads) `ready` is false. The regulation's own usage data is used, else the newest published.
 */
export function useBenchmarkResults(dex: Dex, format: FormatRules, sets: readonly (PokemonSet | null | undefined)[]): { results: Map<string, BenchmarkResult[]>; ready: boolean } {
  const has = sets.some((s) => s?.benchmarks?.length);
  const [mod, setMod] = useState<Eval | undefined>(loaded);
  useEffect(() => {
    if (!has || mod) return;
    let alive = true;
    void import('@/domain/benchmarkEval').then((m) => {
      loaded = m;
      if (alive) setMod(m);
    });
    return () => {
      alive = false;
    };
  }, [has, mod]);
  const metaFor = useMetaFor();
  const champions = format.datasetId === 'champions';
  const snapshot = useMemo<MetaSnapshot | undefined>(() => {
    if (!champions || !metaFor) return undefined;
    const own = format.regulationId ? metaFor(format.regulationId) : undefined;
    if (own) return own;
    for (const id of newestFirst) {
      const s = metaFor(id);
      if (s) return s;
    }
    return undefined;
  }, [champions, metaFor, format.regulationId]);

  return useMemo(() => {
    const results = new Map<string, BenchmarkResult[]>();
    if (!has) return { results, ready: true };
    if (!mod || (champions && !metaFor)) return { results, ready: false };
    for (const s of sets) if (s?.benchmarks?.length) results.set(s.uid, mod.evaluateBenchmarks(dex, format, s, s.benchmarks, snapshot));
    return { results, ready: true };
  }, [has, mod, champions, metaFor, sets, dex, format, snapshot]);
}
