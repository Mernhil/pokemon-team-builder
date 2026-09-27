import type { Dex } from '@/data/dex';
import { emptyStats, type FormatRules, type PokemonSet, type Team, type TeamSlots } from './types';

export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

export const emptySlots = (): TeamSlots => [null, null, null, null, null, null];

export function createTeam(format: FormatRules, name = 'Untitled Team'): Team {
  const now = Date.now();
  return {
    id: uid(),
    name,
    formatId: format.id,
    category: format.shortName,
    slots: emptySlots(),
    createdAt: now,
    updatedAt: now,
  };
}

/** Blank set for a species, with sensible defaults (first ability, neutral-ish nature). */
export function createSet(dex: Dex, speciesId: string, format: FormatRules): PokemonSet {
  const sp = dex.species(speciesId);
  const firstAbility = sp ? dex.ability(sp.abilities['0']) : undefined;
  const gb = format.statSystem.kind === 'gb-statexp';
  return {
    uid: uid(),
    speciesId: sp?.id ?? speciesId,
    abilityId: firstAbility?.id,
    itemId: undefined,
    nature: 'Hardy',
    teraType: format.gimmicks.tera ? sp?.types[0] : undefined,
    moves: ['', '', '', ''],
    level: format.level.fixed ?? format.level.default,
    sp: emptyStats(0),
    // Gen 1–2: max DVs and Stat Exp, as trained cartridge Pokémon (and Showdown) default to.
    evs: emptyStats(gb ? 65535 : 0),
    ivs: emptyStats(format.fixedIVs ?? (gb ? 15 : 31)),
  };
}

/** Deep-clone a team with a fresh id (used by "Duplicate"). */
export function cloneTeam(team: Team, name = `${team.name} (copy)`): Team {
  const now = Date.now();
  return {
    ...structuredClone(team),
    id: uid(),
    name,
    slots: team.slots.map((s) => (s ? { ...structuredClone(s), uid: uid() } : null)) as TeamSlots,
    createdAt: now,
    updatedAt: now,
  };
}
