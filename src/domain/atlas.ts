/**
 * Atlas domain types and helpers (framework-free): the shape of the generated atlas-<game>.json
 * (`npm run atlas`, scripts/build-atlas.ts) and the pure functions the Atlas UI builds on —
 * trainer teams → Showdown text (for Load into Builder), search and map filters, progress counting.
 */
import type { Dex } from '@/data/dex';
import { mechanics } from './generations';
import { createSet, createTeam } from './team';
import type { PokedexData } from './pokedex';
import type { FormatRules, PokemonSet, StatTable, Team, TeamSlots } from './types';

export type * from './atlasTypes';
import type { AtlasFile, AtlasLocation, AtlasMon, AtlasTrainer } from './atlasTypes';

// ---------------------------------------------------------------------------
// Trainer teams → Showdown text (Load into Builder, Damage Calc)
// ---------------------------------------------------------------------------

const cap = (s: string) => s.replace(/(^|\s)\S/g, (c) => c.toUpperCase());

/** One trainer mon as Showdown export text, resolved against the game's Dex (names, natures, moves). */
export function monToShowdown(mon: AtlasMon, dex: Dex, hasAbilities: boolean): string {
  const sp = dex.species(mon.species);
  const lines: string[] = [];
  const item = mon.item ? dex.item(mon.item) : undefined;
  lines.push(`${sp?.name ?? cap(mon.species)}${mon.gender === 'M' || mon.gender === 'F' ? ` (${mon.gender})` : ''}${item ? ` @ ${item.name}` : ''}`);
  if (hasAbilities && mon.ability) {
    const ab = dex.ability(mon.ability);
    if (ab) lines.push(`Ability: ${ab.name}`);
  }
  lines.push(`Level: ${mon.level}`);
  if (mon.nature) lines.push(`${cap(mon.nature)} Nature`);
  const iv = mon.iv;
  lines.push(`IVs: ${['HP', 'Atk', 'Def', 'SpA', 'SpD', 'Spe'].map((s) => `${iv} ${s}`).join(' / ')}`);
  for (const m of mon.moves) {
    const mv = dex.move(m);
    if (mv) lines.push(`- ${mv.name}`);
  }
  return lines.join('\n');
}

export function trainerToShowdown(t: AtlasTrainer, dex: Dex, format: FormatRules): string {
  return t.party.map((m) => monToShowdown(m, dex, mechanics(format.generation).abilities)).join('\n\n');
}

/** A trainer mon as the builder's PokemonSet (the game's own IVs, no EVs), with a stable uid per trainer slot. */
export function monToSet(mon: AtlasMon, dex: Dex, format: FormatRules, uid: string): PokemonSet {
  const base = createSet(dex, mon.species, format);
  const ab = mon.ability ? dex.ability(mon.ability) : undefined;
  const moves = [...mon.moves.filter((m) => dex.move(m)), '', '', '', ''].slice(0, 4) as PokemonSet['moves'];
  const ivs = Object.fromEntries(Object.keys(base.ivs).map((k) => [k, mon.iv])) as unknown as StatTable;
  return {
    ...base,
    uid,
    abilityId: ab?.id ?? base.abilityId,
    itemId: mon.item && dex.item(mon.item) ? mon.item : undefined,
    nature: mon.nature ? cap(mon.nature) : 'Hardy',
    moves,
    level: mon.level,
    ivs,
    ...(mon.gender === 'M' || mon.gender === 'F' ? { gender: mon.gender } : {}),
  };
}

/** The trainer's party as a builder Team (for the matrices and Load into Builder). */
export function trainerToTeam(t: AtlasTrainer, dex: Dex, format: FormatRules): Team {
  const team = createTeam(format, t.name);
  const slots = [...team.slots] as TeamSlots;
  t.party.slice(0, format.teamSize).forEach((m, i) => {
    slots[i] = monToSet(m, dex, format, `atlas:${t.id}:${i}`);
  });
  return { ...team, slots, category: `${format.shortName} · ${t.cls}` };
}

// ---------------------------------------------------------------------------
// Variants, search, filters, progress
// ---------------------------------------------------------------------------

