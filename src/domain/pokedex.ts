/**
 * Pokédex domain helpers (framework-free): the shapes of the generated pokedex-gen<N>.json and
 * gen<N>-learn.json files, plus evolution chains, learn-method parsing and encounter decoding.
 */
import type { Pokemon } from './types';

interface PokedexGame {
  id: string;
  name: string;
}

interface PokedexEntry {
  /** Height of the default form, in metres. */
  heightm?: number;
  /** "Seed Pokémon" */
  genus?: string;
  /** Entries from this generation's games; identical texts are merged. */
  flavor?: { games: string[]; text: string }[];
  /** When none of this generation's games has an entry: the latest earlier game's. */
  fallback?: { game: string; text: string };
  /** Regional Pokédex id → number. */
  dex?: Record<string, number>;
}

interface PokedexArea {
  /** PokeAPI location identifier (map layouts key on it). */
  loc: string;
  name: string;
  region?: string;
  /** Floor / part of the location ("B1F", "north gate"). */
  sub?: string;
}

/** [game index, area index, method index, min level, max level, rate %, condition indices]. */
type PackedEncounter = [number, number, number, number, number, number, number[]];

export interface PokedexData {
  generation: number;
  games: PokedexGame[];
  dexes: { id: string; name: string }[];
  /** Keyed by National Dex number. */
  entries: Record<string, PokedexEntry>;
  areas: PokedexArea[];
  methods: string[];
  conditions: string[];
  /** Keyed by species id. */
  encounters: Record<string, PackedEncounter[]>;
}

export interface LearnData {
  moveIndex: string[];
  /** species id → [move index, "L24,M"] */
  learn: Record<string, [number, string][]>;
}

export interface Encounter {
  game: PokedexGame;
  area: PokedexArea;
  method: string;
  minLevel: number;
  maxLevel: number;
  /** Encounter-slot share in % (sums slots of the same method and conditions). */
  rate: number;
  conditions: string[];
}

export function encountersOf(data: PokedexData, speciesId: string): Encounter[] {
  return (data.encounters[speciesId] ?? []).map(([g, a, m, min, max, rate, conds]) => ({
    game: data.games[g],
    area: data.areas[a],
    method: data.methods[m],
    minLevel: min,
    maxLevel: max,
    rate,
    conditions: conds.map((c) => data.conditions[c]),
  }));
}

// ---------------------------------------------------------------------------
// Learnsets
// ---------------------------------------------------------------------------

export type LearnMethod = 'level' | 'machine' | 'tutor' | 'egg' | 'event' | 'other';

export const LEARN_METHOD_LABELS: Record<LearnMethod, string> = {
  level: 'Level up',
  machine: 'TM / HM',
  tutor: 'Move Tutor',
  egg: 'Egg moves',
  event: 'Event only',
  other: 'Other',
};

export interface LearnedMove {
  moveId: string;
  method: LearnMethod;
  /** Level-up only; several when games in the generation differ (Red/Blue vs Yellow). */
  levels?: number[];
}

