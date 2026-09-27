import { useEffect, useState } from 'react';
import { loadDex, type Dex } from './dex';

type DexState = { status: 'loading' } | { status: 'ready'; dex: Dex } | { status: 'error'; error: string };

/** Loads (and caches) the dataset for a format. Re-runs when the dataset id changes. */
export function useDex(datasetId: string): DexState {
  const [state, setState] = useState<DexState>({ status: 'loading' });
  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    loadDex(datasetId).then(
      (dex) => alive && setState({ status: 'ready', dex }),
      (e: Error) => alive && setState({ status: 'error', error: e.message }),
    );
    return () => {
      alive = false;
    };
  }, [datasetId]);
  return state;
}
