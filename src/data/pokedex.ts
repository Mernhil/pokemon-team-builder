import { useEffect, useState } from 'react';
import type { LearnData, PokedexData } from '@/domain/pokedex';

/**
 * Lazy loaders for a Pokédex book's files: src/data/generated/pokedex-<book>.json (`npm run pokedex`)
 * and <book>-learn.json (`npm run data`), where book is gen1…gen9, lgpe, bdsp, pla or za. Each file is
 * its own chunk, fetched on first use.
 */
const pokedexFiles = import.meta.glob('./generated/pokedex-*.json');
const learnFiles = import.meta.glob('./generated/*-learn.json');

const cache = new Map<string, Promise<unknown>>();
function load<T>(name: string, files: Record<string, () => Promise<unknown>>): Promise<T> {
  let p = cache.get(name);
  if (!p) {
    p = (files[`./generated/${name}.json`]?.() ?? Promise.reject(new Error(`No data file ${name}`))).then((m) => (m as { default: unknown }).default);
    p.catch(() => cache.delete(name));
    cache.set(name, p);
  }
  return p as Promise<T>;
}

export const loadPokedex = (book: string) => load<PokedexData>(`pokedex-${book}`, pokedexFiles);
export const loadLearnData = (book: string) => load<LearnData>(`${book}-learn`, learnFiles);

/** Pokédex text/encounters and learn methods for a book; null while loading. */
export function usePokedexData(book: string): { dex: PokedexData; learn: LearnData } | null {
  const [state, setState] = useState<{ book: string; dex: PokedexData; learn: LearnData } | null>(null);
  useEffect(() => {
    let alive = true;
    Promise.all([loadPokedex(book), loadLearnData(book)]).then(
      ([dex, learn]) => alive && setState({ book, dex, learn }),
      () => {
        /* stays "loading"; the failed file isn't cached, so reopening the book retries */
      },
    );
    return () => {
      alive = false;
    };
  }, [book]);
  return state && state.book === book ? state : null;
}
