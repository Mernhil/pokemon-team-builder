import { useEffect, useState } from 'react';
import type { HistoryEntry } from '@/domain/metaHistory';

/** The history of one regulation's meta (oldest first), loaded on first use; undefined while loading. */
let cache: Promise<typeof import('./metaHistoryData')> | undefined;

export function useMetaHistory(regulationId: string | undefined): HistoryEntry[] | undefined {
  const [state, setState] = useState<{ id?: string; entries: HistoryEntry[] }>();
  useEffect(() => {
    let live = true;
    cache ??= import('./metaHistoryData');
    cache.then(
      (m) => live && setState({ id: regulationId, entries: (regulationId && m.BAKED_HISTORY.regulations[regulationId]?.entries) || [] }),
      () => {
        cache = undefined;
        if (live) setState({ id: regulationId, entries: [] });
      },
    );
    return () => {
      live = false;
    };
  }, [regulationId]);
  return state && state.id === regulationId ? state.entries : undefined;
}
