import type { Dex } from '@/data/dex';
import { stripUnsupported } from './capabilities';
import { getFormat } from './formats';
import { emptyStats, type FormatRules, type PokemonSet, type Team, type TeamSlots } from './types';

export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

export const emptySlots = (): TeamSlots => [null, null, null, null, null, null];

export const DEFAULT_TEAM_NAME = 'Untitled Team';

/** Whether a team is more than the scratch draft: named, a variation, or shared. Clearing one must not wipe it. */
export const isSavedTeam = (t: Pick<Team, 'name' | 'groupId' | 'shared'>): boolean => t.name !== DEFAULT_TEAM_NAME || !!t.groupId || !!t.shared;

export function createTeam(format: FormatRules, name = DEFAULT_TEAM_NAME): Team {
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
    teraType: format.capabilities.tera ? sp?.types[0] : undefined,
    moves: ['', '', '', ''],
    level: format.level.fixed ?? format.level.default,
    sp: emptyStats(0),
    // Gen 1–2: max DVs and Stat Exp, as trained cartridge Pokémon (and Showdown) default to.
    evs: emptyStats(gb ? 65535 : 0),
    ivs: emptyStats(format.fixedIVs ?? (gb ? 15 : 31)),
    friendship: format.statSystem.kind === 'lgpe-av' ? 255 : undefined,
  };
}

/**
 * Deep-clone a team with a fresh id (used by "Duplicate", "Save as…" and "Add variation").
 * Clones are top-level groups by default — pass `overrides` to nest the copy as a variation.
 */
export function cloneTeam(team: Team, name = `${team.name} (copy)`, overrides?: Partial<Pick<Team, 'groupId' | 'variationLabel'>>): Team {
  const now = Date.now();
  // A copy's Pokémon get new ids, so a matchup note's leads follow them to the new ones.
  const renamed = new Map<string, string>();
  const cloneSlots = (slots: TeamSlots, track = false): TeamSlots =>
    slots.map((s) => {
      if (!s) return null;
      const copy = { ...structuredClone(s), uid: uid() };
      if (track) renamed.set(s.uid, copy.uid);
      return copy;
    }) as TeamSlots;
  const slotsCopy = cloneSlots(team.slots, true);
  return {
    ...structuredClone(team),
    id: uid(),
    name,
    groupId: undefined,
    variationLabel: undefined,
    shared: undefined, // a copy is always mine
    ...overrides,
    slots: slotsCopy,
    matchupNotes: team.matchupNotes?.map((n) => ({ ...n, ...(n.leads ? { leads: n.leads.flatMap((l) => (renamed.has(l) ? [renamed.get(l)!] : [])) } : {}) })),
    slotsByFormat: team.slotsByFormat && Object.fromEntries(Object.entries(team.slotsByFormat).map(([id, s]) => [id, cloneSlots(s)])),
    createdAt: now,
    updatedAt: now,
  };
}

/** Teams whose `groupId` points at `groupId`, most recently edited first. */
export function teamVariations(teams: Record<string, Team>, groupId: string): Team[] {
  return Object.values(teams)
    .filter((t) => t.groupId === groupId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Removes whatever a team's games can't have (a Tera Type outside Scarlet/Violet) from its active
 * roster and from every per-format roster kept in `slotsByFormat`, each checked against its own
 * format. Returns the same object when nothing changes.
 */
export function enforceCapabilities(team: Team): Team {
  const fix = (slots: TeamSlots, formatId: string): TeamSlots => {
    const caps = getFormat(formatId).capabilities;
    const next = slots.map((s) => (s ? stripUnsupported(s, caps) : null)) as TeamSlots;
    return next.every((s, i) => s === slots[i]) ? slots : next;
  };
  const slots = fix(team.slots, team.formatId);
  let slotsByFormat = team.slotsByFormat;
  if (slotsByFormat) {
    const entries = Object.entries(slotsByFormat).map(([id, s]) => [id, fix(s, id)] as const);
    if (entries.some(([id, s]) => s !== slotsByFormat![id])) slotsByFormat = Object.fromEntries(entries);
  }
  return slots === team.slots && slotsByFormat === team.slotsByFormat ? team : { ...team, slots, slotsByFormat };
}
