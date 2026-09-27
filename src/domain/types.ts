/**
 * Core domain model.
 *
 * Two layers:
 *  - Static data (Pokemon, Move, Ability, Item, Nature) — read-only, loaded from a Dataset.
 *  - User data (PokemonSet, Team) — editable, persisted.
 *
 * The stat system is a discriminated union on FormatRules.statSystem so that Champions SP,
 * modern EVs (Gen 3–9) and Game Boy Stat Exp / DVs (Gen 1–2) share one pipeline.
 */

export const STAT_IDS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const;
export type StatId = (typeof STAT_IDS)[number];
export type StatTable<T = number> = Record<StatId, T>;

export const STAT_LABELS: StatTable<string> = {
  hp: 'HP',
  atk: 'Atk',
  def: 'Def',
  spa: 'SpA',
  spd: 'SpD',
  spe: 'Spe',
};

export const TYPE_NAMES = [
  'Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice', 'Fighting', 'Poison', 'Ground',
  'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy',
] as const;
export type TypeName = (typeof TYPE_NAMES)[number];
export type TeraType = TypeName | 'Stellar';

// ---------------------------------------------------------------------------
// Static data
// ---------------------------------------------------------------------------

export type AbilitySlot = '0' | '1' | 'H' | 'S';

export interface Pokemon {
  id: string;
  /** National Dex number — used for Species Clause. */
  num: number;
  name: string;
  baseSpecies: string;
  forme?: string;
  /** Generation the species/forme was introduced in (drives the generation symbol). */
  gen: number;
  types: TypeName[];
  baseStats: StatTable;
  abilities: Partial<Record<AbilitySlot, string>>;
  weightkg: number;
  isMega: boolean;
  /** For battle-only formes (Megas): the out-of-battle species id. */
  battleOnly?: string;
  /** Item needed to use this forme (Mega Stones). */
  requiredItem?: string;
  /** Ids of Mega formes reachable from this species. */
  megaForms: string[];
  /** Regulation ids in which this species is legal. */
  legalIn: string[];
  /** True when the learnset fell back to Scarlet/Violet data (Showdown hasn't covered it yet). */
  provisionalLearnset?: boolean;
}

export type MoveCategory = 'Physical' | 'Special' | 'Status';

export interface Move {
  id: string;
  name: string;
  type: TypeName;
  category: MoveCategory;
  basePower: number;
  accuracy: number | true;
  pp: number;
  priority: number;
  target: string;
  shortDesc: string;
  contact: boolean;
  /** Move flags that abilities/items key off (Sharpness, Iron Fist, Strong Jaw, Mega Launcher, Punk Rock…). */
  flags: Partial<Record<'slicing' | 'punch' | 'bite' | 'pulse' | 'sound' | 'wind', true>>;
  /** Has recoil/crash damage (Reckless). */
  recoil?: boolean;
  /** Has a secondary effect (Sheer Force). */
  secondary?: boolean;
  multihit?: number | [number, number];
  /** Regulation ids in which this move is usable. */
  legalIn: string[];
}

export interface Ability {
  id: string;
  name: string;
  shortDesc: string;
}

export interface Item {
  id: string;
  name: string;
  shortDesc: string;
  /** base species id -> mega species id */
  megaStone?: Record<string, string>;
  legalIn: string[];
}

export interface Nature {
  name: string;
  plus?: StatId;
  minus?: StatId;
}

/** Defender type -> attacking type -> multiplier (0, 0.5, 1, 2). */
export type TypeChart = Record<TypeName, Record<TypeName, number>>;

export interface RegulationInfo {
  id: string;
  name: string;
  shortName: string;
  game: string;
  /** ISO start/end timestamps (UTC). */
  start: string;
  end?: string;
  speciesCount: number;
  megaCount: number;
  itemCount: number;
  sources: string[];
  updatedAt?: string;
}

export interface UpcomingRegulation {
  id: string;
  name: string;
  start: string;
  end?: string;
  summary?: string;
  sources?: string[];
}

export interface RegulationManifest {
  generatedAt: string;
  regulations: RegulationInfo[];
  upcoming: UpcomingRegulation[];
  lastChecked?: string;
}

