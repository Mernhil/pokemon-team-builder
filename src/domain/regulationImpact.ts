/**
 * Regulation change impact: what moving between two Champions regulations does, in general
 * (`regulationDiff`) and to a saved team (`teamImpact`), plus a "Copy to <regulation>" that leaves
 * the original untouched (`copyTeamToRegulation`). Pure and React-free.
 *
 * Legality is computed from the Dex (species, items and moves carry `legalIn`) and from the real
 * validator (`validateTeam` for the target format), never from the delta files alone, so it works
 * for Showdown-based sets (M-A → M-B) as well as delta ones (M-C). Only the species patches
 * (typing, stats, abilities, with before → after) and the `unconfirmed` notes come from the
 * generated `regulation-changes.json`, which `npm run data` builds from the delta files.
 */
import type { Dex } from '@/data/dex';
import { REGULATION_MANIFEST, currentRegulation, formatForRegulation, getFormat } from './formats';
import { championsStat } from './stats';
import { cloneTeam, emptySlots } from './team';
import { STAT_LABELS, type PokemonSet, type StatId, type Team, type TeamSlots } from './types';
import { validateTeam, type Issue } from './validation';

// ---------------------------------------------------------------------------
// The generated patch data
// ---------------------------------------------------------------------------

interface PatchChange {
  name: string;
  types?: { before: string[]; after: string[] };
  /** By ability slot ('0', '1', 'H', 'S'). A missing `after` means the slot was removed. */
  abilities?: Record<string, { before?: string; after?: string }>;
  baseStats?: Record<string, { before: number; after: number }>;
}
export interface RegulationChanges {
  version: 1;
  regulations: Record<string, { patches: Record<string, PatchChange>; unconfirmed?: { species?: string[]; note?: string } }>;
}

const startOf = (regId: string) => REGULATION_MANIFEST.regulations.find((r) => r.id === regId)?.start ?? '';

/** The regulations whose changes apply when going from `fromId` to `toId` (oldest first), and whether that is backwards. */
function regsBetween(fromId: string, toId: string): { ids: string[]; backwards: boolean } {
  const a = startOf(fromId);
  const b = startOf(toId);
  const backwards = b < a;
  const [lo, hi] = backwards ? [b, a] : [a, b];
  const ids = REGULATION_MANIFEST.regulations
    .filter((r) => r.game === 'champions' && r.start > lo && r.start <= hi)
    .sort((x, y) => x.start.localeCompare(y.start))
    .map((r) => r.id);
  return { ids, backwards };
}

// ---------------------------------------------------------------------------
// Regulation diff
// ---------------------------------------------------------------------------

export interface Ref {
  id: string;
  name: string;
}
export interface Delta {
  added: Ref[];
  removed: Ref[];
}
interface PatchRow {
  speciesId: string;
  name: string;
  regulationId: string;
  field: 'types' | 'ability' | 'stat';
  /** "Type", "Ability (slot 1)", "Speed". */
  label: string;
  before: string;
  after: string;
}
export interface RegulationDiff {
  fromId: string;
  toId: string;
  species: Delta;
  megas: Delta;
  items: Delta;
  moves: Delta;
  abilities: Delta;
  patches: PatchRow[];
  /** Listed by a single source only and not added to the legal lists. */
  unconfirmed: { regulationId: string; speciesIds: string[]; note?: string }[];
}

const byName = (a: Ref, b: Ref) => a.name.localeCompare(b.name);
function delta<T extends { id: string; name: string }>(items: T[], inFrom: (t: T) => boolean, inTo: (t: T) => boolean): Delta {
  return {
    added: items.filter((t) => inTo(t) && !inFrom(t)).map(({ id, name }) => ({ id, name })).sort(byName),
    removed: items.filter((t) => inFrom(t) && !inTo(t)).map(({ id, name }) => ({ id, name })).sort(byName),
  };
}

const SLOT_LABEL: Record<string, string> = { '0': 'Ability (slot 1)', '1': 'Ability (slot 2)', H: 'Hidden Ability', S: 'Special Ability' };
const TYPE_TEXT = (t: string[]) => (t.length ? t.join(' / ') : '—');

