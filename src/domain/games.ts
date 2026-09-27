/**
 * Main-series games that aren't their generation's "main" pair. Each has its own dataset (roster,
 * movepools; scripts/build-games.ts), its own Pokédex book and, where it differs, its own rules.
 */
import { GEN_GAMES, GENERATIONS, mechanics, type Mechanics } from './generations';
import type { FormatRules, SpriteSetId, StatSystem } from './types';

export interface GameInfo {
  id: 'lgpe' | 'bdsp' | 'pla' | 'za';
  name: string;
  shortName: string;
  generation: number;
  region: string;
  /** Flagship colour for the badge. */
  color: string;
  spriteSet: SpriteSetId;
  statSystem: StatSystem;
  /** What the game changes relative to its generation's mechanics. */
  rules: Partial<Mechanics> & {
    /** Held items: all, or only the Mega Stone in the bag (Let's Go). */
    heldItems?: boolean;
    megaStoneOnly?: boolean;
  };
  mega: boolean;
  /**
   * Whether the damage calculator can model its battles. Legends: Arceus (Agile/Strong Styles, action
   * order) and Legends: Z-A (real-time battles) aren't turn-based Showdown mechanics.
   */
  battleSim: boolean;
  /** One line on what's different, for the format banner. */
  summary: string;
}

const EV: StatSystem = { kind: 'modern-ev', totalCap: 510, perStatCap: 252, ivMax: 31 };

export const GAMES: GameInfo[] = [
  {
    id: 'lgpe',
    name: "Let's Go, Pikachu! / Let's Go, Eevee!",
    shortName: "Let's Go",
    generation: 7,
    region: 'Kanto',
    color: '#f2c12e',
    spriteSet: 'gen7',
    statSystem: { kind: 'lgpe-av', avMax: 200, ivMax: 31 },
    rules: { abilities: false, hiddenAbilities: false, heldItems: false, megaStoneOnly: true, terrain: false, auroraVeil: false },
    mega: true,
    battleSim: true,
    summary: 'The 151 Kanto Pokémon + Meltan, Alolan forms and Megas; AVs 0–200 and friendship instead of EVs; no abilities or held items',
  },
  {
    id: 'bdsp',
    name: 'Brilliant Diamond / Shining Pearl',
    shortName: 'BDSP',
    generation: 8,
    region: 'Sinnoh',
    color: '#3f7fd8',
    spriteSet: 'gen8',
    statSystem: EV,
    rules: {},
    mega: false,
    battleSim: true,
    summary: 'The Sinnoh remakes: Gen 1–4 Pokémon with Sword/Shield mechanics, no Dynamax',
  },
  {
    id: 'pla',
    name: 'Legends: Arceus',
    shortName: 'Legends: Arceus',
    generation: 8,
    region: 'Hisui',
    color: '#8a6d3b',
    spriteSet: 'gen8',
    statSystem: { kind: 'pla-effort', levelMax: 10 },
    rules: { abilities: false, hiddenAbilities: false, heldItems: false },
    mega: false,
    battleSim: false,
    summary: 'Hisui: Effort Levels 0–10 instead of EVs; no abilities or held items; Agile/Strong Style battles',
  },
  {
    id: 'za',
    name: 'Legends: Z-A',
    shortName: 'Legends: Z-A',
    generation: 9,
    region: 'Lumiose City',
    color: '#2bb673',
    spriteSet: 'gen9',
    statSystem: EV,
    rules: { abilities: false, hiddenAbilities: false },
    mega: true,
    battleSim: false,
    summary: 'Lumiose City and the Mega Dimension: new Mega Evolutions, no abilities, real-time battles',
  },
];

export const gameInfo = (id?: string): GameInfo | undefined => GAMES.find((g) => g.id === id);

/** Mechanics for a format: its generation's, with its game's differences applied. */
export function formatMechanics(format: Pick<FormatRules, 'generation' | 'game'>): Mechanics & { megaStoneOnly: boolean; battleSim: boolean } {
  const game = gameInfo(format.game);
  return { ...mechanics(format.generation), megaStoneOnly: false, battleSim: true, ...game?.rules, ...(game ? { battleSim: game.battleSim } : {}) };
}

/** Mechanics for a dataset id (gen1…gen9, champions, lgpe, bdsp, pla, za). */
export function datasetMechanics(datasetId: string, generation: number) {
  return formatMechanics({ generation, game: gameInfo(datasetId)?.id });
}

/**
 * Pokédex books: one per generation (its main games) and one per other main-series game, each with its
 * own dataset (roster, movepools), Pokédex file and sprite style.
 */
export interface DexBook {
  /** Dataset / Pokédex file id: gen1…gen9, lgpe, bdsp, pla, za. */
  id: string;
  gen: number;
  /** Short chip label ("Kanto", "Let's Go"). */
  label: string;
  region: string;
  games: string;
  spriteSet: SpriteSetId;
  color: string;
  game?: GameInfo['id'];
}

export const BOOKS: DexBook[] = [
  ...GENERATIONS.map((g) => ({
    id: `gen${g.gen}`,
    gen: g.gen,
    label: g.region,
    region: g.region,
    games: GEN_GAMES[g.gen],
    spriteSet: `gen${g.gen}` as SpriteSetId,
    color: g.color,
  })),
  ...GAMES.map((g) => ({ id: g.id, gen: g.generation, label: g.shortName, region: g.region, games: g.name, spriteSet: g.spriteSet, color: g.color, game: g.id })),
];

export const bookInfo = (id?: string): DexBook => BOOKS.find((b) => b.id === id) ?? BOOKS[8];

/** The book that matches a format (Champions reads the Scarlet/Violet book). */
export const bookForFormat = (format: Pick<FormatRules, 'datasetId' | 'generation' | 'game'>): DexBook =>
  bookInfo(format.game ?? (format.datasetId === 'champions' ? 'gen9' : `gen${format.generation}`));
