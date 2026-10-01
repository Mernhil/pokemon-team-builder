/**
 * Atlas domain types and helpers (framework-free): the shape of the generated atlas-<game>.json
 * (`npm run atlas`, scripts/build-atlas.ts) and the pure functions the Atlas UI builds on —
 * trainer teams → Showdown text (for Load into Builder), search and map filters, progress counting.
 */
import type { Dex } from '@/data/dex';
import { exportSetShowdown } from './codecs';
import { createSet, createTeam } from './team';
import type { PokedexData } from './pokedex';
import type { FormatRules, PokemonSet, StatTable, Team, TeamSlots } from './types';

export type * from './atlasTypes';
import type { AtlasFile, AtlasLocation, AtlasMon, AtlasTrainer } from './atlasTypes';

// ---------------------------------------------------------------------------
// Trainer teams → Showdown text (Load into Builder, Damage Calc)
// ---------------------------------------------------------------------------

const cap = (s: string) => s.replace(/(^|\s)\S/g, (c) => c.toUpperCase());

/** The team as Showdown text, written by the builder's own exporter so every generation's conventions (DVs, abilities, natures) hold. */
export function trainerToShowdown(t: AtlasTrainer, dex: Dex, format: FormatRules): string {
  return t.party.map((m, i) => exportSetShowdown(monToSet(m, dex, format, `atlas:${t.id}:${i}`), dex, format)).join('\n\n');
}

