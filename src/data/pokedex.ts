import { useEffect, useState } from 'react';
import type { LearnData, PokedexData } from '@/domain/pokedex';

/**
 * Lazy loaders for the Pokédex files (src/data/generated/pokedex-gen<N>.json from `npm run pokedex`,
 * gen<N>-learn.json from `npm run data`). Each generation is its own chunk, fetched on first use.
 */
const pokedexLoaders: Record<number, () => Promise<{ default: unknown }>> = {
  1: () => import('./generated/pokedex-gen1.json'),
  2: () => import('./generated/pokedex-gen2.json'),
  3: () => import('./generated/pokedex-gen3.json'),
  4: () => import('./generated/pokedex-gen4.json'),
  5: () => import('./generated/pokedex-gen5.json'),
  6: () => import('./generated/pokedex-gen6.json'),
  7: () => import('./generated/pokedex-gen7.json'),
  8: () => import('./generated/pokedex-gen8.json'),
  9: () => import('./generated/pokedex-gen9.json'),
};
const learnLoaders: Record<number, () => Promise<{ default: unknown }>> = {
  1: () => import('./generated/gen1-learn.json'),
  2: () => import('./generated/gen2-learn.json'),
  3: () => import('./generated/gen3-learn.json'),
  4: () => import('./generated/gen4-learn.json'),
  5: () => import('./generated/gen5-learn.json'),
  6: () => import('./generated/gen6-learn.json'),
  7: () => import('./generated/gen7-learn.json'),
  8: () => import('./generated/gen8-learn.json'),
  9: () => import('./generated/gen9-learn.json'),
};

const cache = new Map<string, Promise<unknown>>();
function load<T>(key: string, loader: () => Promise<{ default: unknown }>): Promise<T> {
  let p = cache.get(key);
  if (!p) {
    p = loader().then((m) => m.default);
    cache.set(key, p);
  }
  return p as Promise<T>;
}

export const loadPokedex = (gen: number) => load<PokedexData>(`dex${gen}`, pokedexLoaders[gen]);
export const loadLearnData = (gen: number) => load<LearnData>(`learn${gen}`, learnLoaders[gen]);

/** Pokédex text/encounters and learn methods for a generation; null while loading. */
export function usePokedexData(gen: number): { dex: PokedexData; learn: LearnData } | null {
  const [state, setState] = useState<{ gen: number; dex: PokedexData; learn: LearnData } | null>(null);
  useEffect(() => {
    let alive = true;
    Promise.all([loadPokedex(gen), loadLearnData(gen)]).then(([dex, learn]) => alive && setState({ gen, dex, learn }));
    return () => {
      alive = false;
    };
  }, [gen]);
  return state && state.gen === gen ? state : null;
}