/** What changes between two regulations: legal Pokémon, Megas, items, moves, abilities and species patches. */
export function regulationDiff(dex: Dex, fromId: string, toId: string, changes?: RegulationChanges): RegulationDiff {
  const species = dex.allSpecies();
  const legal = (regId: string) => (s: { legalIn: string[] }) => s.legalIn.includes(regId);
  const inFrom = legal(fromId);
  const inTo = legal(toId);
  const abilitiesOf = (regId: string) => {
    const ids = new Map<string, string>();
    for (const s of species.filter(legal(regId))) for (const a of Object.values(s.abilities)) {
      const ab = dex.ability(a);
      if (ab) ids.set(ab.id, ab.name);
    }
    return [...ids].map(([id, name]) => ({ id, name }));
  };
  const abFrom = new Set(abilitiesOf(fromId).map((a) => a.id));
  const abTo = new Set(abilitiesOf(toId).map((a) => a.id));
  const allAbilities = [...new Map([...abilitiesOf(fromId), ...abilitiesOf(toId)].map((a) => [a.id, a])).values()];

  const { ids, backwards } = regsBetween(fromId, toId);
  const patches: PatchRow[] = [];
  const unconfirmed: RegulationDiff['unconfirmed'] = [];
  for (const regId of ids) {
    const c = changes?.regulations[regId];
    if (!c) continue;
    for (const [speciesId, p] of Object.entries(c.patches)) {
      const swap = <T,>(b: T, a: T): [T, T] => (backwards ? [a, b] : [b, a]);
      if (p.types) {
        const [b, a] = swap(p.types.before, p.types.after);
        patches.push({ speciesId, name: p.name, regulationId: regId, field: 'types', label: 'Type', before: TYPE_TEXT(b), after: TYPE_TEXT(a) });
      }
      for (const [slot, ab] of Object.entries(p.abilities ?? {})) {
        const [b, a] = swap(ab.before, ab.after);
        patches.push({ speciesId, name: p.name, regulationId: regId, field: 'ability', label: SLOT_LABEL[slot] ?? `Ability (${slot})`, before: b ?? '—', after: a ?? '—' });
      }
      for (const [stat, v] of Object.entries(p.baseStats ?? {})) {
        const [b, a] = swap(v.before, v.after);
        patches.push({ speciesId, name: p.name, regulationId: regId, field: 'stat', label: STAT_LABELS[stat as StatId] ?? stat, before: String(b), after: String(a) });
      }
    }
    if (!backwards && c.unconfirmed?.species?.length) unconfirmed.push({ regulationId: regId, speciesIds: c.unconfirmed.species, note: c.unconfirmed.note });
  }

  return {
    fromId,
    toId,
    species: delta(species.filter((s) => !s.isMega), inFrom, inTo),
    megas: delta(species.filter((s) => s.isMega), inFrom, inTo),
    items: delta(dex.items(), inFrom, inTo),
    moves: delta(Object.values(dex.data.moves), inFrom, inTo),
    abilities: delta(allAbilities, (a) => abFrom.has(a.id), (a) => abTo.has(a.id)),
    patches,
    unconfirmed,
  };
}

// ---------------------------------------------------------------------------
// Team impact
// ---------------------------------------------------------------------------

export type Severity = 'breaks' | 'changes' | 'opportunity';
type ImpactKind = 'species' | 'item' | 'move' | 'ability' | 'stats' | 'typing' | 'mega';

interface ImpactItem {
  severity: Severity;
  kind: ImpactKind;
  text: string;
  /** The thing itself (species, item, move or ability id), for "Copy to" to remove it. */
  subject?: string;
}
interface SlotImpact {
  slot: number;
  speciesId: string;
  items: ImpactItem[];
}
export interface TeamImpact {
  teamId: string;
  fromRegulationId?: string;
  toRegulationId: string;
  slots: SlotImpact[];
  counts: Record<Severity, number>;
}

const LEGALITY_KINDS: Record<string, ImpactKind> = {
  'species-illegal': 'species',
  'item-illegal': 'item',
  'mega-banned': 'item',
  'move-illegal': 'move',
  'ability-illegal': 'ability',
};

/** An issue with the regulation's name taken out, so the same problem under two regulations compares equal. */
const issueKey = (i: Issue, shortName: string) => `${i.slot}|${i.code}|${i.message.split(shortName).join('REG')}`;