/** A trainer mon as the builder's PokemonSet (the game's own IVs, no EVs), with a stable uid per trainer slot. */
export function monToSet(mon: AtlasMon, dex: Dex, format: FormatRules, uid: string): PokemonSet {
  const base = createSet(dex, mon.species, format);
  const ab = mon.ability ? dex.ability(mon.ability) : undefined;
  const moves = [...mon.moves.filter((m) => dex.move(m)), '', '', '', ''].slice(0, 4) as PokemonSet['moves'];
  const gb = format.statSystem.kind === 'gb-statexp';
  const order = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
  const ivs = Object.fromEntries(order.map((k, i) => [k, mon.dvs?.[i] ?? mon.iv])) as unknown as StatTable;
  return {
    ...base,
    uid,
    abilityId: ab?.id ?? base.abilityId,
    itemId: mon.item && dex.item(mon.item) ? mon.item : undefined,
    nature: mon.nature ? cap(mon.nature) : 'Hardy',
    moves,
    level: mon.level,
    ivs,
    // trainers' Pokémon have no EVs / Stat Exp
    ...(gb ? { evs: Object.fromEntries(order.map((k) => [k, 0])) as unknown as StatTable } : {}),
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
  /** The game's signature colour (its icon in the game picker). */
  color: string;
  /** Encounters only: no items, NPCs, shops or trainers (games without a decompilation to read); the map is the game's own or a schematic. */
  lite?: boolean;
  /** False until the game's atlas data is built. */
  available: boolean;
}

/** Maps behind the encounters-only games: screenshots of the games' own maps where one was supplied (src-assets/maps), else the hand-placed schematic (maps.json `games`). */
const GALAR = ['galar', 'galar-isle-of-armor', 'galar-crown-tundra'];
const PALDEA = ['paldea-art', 'paldea-kitakami', 'paldea-terarium'];
const LITE_MAPS: Record<string, string[]> = {
  black: ['unova-art'], white: ['unova-art'], 'black-2': ['unova-art'], 'white-2': ['unova-art'],
  x: ['kalos-art'], y: ['kalos-art'],
  'omega-ruby': ['hoenn-oras'], 'alpha-sapphire': ['hoenn-oras'],
  sun: ['alola'], moon: ['alola'], 'ultra-sun': ['alola'], 'ultra-moon': ['alola'],
  'lets-go-pikachu': ['kanto-lgpe'], 'lets-go-eevee': ['kanto-lgpe'],
  sword: GALAR, shield: GALAR,
  'brilliant-diamond': ['sinnoh-bdsp'], 'shining-pearl': ['sinnoh-bdsp'],
  'legends-arceus': ['hisui'],
  scarlet: PALDEA, violet: PALDEA,
  'legends-za': ['lumiose'],
};

export const ATLAS_GAMES: AtlasGame[] = [
  { id: 'red', name: 'Pokémon Red', shortName: 'Red', book: 'gen1', formatId: 'gen1', dexGame: 'red', mapIds: ['kanto-rby'], color: '#d8302f', available: true },
  { id: 'blue', name: 'Pokémon Blue', shortName: 'Blue', book: 'gen1', formatId: 'gen1', dexGame: 'blue', mapIds: ['kanto-rby'], file: 'red', color: '#2f62c6', available: true },
  { id: 'yellow', name: 'Pokémon Yellow', shortName: 'Yellow', book: 'gen1', formatId: 'gen1', dexGame: 'yellow', mapIds: ['kanto-rby'], color: '#f1c232', available: true },
  { id: 'gold', name: 'Pokémon Gold', shortName: 'Gold', book: 'gen2', formatId: 'gen2', dexGame: 'gold', mapIds: ['johto-gsc', 'kanto-gsc'], color: '#d4a017', available: true },
  { id: 'silver', name: 'Pokémon Silver', shortName: 'Silver', book: 'gen2', formatId: 'gen2', dexGame: 'silver', mapIds: ['johto-gsc', 'kanto-gsc'], file: 'gold', color: '#aeb7c2', available: true },
  { id: 'crystal', name: 'Pokémon Crystal', shortName: 'Crystal', book: 'gen2', formatId: 'gen2', dexGame: 'crystal', mapIds: ['johto-gsc', 'kanto-gsc'], color: '#6ec6e6', available: true },
  { id: 'diamond', name: 'Pokémon Diamond', shortName: 'Diamond', book: 'gen4', formatId: 'gen4', dexGame: 'diamond', mapIds: ['sinnoh-pt'], color: '#8fb8e8', available: true },
  { id: 'pearl', name: 'Pokémon Pearl', shortName: 'Pearl', book: 'gen4', formatId: 'gen4', dexGame: 'pearl', mapIds: ['sinnoh-pt'], file: 'diamond', color: '#e8a8c8', available: true },
  { id: 'heartgold', name: 'Pokémon HeartGold', shortName: 'HeartGold', book: 'gen4', formatId: 'gen4', dexGame: 'heartgold', mapIds: ['johto-kanto-hgss'], color: '#e3a72f', available: true },
  { id: 'soulsilver', name: 'Pokémon SoulSilver', shortName: 'SoulSilver', book: 'gen4', formatId: 'gen4', dexGame: 'soulsilver', mapIds: ['johto-kanto-hgss'], file: 'heartgold', color: '#b8c2cf', available: true },
  { id: 'platinum', name: 'Pokémon Platinum', shortName: 'Platinum', book: 'gen4', formatId: 'gen4', dexGame: 'platinum', mapIds: ['sinnoh-pt'], color: '#8a93a0', available: true },
  { id: 'emerald', name: 'Pokémon Emerald', shortName: 'Emerald', book: 'gen3', formatId: 'gen3', dexGame: 'emerald', mapIds: ['hoenn-rse'], color: '#2fa65a', available: true },
  { id: 'ruby', name: 'Pokémon Ruby', shortName: 'Ruby', book: 'gen3', formatId: 'gen3', dexGame: 'ruby', mapIds: ['hoenn-rse'], color: '#c8283c', available: true },
  { id: 'sapphire', name: 'Pokémon Sapphire', shortName: 'Sapphire', book: 'gen3', formatId: 'gen3', dexGame: 'sapphire', mapIds: ['hoenn-rse'], file: 'ruby', color: '#2b5fc4', available: true },
  { id: 'firered', name: 'Pokémon FireRed', shortName: 'FireRed', book: 'gen3', formatId: 'gen3', dexGame: 'firered', mapIds: ['kanto-frlg', 'sevii-123', 'sevii-45', 'sevii-67'], color: '#e8532a', available: true },
  { id: 'leafgreen', name: 'Pokémon LeafGreen', shortName: 'LeafGreen', book: 'gen3', formatId: 'gen3', dexGame: 'leafgreen', mapIds: ['kanto-frlg', 'sevii-123', 'sevii-45', 'sevii-67'], file: 'firered', color: '#57b947', available: true },
  // Generation 5 onward: encounters only (scripts/atlas/encounters.ts), no map.
  ...[
    ['black', 'Black', 'gen5', 'black', '#2a2a2e'], ['white', 'White', 'gen5', 'white', '#e6e6ea', 'black'],
    ['black2', 'Black 2', 'gen5', 'black-2', '#3a3f4a'], ['white2', 'White 2', 'gen5', 'white-2', '#d4d8e0', 'black2'],
    ['x', 'X', 'gen6', 'x', '#2e6fd0'], ['y', 'Y', 'gen6', 'y', '#d03a4a', 'x'],
    ['omegaruby', 'Omega Ruby', 'gen6', 'omega-ruby', '#b3202f'], ['alphasapphire', 'Alpha Sapphire', 'gen6', 'alpha-sapphire', '#1f55b8', 'omegaruby'],
    ['sun', 'Sun', 'gen7', 'sun', '#f08a24'], ['moon', 'Moon', 'gen7', 'moon', '#5b4fc4', 'sun'],
    ['ultrasun', 'Ultra Sun', 'gen7', 'ultra-sun', '#e8762a'], ['ultramoon', 'Ultra Moon', 'gen7', 'ultra-moon', '#4a3fb0', 'ultrasun'],
    ['letsgopikachu', 'Let’s Go, Pikachu!', 'lgpe', 'lets-go-pikachu', '#f2c200'], ['letsgoeevee', 'Let’s Go, Eevee!', 'lgpe', 'lets-go-eevee', '#b07a3a', 'letsgopikachu'],
    ['sword', 'Sword', 'gen8', 'sword', '#2f9fd8'], ['shield', 'Shield', 'gen8', 'shield', '#d8335a', 'sword'],
    ['brilliantdiamond', 'Brilliant Diamond', 'bdsp', 'brilliant-diamond', '#7fb0e8'], ['shiningpearl', 'Shining Pearl', 'bdsp', 'shining-pearl', '#e8a8c8', 'brilliantdiamond'],
    ['legendsarceus', 'Legends: Arceus', 'pla', 'legends-arceus', '#6a7f93'],
    ['scarlet', 'Scarlet', 'gen9', 'scarlet', '#e0452e'], ['violet', 'Violet', 'gen9', 'violet', '#7b45c9', 'scarlet'],
    ['legendsza', 'Legends: Z-A', 'za', 'legends-za', '#3f9a8a'],
  ].map(([id, shortName, book, dexGame, color, file]): AtlasGame => ({
    id, name: `Pokémon ${shortName}`, shortName, book, formatId: book, dexGame, mapIds: LITE_MAPS[dexGame], file, color, lite: true, available: true,
  })),
];

/** The generation a game belongs to (the picker groups by it). */
export function atlasGameGen(g: AtlasGame): number {
  return /^gen(\d)$/.test(g.book) ? Number(g.book.slice(3)) : g.book === 'lgpe' ? 7 : g.book === 'za' ? 9 : 8;
}

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
