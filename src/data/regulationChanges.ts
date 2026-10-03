import { useEffect, useState } from 'react';
import type { RegulationChanges } from '@/domain/regulationImpact';

let loading: Promise<RegulationChanges> | undefined;

/** The species patches (before → after) and unconfirmed notes per regulation, built by `npm run data`. Loaded on first use. */
export function loadRegulationChanges(): Promise<RegulationChanges> {
  loading ??= import('./generated/regulation-changes.json').then((m) => m.default as unknown as RegulationChanges);
  loading.catch(() => (loading = undefined));
  return loading;
}

export function useRegulationChanges(): RegulationChanges | undefined {
  const [changes, setChanges] = useState<RegulationChanges>();
  useEffect(() => {
    let alive = true;
    loadRegulationChanges().then((c) => alive && setChanges(c), () => {});
    return () => {
      alive = false;
    };
  }, []);
  return changes;
}
