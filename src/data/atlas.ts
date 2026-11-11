import { useCallback, useEffect, useState } from 'react';
import type { AtlasFile } from '@/domain/atlas';

/**
 * Lazy loader for a game's atlas: src/data/generated/atlas-<game>.json (`npm run atlas`). One chunk
 * per game, fetched on first use.
 */
const atlasFiles = import.meta.glob('./generated/atlas-*.json');

const cache = new Map<string, Promise<AtlasFile>>();
function loadAtlas(game: string): Promise<AtlasFile> {
  let p = cache.get(game);
  if (!p) {
    p = (atlasFiles[`./generated/atlas-${game}.json`]?.() ?? Promise.reject(new Error(`No atlas for ${game}`))).then((m) => (m as { default: AtlasFile }).default);
    p.catch(() => cache.delete(game));
    cache.set(game, p);
  }
  return p;
}

/** The atlas of a game; null while loading, `false` when it failed to load (`retry` tries again: the failed load is not cached). */
export function useAtlasLoad(game: string): { file: AtlasFile | null | false; retry: () => void } {
  const [state, setState] = useState<{ game: string; file: AtlasFile | false } | null>(null);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    let alive = true;
    loadAtlas(game).then(
      (file) => alive && setState({ game, file }),
      () => alive && setState({ game, file: false }),
    );
    return () => {
      alive = false;
    };
  }, [game, tries]);
  const retry = useCallback(() => {
    setState(null);
    setTries((n) => n + 1);
  }, []);
  return { file: state && state.game === game ? state.file : null, retry };
}

export function useAtlas(game: string): AtlasFile | null | false {
  return useAtlasLoad(game).file;
}