/** Expand one species' learn codes ("L24", "M", "T", "E", "S", "D", "R") into rows per method. */
export function learnedMoves(data: LearnData, speciesId: string): LearnedMove[] {
  const out: LearnedMove[] = [];
  for (const [idx, codes] of data.learn[speciesId] ?? []) {
    const moveId = data.moveIndex[idx];
    const parts = codes.split(',');
    const levels = parts.filter((c) => c[0] === 'L').map((c) => Number(c.slice(1)));
    if (levels.length) out.push({ moveId, method: 'level', levels: [...new Set(levels)].sort((a, b) => a - b) });
    if (parts.includes('M')) out.push({ moveId, method: 'machine' });
    if (parts.includes('T')) out.push({ moveId, method: 'tutor' });
    if (parts.includes('E')) out.push({ moveId, method: 'egg' });
    if (parts.some((c) => c === 'D' || c === 'R')) out.push({ moveId, method: 'other' });
    // Event moves only matter when nothing else teaches them.
    if (parts.includes('S') && parts.every((c) => c === 'S')) out.push({ moveId, method: 'event' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Evolutions
// ---------------------------------------------------------------------------

export interface EvoNode {
  species: Pokemon;
  /** How it evolves from its parent ("Level 16", "Use Thunder Stone", "Trade"…). */
  how?: string;
  children: EvoNode[];
}

/** The whole family tree a species belongs to, rooted at its earliest pre-evolution. */
export function evolutionTree(get: (id: string) => Pokemon | undefined, speciesId: string): EvoNode | undefined {
  let root = get(speciesId);
  if (!root) return undefined;
  const seen = new Set<string>();
  while (root.prevo && get(root.prevo) && !seen.has(root.prevo)) {
    seen.add(root.id);
    root = get(root.prevo)!;
  }
  const build = (sp: Pokemon, depth: number): EvoNode => ({
    species: sp,
    how: depth ? evolutionMethod(sp) : undefined,
    children: depth > 4 ? [] : (sp.evos ?? []).map((id) => get(id)).filter((x): x is Pokemon => !!x).map((c) => build(c, depth + 1)),
  });
  return build(root, 0);
}

/** Human-readable evolution requirement stored on the evolved species. */
export function evolutionMethod(sp: Pokemon): string {
  const cond = sp.evoCondition ? ` ${sp.evoCondition}` : '';
  switch (sp.evoType) {
    case 'trade':
      return sp.evoItem ? `Trade holding ${sp.evoItem}` : `Trade${cond}`;
    case 'useItem':
      return `Use ${sp.evoItem ?? 'an item'}${cond}`;
    case 'levelFriendship':
      return `Level up with high friendship${cond}`;
    case 'levelHold':
      return `Level up holding ${sp.evoItem ?? 'an item'}${cond}`;
    case 'levelMove':
      return `Level up knowing ${sp.evoMove ?? 'a move'}${cond}`;
    case 'levelExtra':
      return `Level up${cond || ' (special condition)'}`;
    case 'other':
      return sp.evoCondition ? sp.evoCondition[0].toUpperCase() + sp.evoCondition.slice(1) : 'Special condition';
    default:
      return sp.evoLevel ? `Level ${sp.evoLevel}${cond}` : `Level up${cond}`;
  }
}

/** Gender ratio as display text. */
export function genderText(sp: Pokemon): string | undefined {
  const g = sp.genderRatio;
  if (!g) return undefined;
  if (typeof g === 'string') return g === 'N' ? 'Genderless' : g === 'M' ? 'Male only' : 'Female only';
  return `${Math.round(g.M * 1000) / 10}% ♂ · ${Math.round(g.F * 1000) / 10}% ♀`;
}

// ---------------------------------------------------------------------------
// Mega Evolutions (the Champions Pokédex's Mega filter)
// ---------------------------------------------------------------------------

/** What the Mega listing needs from a dex (kept structural so this file stays free of the data layer). */
interface MegaSource {
  allSpecies(): Pokemon[];
  data: { items: Record<string, { id: string; name: string; megaStone?: Record<string, string> }> };
}

/**
 * The Mega formes legal in a regulation, in Pokédex order: by National Dex number, and a Pokémon with
 * more than one Mega (Charizard X and Y, Garchomp and Mega-Z) keeps them side by side, in forme order.
 */
export function megaList(dex: MegaSource, regulationId?: string): Pokemon[] {
  return dex
    .allSpecies()
    .filter((s) => s.isMega && (!regulationId || s.legalIn.includes(regulationId)))
    .sort((a, b) => a.num - b.num || (a.forme ?? '').localeCompare(b.forme ?? '') || a.name.localeCompare(b.name));
}

/** The Mega Stone that unlocks a Mega forme ("Charizardite X"). */
export function megaStoneName(dex: MegaSource, mega: Pokemon): string | undefined {
  return Object.values(dex.data.items).find((i) => i.megaStone && Object.values(i.megaStone).includes(mega.id))?.name;
}

/** The first regulation (from `chronological`) a Pokémon is legal in: when it arrived. */
export function introducedIn(s: Pick<Pokemon, 'legalIn'>, chronological: string[]): string | undefined {
  return chronological.find((id) => s.legalIn.includes(id));
}
