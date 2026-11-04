import { useMemo } from 'react';
import type { Dex } from '@/data/dex';
import { useMetaFor } from '@/data/useMeta';
import { REGULATION_MANIFEST } from '@/domain/formats';
import { usageLabel } from '@/domain/meta';
import { metaSets, type MetaSet } from '@/domain/metaSets';
import { pickSpeedSnapshot } from '@/domain/speedTiers';
import { createSet } from '@/domain/team';
import { type FormatRules, type PokemonSet } from '@/domain/types';
import { useTeamStore } from '@/store/teamStore';

export const champRegIds = REGULATION_MANIFEST.regulations
  .filter((r) => r.game === 'champions')
  .sort((a, b) => b.start.localeCompare(a.start))
  .map((r) => r.id);

export const ROLLS: { value: number; label: string }[] = [
  { value: 16, label: 'every roll' },
  { value: 15, label: '15 of 16 rolls' },
  { value: 8, label: 'at least half the rolls' },
];

export type SourceKind = 'meta' | 'team' | 'any';
export type GoalKind = 'survive' | 'outspeed' | 'ko';

export interface Source {
  key: string;
  label: string;
  set: PokemonSet;
  /** The moves people run on it, most used first (meta sources only). */
  moveShare?: { id: string; pct: number }[];
}

/** Where the other Pokémon in a goal can come from: the most-used sets, my saved teams, or any species. */
export function useSources(dex: Dex, format: FormatRules, mine: PokemonSet) {
  const metaFor = useMetaFor();
  const teams = useTeamStore((s) => s.teams);
  return useMemo(() => {
    const picked = format.datasetId === 'champions' ? pickSpeedSnapshot(format.regulationId, champRegIds, (id) => metaFor?.(id)) : undefined;
    const meta: Source[] = picked ? metaSets(picked.snapshot, dex, format, 30).map((m: MetaSet) => ({ key: m.speciesId, label: `${dex.species(m.speciesId)?.name ?? m.speciesId} (${usageLabel(m)})`, set: m.set, moveShare: picked.snapshot.entries.find((e) => e.speciesId === m.speciesId)?.moves })) : [];
    const saved: Source[] = [];
    for (const t of Object.values(teams)) {
      if (!t.slots.some(Boolean)) continue;
      t.slots.forEach((s, i) => {
        if (s && dex.species(s.speciesId) && s.uid !== mine.uid) saved.push({ key: `${t.id}:${i}`, label: `${t.name} · ${dex.species(s.speciesId)!.name}`, set: s });
      });
    }
    const species = dex.selectableSpecies(format.regulationId);
    // A species in the meta list comes with its set filled in; any other starts blank.
    const anySet = (speciesId: string): PokemonSet => meta.find((m) => m.key === speciesId)?.set ?? createSet(dex, speciesId, format);
    const shareFor = (speciesId: string) => meta.find((m) => m.key === speciesId)?.moveShare;
    return { meta, saved, species, anySet, shareFor, hasMeta: meta.length > 0 };
  }, [dex, format, teams, metaFor, mine.uid]);
}

/** Damaging moves of a set, or (for a blank set) everything the species can learn. */
export function attackMoves(dex: Dex, set: PokemonSet, format: FormatRules): { id: string; name: string }[] {
  const own = set.moves.flatMap((m) => {
    const mv = m ? dex.move(m) : undefined;
    return mv && mv.category !== 'Status' ? [{ id: mv.id, name: mv.name }] : [];
  });
  if (own.length) return own;
  return dex.learnset(set.speciesId, format.regulationId).filter((m) => m.category !== 'Status').map((m) => ({ id: m.id, name: m.name }));
}
