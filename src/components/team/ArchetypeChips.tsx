import { useMemo } from 'react';
import type { Dex } from '@/data/dex';
import { useMetaFor } from '@/data/useMeta';
import { detectArchetypes } from '@/domain/archetypes';
import { metaSetLookup, monsOfTeam } from '@/domain/archetypeInputs';
import { getFormat } from '@/domain/formats';
import type { Team } from '@/domain/types';
import { Chip } from '../ui/primitives';

/** Fewer Pokémon than this say too little to call an archetype. */
const MIN_MEMBERS = 3;

/**
 * The archetypes a team plays (Rain, Trick Room, Hyper Offense…), worked out from its sets, as small chips;
 * the reasons are in the tooltip. Nothing when there is nothing confident to say, or when `dex` is not the
 * team's game (a saved team of another format).
 */
export function ArchetypeChips({ team, dex, max = 2 }: { team: Team; dex?: Dex; max?: number }) {
  const metaFor = useMetaFor();
  const format = getFormat(team.formatId);
  const tags = useMemo(() => {
    if (!dex || dex.data.id !== format.datasetId) return [];
    const mons = monsOfTeam(team);
    if (mons.length < MIN_MEMBERS) return [];
    const snapshot = format.regulationId ? metaFor?.(format.regulationId) : undefined;
    return detectArchetypes(mons, dex, format, metaSetLookup(snapshot, dex, format)).tags.slice(0, max);
  }, [team, dex, format, metaFor, max]);
  if (!tags.length) return null;
  return (
    <>
      {tags.map((t) => (
        <span key={t.tag} title={`${t.tag}: ${t.reasons.join('; ')}`}>
          <Chip tone="accent">{t.tag}</Chip>
        </span>
      ))}
    </>
  );
}
