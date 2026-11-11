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

/**
 * An unnamed team that is not a save: the builder's open scratch draft, or an empty unnamed one (e.g. a draft another device synced).
 * The saved-teams list leaves these out so a build never shows up twice, once as the team you saved and once as "Untitled Team".
 */
export const isHiddenDraft = (t: Pick<Team, 'id' | 'name' | 'groupId' | 'shared' | 'slots'>, activeTeamId: string): boolean =>
  !isSavedTeam(t) && (t.id === activeTeamId || !t.slots.some(Boolean));

export function createTeam(format: FormatRules, name = DEFAULT_TEAM_NAME, stamp?: string): Team {
  const now = Date.now();
  return {
    id: uid(),
    name,
    formatId: format.id,
    category: format.shortName,
    slots: emptySlots(),
    createdAt: now,
    updatedAt: now,
    ...(stamp ? { createdOn: stamp, updatedOn: stamp } : {}),
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
 * Clones are top-level groups by default — pass `overrides` to nest the copy as a variation, and the device stamps
 * (`createdOn`/`updatedOn`, src/domain/deviceStamp.ts) of whoever made the copy: none by default.
 */
export function cloneTeam(team: Team, name = `${team.name} (copy)`, overrides?: Partial<Pick<Team, 'groupId' | 'variationLabel' | 'createdOn' | 'updatedOn'>>): Team {
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
    // Made (and edited) where it is copied, unless the caller says whose version this is (a draft, a conflict copy).
    createdOn: undefined,
    updatedOn: undefined,
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

/**
 * Names of the player's other top-level saved teams to offer under the name field: all of them while the field is empty or
 * still the default, otherwise those containing what has been typed. The name already typed in full is left out (the
 * "already exists" choice covers it).
 */
export function suggestTeamNames(teams: Record<string, Team>, order: string[], activeTeamId: string, typed: string): string[] {
  const q = typed.trim().toLowerCase();
  const all = q === '' || q === DEFAULT_TEAM_NAME.toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of order) {
    const t = teams[id];
    if (!t || t.groupId || (!!t.shared && t.shared.role !== 'edit') || isHiddenDraft(t, activeTeamId)) continue;
    const key = t.name.trim().toLowerCase();
    if (!key || seen.has(key) || key === q) continue;
    seen.add(key);
    if (all || key.includes(q)) out.push(t.name);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Is the open draft different from the saved team it came from?
// ---------------------------------------------------------------------------

/** JSON with sorted keys and no undefined values, so two equal objects always give the same text. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => stable(v === undefined ? null : v)).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * What Save writes into a saved team, without the ids that differ between a draft and its copy: the roster (by
 * position, so a reorder counts), the format, the notes and the matchup notes (their leads as slot positions).
 */
function contentOf(t: Team): string {
  const slotOf = new Map<string, number>();
  t.slots.forEach((s, i) => s && slotOf.set(s.uid, i));
  return stable({
    formatId: t.formatId,
    notes: t.notes || undefined,
    replicaCode: t.replicaCode || undefined,
    slots: t.slots.map((s) => (s ? { ...s, uid: undefined } : null)),
    matchupNotes: t.matchupNotes?.length
      ? t.matchupNotes.map((n) => ({ ...n, id: undefined, leads: n.leads?.map((l) => slotOf.get(l) ?? -1) }))
      : undefined,
  });
}

/** True when the open draft holds something the saved team it came from does not (what Update would write). */
export const isDirty = (draft: Team, saved: Team): boolean => contentOf(draft) !== contentOf(saved);
