import { useEffect, useState } from 'react';
import { loadDex, type Dex } from './dex';

type DexState = { status: 'loading' } | { status: 'ready'; dex: Dex } | { status: 'error'; error: string };

const LOADING: DexState = { status: 'loading' };

/** Loads (and caches) the dataset for a format. Re-runs when the dataset id changes. */
export function useDex(datasetId: string): DexState {
  // The result is stored with the id it was loaded for, so a changed id reads as "loading" at once, without a reset in the effect.
  const [loaded, setLoaded] = useState<{ id: string; state: DexState }>();
  useEffect(() => {
    let alive = true;
    loadDex(datasetId).then(
      (dex) => alive && setLoaded({ id: datasetId, state: { status: 'ready', dex } }),
      (e: Error) => alive && setLoaded({ id: datasetId, state: { status: 'error', error: e.message } }),
    );
    return () => {
      alive = false;
    };
  }, [datasetId]);
  return loaded?.id === datasetId ? loaded.state : LOADING;
}