/** The thing a legality issue is about, found by looking at what the slot holds. */
function subjectOf(set: PokemonSet, i: Issue, dex: Dex): string | undefined {
  if (i.code === 'species-illegal') return set.speciesId;
  if (i.code === 'item-illegal' || i.code === 'mega-banned') return set.itemId;
  if (i.code === 'ability-illegal') return set.abilityId;
  if (i.code === 'move-illegal') return set.moves.find((m) => m && i.message.includes(dex.move(m)?.name ?? '\0'));
  return undefined;
}

/**
 * What moving `team` to a regulation does, slot by slot: what becomes illegal (from the validator
 * for the target format, minus whatever was already wrong), what changes (a patched species' typing,
 * stats or abilities, with the final-stat effect), and what is newly possible (a new Mega).
 */
export function teamImpact(team: Team, toRegulationId: string, dex: Dex, changes?: RegulationChanges): TeamImpact {
  const target = formatForRegulation(toRegulationId);
  const teamFormat = getFormat(team.formatId);
  const current = teamFormat.datasetId === 'champions' ? teamFormat : undefined;
  const fromId = current?.regulationId;
  const slots: SlotImpact[] = [];
  const impactOf = new Map<number, ImpactItem[]>();
  const add = (slot: number, item: ImpactItem) => impactOf.set(slot, [...(impactOf.get(slot) ?? []), item]);

  if (target) {
    // Breaks: legality problems the validator reports for the target that the current regulation didn't have.
    const now = new Set(current ? validateTeam(team, current, dex).map((i) => issueKey(i, current.shortName)) : []);
    for (const i of validateTeam(team, target, dex)) {
      const kind = LEGALITY_KINDS[i.code];
      if (!kind || i.slot === undefined || i.severity !== 'error') continue;
      if (now.has(issueKey(i, target.shortName))) continue;
      const set = team.slots[i.slot];
      if (!set) continue;
      add(i.slot, { severity: 'breaks', kind, text: i.message, subject: subjectOf(set, i, dex) });
    }
  }

  if (fromId && fromId !== toRegulationId) {
    const { ids, backwards } = regsBetween(fromId, toRegulationId);
    team.slots.forEach((set, slot) => {
      if (!set) return;
      const sp = dex.species(set.speciesId);
      const mega = dex.megaFor(set.speciesId, set.itemId);
      const nature = dex.nature(set.nature);
      // Changes: a patch to this Pokémon (or to the Mega it holds the stone for).
      for (const regId of ids) {
        for (const sid of [set.speciesId, mega?.id]) {
          const p = sid ? changes?.regulations[regId]?.patches[sid] : undefined;
          if (!p) continue;
          const name = dex.species(sid!)?.name ?? p.name;
          const dir = <T,>(b: T, a: T): [T, T] => (backwards ? [a, b] : [b, a]);
          if (p.types) {
            const [b, a] = dir(p.types.before, p.types.after);
            add(slot, { severity: 'changes', kind: 'typing', text: `${name}: typing ${TYPE_TEXT(b)} → ${TYPE_TEXT(a)}.`, subject: sid });
          }
          for (const [s, v] of Object.entries(p.baseStats ?? {})) {
            const [b, a] = dir(v.before, v.after);
            const stat = s as StatId;
            const sp0 = set.sp[stat] ?? 0;
            add(slot, { severity: 'changes', kind: 'stats', text: `${name}: base ${STAT_LABELS[stat]} ${b} → ${a}, so its ${STAT_LABELS[stat]} goes ${championsStat(stat, b, sp0, nature)} → ${championsStat(stat, a, sp0, nature)}.`, subject: sid });
          }
          for (const [slotKey, ab] of Object.entries(p.abilities ?? {})) {
            const [b, a] = dir(ab.before, ab.after);
            add(slot, { severity: 'changes', kind: 'ability', text: `${name}: ${SLOT_LABEL[slotKey]?.toLowerCase() ?? 'ability'} ${b ?? 'none'} → ${a ?? 'none'}.`, subject: sid });
          }
        }
      }
      // Opportunity: a Mega this species gains in the target regulation.
      if (sp) {
        for (const megaId of sp.megaForms) {
          const m = dex.species(megaId);
          if (!m || !m.legalIn.includes(toRegulationId) || m.legalIn.includes(fromId)) continue;
          const stone = dex.items().find((i) => i.megaStone?.[sp.id] === megaId);
          add(slot, { severity: 'opportunity', kind: 'mega', text: `${sp.name} can now Mega Evolve into ${m.name}${stone ? ` (hold ${stone.name})` : ''}.`, subject: megaId });
        }
      }
    });
  }

  const counts: Record<Severity, number> = { breaks: 0, changes: 0, opportunity: 0 };
  for (const [slot, items] of [...impactOf.entries()].sort((a, b) => a[0] - b[0])) {
    const set = team.slots[slot]!;
    slots.push({ slot, speciesId: set.speciesId, items });
    for (const it of items) counts[it.severity]++;
  }
  return { teamId: team.id, fromRegulationId: fromId, toRegulationId, slots, counts };
}

