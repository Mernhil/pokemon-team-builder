import { useEffect, useState } from 'react';
import type { AtlasFile } from '@/domain/atlas';
import { SIDE_LOADED_DATA, fetchGenerated } from './generated-loader';

/**
 * Lazy loader for a game's atlas: src/data/generated/atlas-<game>.json (`npm run atlas`). One chunk
 * per game, fetched on first use; the single-file build fetches it from data/ like the other files.
 */
// The mode check is written out here, not via SIDE_LOADED_DATA, so the single-file build drops the glob.
const atlasFiles = import.meta.env.MODE === 'singlefile' ? {} : import.meta.glob('./generated/atlas-*.json');

const cache = new Map<string, Promise<AtlasFile>>();
export function loadAtlas(game: string): Promise<AtlasFile> {
  let p = cache.get(game);
  if (!p) {
    p = SIDE_LOADED_DATA
      ? fetchGenerated<AtlasFile>(`atlas-${game}`)
      : (atlasFiles[`./generated/atlas-${game}.json`]?.() ?? Promise.reject(new Error(`No atlas for ${game}`))).then((m) => (m as { default: AtlasFile }).default);
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
