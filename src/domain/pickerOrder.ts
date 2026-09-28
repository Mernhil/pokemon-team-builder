/**
 * The order of every picker list (items, moves, Pokémon, natures), in one place.
 *
 * Empty search: Favorites → Recent → the curated groups below. Typed search: one flat list ranked
 * by relevance (exact > prefix > word start > substring > keyword), ties keeping the curated order.
 * Lists only ever contain what the selected game has — callers pass the game-filtered pool
 * (Dex.items / Dex.learnset / Dex.selectableSpecies), this module only orders it.
 *
 * Tweak PICKER_ORDER to change an order; the functions below read everything from it.
 */
import { isZCrystal, type Capabilities } from './capabilities';
import { TYPE_NAMES, type Item, type Move, type MoveBoosts, type Pokemon, type TypeName } from './types';

export type PickerKey = 'items' | 'moves' | 'species' | 'natures';

export const PICKER_ORDER = {
  /** Recently picked entries kept per picker. */
  recentsCap: 8,
  /** Recent natures shown above the Mint grid. */
  natureRecentsCap: 5,
  items: {
    /** Group order and labels; an item appears in the first group it qualifies for. */
    groups: [
      { id: 'favorites', label: 'Favorites' },
      { id: 'recent', label: 'Recent' },
      { id: 'staples', label: 'Competitive staples' },
      { id: 'gimmick', label: 'Mega Stones & Z-Crystals' },
      { id: 'typeBoost', label: 'Type-boosting items' },
      { id: 'resistBerries', label: 'Resist berries' },
      { id: 'berries', label: 'Other berries' },
      { id: 'other', label: 'Everything else' },
    ],
    /** Shown in this order, where the game has them. */
    staples: [
      'choicescarf', 'choiceband', 'choicespecs', 'lifeorb', 'leftovers', 'focussash', 'assaultvest', 'rockyhelmet',
      'sitrusberry', 'lumberry', 'boosterenergy', 'clearamulet', 'covertcloak', 'safetygoggles', 'eviolite',
      'heavydutyboots', 'blacksludge', 'expertbelt', 'weaknesspolicy', 'mentalherb', 'whiteherb', 'lightclay',
      'loadeddice', 'mirrorherb', 'throatspray', 'ejectbutton', 'ejectpack', 'redcard', 'airballoon',
      'damprock', 'heatrock', 'smoothrock', 'icyrock', 'terrainextender', 'roomservice',
    ],
    /** Items that power up one type's moves (type items, Plates, Gems, Incenses, Gen 2 bows). */
    typeBoost: {
      silkscarf: 'Normal', pinkbow: 'Normal', polkadotbow: 'Normal', normalgem: 'Normal',
      charcoal: 'Fire', flameplate: 'Fire', firegem: 'Fire',
      mysticwater: 'Water', splashplate: 'Water', seaincense: 'Water', waveincense: 'Water', watergem: 'Water',
      magnet: 'Electric', zapplate: 'Electric', electricgem: 'Electric',
      miracleseed: 'Grass', meadowplate: 'Grass', roseincense: 'Grass', grassgem: 'Grass',
      nevermeltice: 'Ice', icicleplate: 'Ice', icegem: 'Ice',
      blackbelt: 'Fighting', fistplate: 'Fighting', fightinggem: 'Fighting',
      poisonbarb: 'Poison', toxicplate: 'Poison', poisongem: 'Poison',
      softsand: 'Ground', earthplate: 'Ground', groundgem: 'Ground',
      sharpbeak: 'Flying', skyplate: 'Flying', flyinggem: 'Flying',
      twistedspoon: 'Psychic', mindplate: 'Psychic', oddincense: 'Psychic', psychicgem: 'Psychic',
      silverpowder: 'Bug', insectplate: 'Bug', buggem: 'Bug',
      hardstone: 'Rock', stoneplate: 'Rock', rockincense: 'Rock', rockgem: 'Rock',
      spelltag: 'Ghost', spookyplate: 'Ghost', ghostgem: 'Ghost',
      dragonfang: 'Dragon', dracoplate: 'Dragon', dragongem: 'Dragon',
      blackglasses: 'Dark', dreadplate: 'Dark', darkgem: 'Dark',
      metalcoat: 'Steel', ironplate: 'Steel', steelgem: 'Steel',
      pixieplate: 'Fairy', fairyfeather: 'Fairy', fairygem: 'Fairy',
    } as Record<string, TypeName>,
    /** Berries that halve a super-effective hit of one type (Chilan: any Normal hit). */
    resistBerries: {
      chilanberry: 'Normal', occaberry: 'Fire', passhoberry: 'Water', wacanberry: 'Electric', rindoberry: 'Grass',
      yacheberry: 'Ice', chopleberry: 'Fighting', kebiaberry: 'Poison', shucaberry: 'Ground', cobaberry: 'Flying',
      payapaberry: 'Psychic', tangaberry: 'Bug', chartiberry: 'Rock', kasibberry: 'Ghost', habanberry: 'Dragon',
      colburberry: 'Dark', babiriberry: 'Steel', roseliberry: 'Fairy',
    } as Record<string, TypeName>,
  },
  moves: {
    groups: [
      { id: 'favorites', label: 'Favorites' },
      { id: 'recent', label: 'Recent' },
      { id: 'stab', label: 'STAB attacks' },
      { id: 'coverage', label: 'Coverage attacks' },
      { id: 'setup', label: 'Setup' },
      { id: 'support', label: 'Support & status' },
      { id: 'other', label: 'Other attacks (fixed or variable power)' },
    ],
  },
  species: {
    groups: [
      { id: 'favorites', label: 'Favorites' },
      { id: 'recent', label: 'Recent' },
      { id: 'legal', label: 'Available' },
      { id: 'unavailable', label: 'Not in this regulation' },
    ],
    /** Whether species outside the format (Champions regulations only) are listed, greyed out. */
    showUnavailableByDefault: false,
  },
} as const;

