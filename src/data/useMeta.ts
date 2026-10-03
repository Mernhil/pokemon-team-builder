import { useMemo, useSyncExternalStore } from 'react';
import type { MetaSnapshot } from '@/domain/meta';
import { useMetaStore } from '@/store/metaStore';

/**
 * The built-in meta (usage) data, loaded on first use rather than with the app: it's tens of KB of
 * JSON that only meta-backed views need. `./meta` must only ever be imported dynamically, here.
 */
type MetaModule = typeof import('./meta');

let loaded: MetaModule | undefined;
let loading: Promise<MetaModule> | undefined;
const listeners = new Set<() => void>();

/** Starts (or joins) loading the meta data. A failed load is retried by the next caller. */
export function loadMeta(): Promise<MetaModule> {
  loading ??= import('./meta').then(
    (m) => {
      loaded = m;
      for (const l of listeners) l();
      return m;
    },
    (e: unknown) => {
      loading = undefined;
      console.error('Couldn’t load the meta data:', e);
      throw e;
    },
  );
  return loading;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!loaded) loadMeta().catch(() => {});
  return () => listeners.delete(listener);
}

/** The best snapshot for a regulation (see `metaFor` in ./meta). */
export type MetaLookup = (regulationId: string) => MetaSnapshot | undefined;

/**
 * `metaFor`, with the player's refreshed copy applied; undefined while the data is still loading
 * (callers show a loading state then, not "no data").
 */
export function useMetaFor(): MetaLookup | undefined {
  const mod = useSyncExternalStore(subscribe, () => loaded, () => loaded);
  const refreshed = useMetaStore((s) => s.refreshed);
  return useMemo(() => (mod ? (id: string) => mod.metaFor(id, refreshed) : undefined), [mod, refreshed]);
}
