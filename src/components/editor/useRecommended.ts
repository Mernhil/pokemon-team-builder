import { useMemo } from 'react';
import type { Dex } from '@/data/dex';
import { useMetaFor } from '@/data/useMeta';
import { REGULATION_MANIFEST } from '@/domain/formats';
import { recommendFor, type Recommendation } from '@/domain/recommend';
import { pickSpeedSnapshot } from '@/domain/speedTiers';
import type { FormatRules } from '@/domain/types';

const champRegIds = REGULATION_MANIFEST.regulations
  .filter((r) => r.game === 'champions')
  .sort((a, b) => b.start.localeCompare(a.start))
  .map((r) => r.id);

/**
 * What the meta data recommends for a species: only Champions has usage data. `reg` names the
 * regulation the numbers come from (the newest published one when the format's own has none yet).
 */
export function useRecommended(dex: Dex, format: FormatRules, speciesId: string | undefined): { loading: boolean; rec?: Recommendation; reg?: string } {
  const metaFor = useMetaFor();
  const champions = format.datasetId === 'champions';
  return useMemo(() => {
    if (!champions || !speciesId) return { loading: false };
    if (!metaFor) return { loading: true };
    const picked = pickSpeedSnapshot(format.regulationId, champRegIds, metaFor);
    if (!picked) return { loading: false };
    const rec = recommendFor(picked.snapshot, speciesId, dex, format);
    return { loading: false, rec, reg: REGULATION_MANIFEST.regulations.find((r) => r.id === picked.regulationId)?.shortName };
  }, [champions, speciesId, metaFor, dex, format]);
}