export interface PickerGroup<T> {
  id: string;
  label: string;
  entries: T[];
}

/** Favorites and recents, most recent first; each id only once. */
export interface PickerPrefs {
  favorites: readonly string[];
  recent: readonly string[];
}

const typeIndex = (t: string) => {
  const i = (TYPE_NAMES as readonly string[]).indexOf(t);
  return i < 0 ? TYPE_NAMES.length : i;
};
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

/**
 * Splits a pool into labelled groups: Favorites and Recent first (in the prefs' order), then each
 * entry in the first curated group whose test it passes. Empty groups are dropped.
 */
function group<T extends { id: string }>(
  pool: T[],
  labels: readonly { id: string; label: string }[],
  prefs: PickerPrefs,
  assign: (entry: T) => string,
  sorters: Record<string, (a: T, b: T) => number>,
): PickerGroup<T>[] {
  const byId = new Map(pool.map((e) => [e.id, e]));
  const taken = new Set<string>();
  const pick = (ids: readonly string[]) =>
    ids.flatMap((id) => {
      const e = byId.get(id);
      if (!e || taken.has(id)) return [];
      taken.add(id);
      return [e];
    });
  const buckets = new Map<string, T[]>([
    ['favorites', pick(prefs.favorites)],
    ['recent', pick(prefs.recent)],
  ]);
  for (const e of pool) {
    if (taken.has(e.id)) continue;
    const g = assign(e);
    buckets.set(g, [...(buckets.get(g) ?? []), e]);
  }
  return labels
    .map(({ id, label }) => {
      const entries = buckets.get(id) ?? [];
      const sort = sorters[id];
      return { id, label, entries: sort ? [...entries].sort(sort) : entries };
    })
    .filter((g) => g.entries.length > 0);
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export interface ItemOrderContext {
  prefs: PickerPrefs;
  caps: Capabilities;
  /** The Pokémon the item is for: its own Mega Stone sorts first among the stones. */
  speciesId?: string;
  /** A–Z instead of curated groups (Favorites and Recent stay on top). */
  alphabetical?: boolean;
}

export function orderItems(items: Item[], ctx: ItemOrderContext): PickerGroup<Item>[] {
  const cfg = PICKER_ORDER.items;
  const labels = ctx.alphabetical
    ? [...cfg.groups.slice(0, 2), { id: 'all', label: 'All items A–Z' }]
    : cfg.groups;
  const staple = new Map<string, number>(cfg.staples.map((id, i) => [id, i]));
  const boostOrder = new Map(Object.keys(cfg.typeBoost).map((id, i) => [id, i]));
  const ownStone = (i: Item) => (ctx.speciesId && i.megaStone?.[ctx.speciesId] ? 0 : 1);
  const assign = (i: Item): string => {
    if (ctx.alphabetical) return 'all';
    if (staple.has(i.id)) return 'staples';
    if ((i.megaStone && ctx.caps.mega) || (isZCrystal(i.id) && ctx.caps.zMoves)) return 'gimmick';
    if (Object.hasOwn(cfg.typeBoost, i.id)) return 'typeBoost';
    if (Object.hasOwn(cfg.resistBerries, i.id)) return 'resistBerries';
    if (i.id.endsWith('berry')) return 'berries';
    return 'other';
  };
  return group(items, labels, ctx.prefs, assign, {
    staples: (a, b) => staple.get(a.id)! - staple.get(b.id)!,
    gimmick: (a, b) => ownStone(a) - ownStone(b) || Number(!!b.megaStone) - Number(!!a.megaStone) || byName(a, b),
    // By type, then in the config's order within a type (the type's classic item first).
    typeBoost: (a, b) => typeIndex(cfg.typeBoost[a.id]) - typeIndex(cfg.typeBoost[b.id]) || boostOrder.get(a.id)! - boostOrder.get(b.id)!,
    resistBerries: (a, b) => typeIndex(cfg.resistBerries[a.id]) - typeIndex(cfg.resistBerries[b.id]),
    berries: byName,
    other: byName,
    all: byName,
  });
}

// ---------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------

export interface MoveOrderContext {
  prefs: PickerPrefs;
  /** Types that get STAB: the Pokémon's, plus its Mega's when it holds the stone. */
  stabTypes: readonly string[];
  alphabetical?: boolean;
}

const raisesUser = (b?: MoveBoosts) => !!b && Object.values(b).some((v) => (v ?? 0) > 0);

/** Status moves that raise the user's own stats (Swords Dance, Calm Mind, Shell Smash…). */
export const isSetupMove = (m: Move): boolean =>
  m.category === 'Status' && ((m.target === 'self' && raisesUser(m.boosts)) || raisesUser(m.self?.boosts));

export function moveGroupOf(m: Move, stabTypes: readonly string[]): string {
  if (m.category === 'Status') return isSetupMove(m) ? 'setup' : 'support';
  if (!m.basePower) return 'other';
  return stabTypes.includes(m.type) ? 'stab' : 'coverage';
}

export function orderMoves(moves: Move[], ctx: MoveOrderContext): PickerGroup<Move>[] {
  const cfg = PICKER_ORDER.moves;
  const labels = ctx.alphabetical ? [...cfg.groups.slice(0, 2), { id: 'all', label: 'All moves A–Z' }] : cfg.groups;
  const byPower = (a: Move, b: Move) => b.basePower - a.basePower || byName(a, b);
  return group(moves, labels, ctx.prefs, (m) => (ctx.alphabetical ? 'all' : moveGroupOf(m, ctx.stabTypes)), {
    stab: byPower,
    coverage: byPower,
    setup: byName,
    support: byName,
    other: byName,
    all: byName,
  });
}

// ---------------------------------------------------------------------------
// Pokémon
// ---------------------------------------------------------------------------

export interface SpeciesOrderContext {
  prefs: PickerPrefs;
  /** Species outside the format, listed greyed out at the bottom (empty to hide them). */
  unavailable?: Pokemon[];
}

/** National Dex order, a base species before its other formes. */
const byDex = (a: Pokemon, b: Pokemon) => a.num - b.num || Number(!!a.forme) - Number(!!b.forme) || byName(a, b);

export function orderSpecies(legal: Pokemon[], ctx: SpeciesOrderContext): PickerGroup<Pokemon>[] {
  const unavailable = new Set((ctx.unavailable ?? []).map((s) => s.id));
  const pool = [...legal, ...(ctx.unavailable ?? []).filter((s) => !legal.some((l) => l.id === s.id))];
  // Favorites/recents only surface species the format allows.
  const prefs = {
    favorites: ctx.prefs.favorites.filter((id) => !unavailable.has(id)),
    recent: ctx.prefs.recent.filter((id) => !unavailable.has(id)),
  };
  return group(pool, PICKER_ORDER.species.groups, prefs, (s) => (unavailable.has(s.id) ? 'unavailable' : 'legal'), {
    legal: byDex,
    unavailable: byDex,
  });
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, '');
const squash = (s: string) => s.replace(/ /g, '');

/** Relevance of `label` for `query`: 0 exact, 1 prefix, 2 word start, 3 substring, 4 keyword, -1 none. */
export function matchRank(query: string, label: string, keywords = ''): number {
  const q = squash(norm(query));
  if (!q) return 0;
  const l = norm(label);
  const flat = squash(l);
  if (flat === q) return 0;
  if (flat.startsWith(q)) return 1;
  if (l.split(' ').some((_w, i, words) => squash(words.slice(i).join(' ')).startsWith(q))) return 2;
  if (flat.includes(q)) return 3;
  if (squash(norm(keywords)).includes(q)) return 4;
  return -1;
}

/**
 * Filters and ranks `entries` (already in curated order) for a query. Stable: equally relevant
 * entries keep their curated order.
 */
export function rankSearch<T>(entries: T[], query: string, label: (e: T) => string, keywords?: (e: T) => string | undefined): T[] {
  return entries
    .map((e, i) => ({ e, i, r: matchRank(query, label(e), keywords?.(e)) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.e);
}

/** Moves `id` to the front of a recents list, capped. */
export const pushRecent = (list: readonly string[], id: string, cap: number = PICKER_ORDER.recentsCap): string[] =>
  [id, ...list.filter((x) => x !== id)].slice(0, cap);
