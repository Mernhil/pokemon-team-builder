import { useEffect, useState } from 'react';
import type { AtlasFile } from '@/domain/atlas';

/**
 * Lazy loader for a game's atlas: src/data/generated/atlas-<game>.json (`npm run atlas`). One chunk
 * per game, fetched on first use.
 */
const atlasFiles = import.meta.glob('./generated/atlas-*.json');

const cache = new Map<string, Promise<AtlasFile>>();
export function loadAtlas(game: string): Promise<AtlasFile> {
  let p = cache.get(game);
  if (!p) {
    p = (atlasFiles[`./generated/atlas-${game}.json`]?.() ?? Promise.reject(new Error(`No atlas for ${game}`))).then((m) => (m as { default: AtlasFile }).default);
    p.catch(() => cache.delete(game));
    cache.set(game, p);
  }
  return p;
}

/** The atlas of a game; null while loading, `false` when it failed to load. */
export function useAtlas(game: string): AtlasFile | null | false {
  const [state, setState] = useState<{ game: string; file: AtlasFile | false } | null>(null);
  useEffect(() => {
    let alive = true;
    loadAtlas(game).then(
      (file) => alive && setState({ game, file }),
      () => alive && setState({ game, file: false }),
    );
    return () => {
      alive = false;
    };
  }, [game]);
  return state && state.game === game ? state.file : null;
}