export interface Dataset {
  id: string;
  generatedAt: string;
  source: string;
  regulations: RegulationInfo[];
  species: Record<string, Pokemon>;
  learnsets: Record<string, string[]>;
  moves: Record<string, Move>;
  abilities: Record<string, Ability>;
  items: Record<string, Item>;
  natures: Nature[];
  typeChart: TypeChart;
}

// ---------------------------------------------------------------------------
// Spreads
// ---------------------------------------------------------------------------

/** Champions Stat Points: 0–32 per stat, 66 total. 1 SP = +1 stat at Lv 50. */
export type StatPoints = StatTable;
/** Gen 3–9 Effort Values: 0–252 per stat, 510 total. */
export type EVSpread = StatTable;
/** Individual Values: 0–31. */
export type IVSpread = StatTable;
/** Gen 1–2 Determinant Values: 0–15 (HP DV is derived from the others). */
export type DVSpread = Omit<StatTable, 'hp'> & { hp?: never };
/** Gen 1–2 Stat Experience: 0–65535 per stat. */
export type StatExpSpread = StatTable;

// ---------------------------------------------------------------------------
// Format rules
// ---------------------------------------------------------------------------

export type StatSystem =
  | {
      kind: 'champions-sp';
      totalCap: number; // 66
      perStatCap: number; // 32
    }
  | {
      kind: 'modern-ev';
      totalCap: number; // 510
      perStatCap: number; // 252
      ivMax: number; // 31
    }
  | {
      kind: 'gb-statexp';
      statExpMax: number; // 65535
      dvMax: number; // 15
    };

export interface FormatRules {
  id: string;
  name: string;
  /** Short label for badges / categories, e.g. "Reg M-B". */
  shortName: string;
  generation: number;
  /** Which Dataset to load. */
  datasetId: string;
  /** Sprite set used for this format (see src/data/sprites.ts). */
  spriteSet: SpriteSetId;
  /** Regulation id used for legality checks (matches Pokemon.legalIn / Item.legalIn). */
  regulationId?: string;
  statSystem: StatSystem;
  level: { fixed?: number; min: number; max: number; default: number };
  /** When set, IVs are locked to this value (Champions: 31). */
  fixedIVs?: number;
  teamSize: number;
  bring?: number;
  pick?: number;
  gameType: 'singles' | 'doubles';
  clauses: {
    species: boolean;
    item: boolean;
  };
  gimmicks: {
    mega: boolean;
    tera: boolean;
  };
  openTeamList: boolean;
  /** Formats not yet backed by data are listed but disabled in the UI. */
  available: boolean;
}

// ---------------------------------------------------------------------------
// User data
// ---------------------------------------------------------------------------

export interface PokemonSet {
  uid: string;
  speciesId: string;
  nickname?: string;
  abilityId?: string;
  itemId?: string;
  nature: string;
  teraType?: TeraType;
  /** Always length 4; empty string = empty move slot. */
  moves: [string, string, string, string];
  level: number;
  /** Champions SP (used when statSystem.kind === 'champions-sp'). */
  sp: StatPoints;
  /** Legacy spreads (Gen 1–9). Kept alongside so switching formats is lossless. */
  evs: EVSpread;
  ivs: IVSpread;
  gender?: 'M' | 'F';
  shiny?: boolean;
}

export type TeamSlots = [
  PokemonSet | null,
  PokemonSet | null,
  PokemonSet | null,
  PokemonSet | null,
  PokemonSet | null,
  PokemonSet | null,
];

export interface Team {
  id: string;
  name: string;
  formatId: string;
  /** Free-form category, e.g. "Champions Reg M-B", "Gen 4 Playthrough". */
  category?: string;
  notes?: string;
  /** In-game Champions Replica Team code (10 chars) — stored as metadata. */
  replicaCode?: string;
  slots: TeamSlots;
  createdAt: number;
  updatedAt: number;
}

export type SpriteSetId =
  | 'champions'
  | 'gen1' | 'gen2' | 'gen3' | 'gen4' | 'gen5' | 'gen6' | 'gen7' | 'gen8' | 'gen9';

export const emptyStats = (v = 0): StatTable => ({ hp: v, atk: v, def: v, spa: v, spd: v, spe: v });