/** All battles of a trainer (first battle, rematches, starter-dependent versions), in order. */
export function trainerVariants(file: AtlasFile, group: string): AtlasTrainer[] {
  return Object.values(file.trainers)
    .filter((t) => t.group === group)
    .sort((a, b) => a.order - b.order);
}

export interface TrainerQuery {
  text?: string;
  species?: string;
  move?: string;
  /** Any of these species / moves (resolved from typed text by the caller). */
  speciesIn?: Set<string>;
  moveIn?: Set<string>;
  loc?: string;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Trainer index search: name / class / location, Pokémon used, move used. All parts must match. */
export function searchTrainers(file: AtlasFile, q: TrainerQuery, names: { species?: (id: string) => string; loc?: (id: string) => string } = {}): AtlasTrainer[] {
  const text = q.text ? norm(q.text) : '';
  return Object.values(file.trainers).filter((t) => {
    if (q.loc && t.loc !== q.loc) return false;
    if (q.species && !t.party.some((m) => m.species === q.species)) return false;
    if (q.move && !t.party.some((m) => m.moves.includes(q.move!))) return false;
    if (q.speciesIn && !t.party.some((m) => q.speciesIn!.has(m.species))) return false;
    if (q.moveIn && !t.party.some((m) => m.moves.some((mv) => q.moveIn!.has(mv)))) return false;
    if (!text) return true;
    const hay = norm([t.name, t.cls, t.loc ?? '', t.loc ? (names.loc?.(t.loc) ?? '') : '', ...t.party.map((m) => names.species?.(m.species) ?? m.species)].join(' '));
    return hay.includes(text);
  });
}

export interface MapFilter {
  gym?: boolean;
  shop?: boolean;
  pokecenter?: boolean;
  item?: string;
  trainerSpecies?: string;
  trainerMove?: string;
  /** Location ids where this Pokémon is found in the wild (from the Pokédex data). */
  wildLocs?: Set<string>;
  text?: string;
}

/** Location ids matching every active filter (empty filter → null, meaning "no filter"). */
export function matchLocations(file: AtlasFile, f: MapFilter, names: (loc: AtlasLocation) => string = (l) => l.name): Set<string> | null {
  const active = f.gym || f.shop || f.pokecenter || f.item || f.trainerSpecies || f.trainerMove || f.wildLocs || f.text;
  if (!active) return null;
  const out = new Set<string>();
  const text = f.text ? norm(f.text) : '';
  for (const l of Object.values(file.locations)) {
    if (f.gym && !l.gym) continue;
    if (f.shop && !l.shops.length) continue;
    if (f.pokecenter && !l.pokecenter) continue;
    if (f.item && !l.items.some((i) => i.item === f.item) && !l.shops.some((s) => s.items.some((i) => i.item === f.item))) continue;
    if (f.trainerSpecies && !l.trainers.some((id) => file.trainers[id]?.party.some((m) => m.species === f.trainerSpecies))) continue;
    if (f.trainerMove && !l.trainers.some((id) => file.trainers[id]?.party.some((m) => m.moves.includes(f.trainerMove!)))) continue;
    if (f.wildLocs && !f.wildLocs.has(l.id)) continue;
    if (text && !norm(names(l)).includes(text)) continue;
    out.add(l.id);
  }
  return out;
}

/** Stable progress key for an item spot (location + index), a trainer id, or a location id. */
export const itemKey = (loc: string, i: number) => `${loc}#${i}`;

export interface Progress {
  locations: string[];
  items: string[];
  trainers: string[];
}

export interface Completion {
  done: number;
  total: number;
  pct: number;
}
const pct = (done: number, total: number): Completion => ({ done, total, pct: total ? Math.round((done / total) * 100) : 0 });

export function completion(file: AtlasFile, p: Progress) {
  const items = Object.values(file.locations).reduce((n, l) => n + l.items.length, 0);
  const trainers = Object.keys(file.trainers).filter((id) => file.trainers[id].order === 0 || file.trainers[id].group === id).length;
  return {
    locations: pct(p.locations.length, Object.keys(file.locations).length),
    items: pct(p.items.length, items),
    trainers: pct(p.trainers.length, trainers),
  };
}

// ---------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------

export interface AtlasGame {
  id: string;
  name: string;
  shortName: string;
  /** Pokédex book (gen4…) the wild-encounter tables come from, and the builder / calc format. */
  book: string;
  formatId: string;
  /** Pokédex game id whose encounters apply. */
  dexGame: string;
  /** maps.json map ids of the game's regions, the first one shown by default (region switcher when several). */
  mapIds: string[];
  /** The atlas file, when it isn't `atlas-<id>.json` (LeafGreen reads FireRed's). */
  file?: string;
  /** False until the game's atlas data is built. */
  available: boolean;
}

export const ATLAS_GAMES: AtlasGame[] = [
  { id: 'platinum', name: 'Pokémon Platinum', shortName: 'Platinum', book: 'gen4', formatId: 'gen4', dexGame: 'platinum', mapIds: ['sinnoh-pt'], available: true },
  { id: 'emerald', name: 'Pokémon Emerald', shortName: 'Emerald', book: 'gen3', formatId: 'gen3', dexGame: 'emerald', mapIds: ['hoenn-rse'], available: true },
  { id: 'ruby', name: 'Pokémon Ruby', shortName: 'Ruby', book: 'gen3', formatId: 'gen3', dexGame: 'ruby', mapIds: ['hoenn-rse'], available: true },
  { id: 'sapphire', name: 'Pokémon Sapphire', shortName: 'Sapphire', book: 'gen3', formatId: 'gen3', dexGame: 'sapphire', mapIds: ['hoenn-rse'], file: 'ruby', available: true },
  { id: 'firered', name: 'Pokémon FireRed', shortName: 'FireRed', book: 'gen3', formatId: 'gen3', dexGame: 'firered', mapIds: ['kanto-frlg', 'sevii-123', 'sevii-45', 'sevii-67'], available: true },
  { id: 'leafgreen', name: 'Pokémon LeafGreen', shortName: 'LeafGreen', book: 'gen3', formatId: 'gen3', dexGame: 'leafgreen', mapIds: ['kanto-frlg', 'sevii-123', 'sevii-45', 'sevii-67'], file: 'firered', available: true },
];

export const atlasGame = (id: string): AtlasGame => ATLAS_GAMES.find((g) => g.id === id) ?? ATLAS_GAMES[0];

// ---------------------------------------------------------------------------
// Wild Pokémon by location (from the Pokédex encounter tables)
// ---------------------------------------------------------------------------

export interface WildRow {
  species: string;
  method: string;
  min: number;
  max: number;
  rate: number;
  conditions: string[];
  /** Sub-area (floor, part) the row belongs to. */
  sub?: string;
}

/** Every wild encounter of `loc` in one game, grouped by method by the caller. */
export function wildAt(data: PokedexData, dexGame: string, loc: string): WildRow[] {
  const gi = data.games.findIndex((g) => g.id === dexGame);
  const out: WildRow[] = [];
  for (const [species, rows] of Object.entries(data.encounters))
    for (const [g, a, m, min, max, rate, conds] of rows)
      if (g === gi && data.areas[a].loc === loc) out.push({ species, method: data.methods[m], min, max, rate, conditions: conds.map((c) => data.conditions[c]), sub: data.areas[a].sub });
  return out;
}

/** Location ids where a species is found in one game. */
export function wildLocations(data: PokedexData, dexGame: string, speciesId: string): Set<string> {
  const gi = data.games.findIndex((g) => g.id === dexGame);
  return new Set((data.encounters[speciesId] ?? []).filter(([g]) => g === gi).map(([, a]) => data.areas[a].loc));
}

/** Where each item can be found: map spots, shop counters and NPC gifts, by item id. */
export function itemSources(file: AtlasFile): Map<string, { loc: string; how: string; where: string; price?: number }[]> {
  const out = new Map<string, { loc: string; how: string; where: string; price?: number }[]>();
  const add = (item: string, row: { loc: string; how: string; where: string; price?: number }) => (out.get(item) ?? out.set(item, []).get(item)!).push(row);
  for (const l of Object.values(file.locations)) {
    for (const i of l.items) add(i.item, { loc: l.id, how: i.how, where: i.where });
    for (const s of l.shops) for (const i of s.items) add(i.item, { loc: l.id, how: 'mart', where: s.name, price: i.price });
  }
  return out;
}
