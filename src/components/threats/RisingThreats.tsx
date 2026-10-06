import { useMemo } from 'react';
import { TrendingUp } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { useMetaHistory } from '@/data/useMetaHistory';
import { computeTrends, risingThreats } from '@/domain/metaHistory';
import type { ThreatCell } from '@/domain/threats';
import type { FormatRules } from '@/domain/types';
import { Sprite } from '../ui/Sprite';
import { Notice } from '../ui/primitives';

/** "Rising threats": Pokémon climbing the in-game ranking (over 7 days) that come off better against several of your team. */
export function RisingThreats({ dex, format, regulationId, threatIds, rows }: { dex: Dex; format: FormatRules; regulationId?: string; threatIds: string[]; rows: (ThreatCell[] | undefined)[] }) {
  const history = useMetaHistory(regulationId);
  const hits = useMemo(() => {
    if (!history) return [];
    return risingThreats(computeTrends(history, 7), threatIds, rows.map((r) => r?.map((c) => c.verdict)));
  }, [history, threatIds, rows]);
  if (!hits.length) return null;
  return (
    <Notice tone="accent" icon={TrendingUp} title="Rising threats">
      <ul className="mt-1 space-y-1">
        {hits.slice(0, 4).map((h) => {
          const sp = dex.species(h.speciesId);
          return (
            <li key={h.speciesId} className="flex flex-wrap items-center gap-2">
              <Sprite speciesId={h.speciesId} name={sp?.name} types={sp?.types} set={format.spriteSet} size={28} />
              <b>{sp?.name ?? h.speciesId}</b> {h.text}, and it beats {h.beats} of your Pokémon.
            </li>
          );
        })}
      </ul>
    </Notice>
  );
}