// ---------------------------------------------------------------------------
// Copy to a regulation
// ---------------------------------------------------------------------------

export interface CopyResult {
  /** A new variation of the team's folder, in the target format, with the illegal parts removed. The original is untouched. */
  team: Team;
  /** What to fix by hand, one line each. */
  checklist: string[];
}

/** The first of a species' abilities, as the editor would pick it. */
const firstAbility = (dex: Dex, speciesId: string) => dex.ability(dex.species(speciesId)?.abilities['0'])?.id;

/**
 * "Copy to <regulation>": a variation of the team in the target regulation. A Pokémon that isn't
 * legal there is taken out of its slot; an illegal item is cleared, an illegal ability reset to the
 * species' first and an illegal move emptied. The checklist lists what to fix. Never modifies `team`.
 */
export function copyTeamToRegulation(team: Team, toRegulationId: string, dex: Dex, changes?: RegulationChanges): CopyResult | undefined {
  const target = formatForRegulation(toRegulationId);
  if (!target) return undefined;
  const impact = teamImpact(team, toRegulationId, dex, changes);
  const label = target.shortName;
  const copy = cloneTeam(team, `${team.name} (${label})`, { groupId: team.groupId ?? team.id, variationLabel: label });
  const checklist: string[] = [];
  const slots: TeamSlots = emptySlots();

  team.slots.forEach((set, i) => {
    if (!set) return;
    const clone = copy.slots[i]!;
    const breaks = impact.slots.find((s) => s.slot === i)?.items.filter((x) => x.severity === 'breaks') ?? [];
    const name = dex.species(set.speciesId)?.name ?? set.speciesId;
    if (breaks.some((b) => b.kind === 'species')) {
      checklist.push(`Slot ${i + 1}: ${name} isn't legal in ${label}. Pick a replacement.`);
      return;
    }
    let next: PokemonSet = clone;
    for (const b of breaks) {
      if (b.kind === 'item') {
        next = { ...next, itemId: undefined };
        checklist.push(`Slot ${i + 1}: ${name}'s ${dex.item(b.subject)?.name ?? 'item'} isn't legal in ${label}. Pick another item.`);
      } else if (b.kind === 'ability') {
        next = { ...next, abilityId: firstAbility(dex, next.speciesId) };
        checklist.push(`Slot ${i + 1}: ${name}'s ability isn't available. Check the ability.`);
      } else if (b.kind === 'move' && b.subject) {
        next = { ...next, moves: next.moves.map((m) => (m === b.subject ? '' : m)) as PokemonSet['moves'] };
        checklist.push(`Slot ${i + 1}: ${name}'s ${dex.move(b.subject)?.name ?? 'move'} isn't legal in ${label}. Pick another move.`);
      }
    }
    for (const c of impact.slots.find((s) => s.slot === i)?.items.filter((x) => x.severity === 'changes') ?? []) checklist.push(`Slot ${i + 1}: ${c.text} Check the spread.`);
    slots[i] = next;
  });

  return { team: { ...copy, formatId: target.id, category: target.shortName, slots, slotsByFormat: undefined }, checklist };
}

// ---------------------------------------------------------------------------
// Which regulations matter now
// ---------------------------------------------------------------------------

/** The live regulation and the next one that has data and starts later, if any. */
export function relevantRegulations(now = new Date()): { live?: string; next?: string; nextStart?: string } {
  const live = currentRegulation(now);
  const t = now.toISOString();
  const next = REGULATION_MANIFEST.regulations
    .filter((r) => r.game === 'champions' && r.start > t && formatForRegulation(r.id))
    .sort((a, b) => a.start.localeCompare(b.start))[0];
  return { live: live?.id, next: next?.id, nextStart: next?.start };
}

/** Whole days from `now` until an ISO date (0 once it has started). */
export const daysUntil = (iso: string, now = Date.now()) => Math.max(0, Math.ceil((Date.parse(iso) - now) / 86_400_000));
