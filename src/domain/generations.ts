/** Generation metadata used for symbols, filters and sprite-set selection. */
export interface GenerationInfo {
  gen: number;
  numeral: string;
  region: string;
  games: string;
  /** Colour taken from the generation's flagship version. */
  color: string;
  /** Last National Dex number introduced in this generation. */
  lastDexNum: number;
}

export const GENERATIONS: GenerationInfo[] = [
  { gen: 1, numeral: 'I', region: 'Kanto', games: 'Red · Blue · Yellow', color: '#e0452f', lastDexNum: 151 },
  { gen: 2, numeral: 'II', region: 'Johto', games: 'Gold · Silver · Crystal', color: '#c49a1c', lastDexNum: 251 },
  { gen: 3, numeral: 'III', region: 'Hoenn', games: 'Ruby · Sapphire · Emerald', color: '#23a067', lastDexNum: 386 },
  { gen: 4, numeral: 'IV', region: 'Sinnoh', games: 'Diamond · Pearl · Platinum', color: '#5a7ed4', lastDexNum: 493 },
  { gen: 5, numeral: 'V', region: 'Unova', games: 'Black · White', color: '#5b6172', lastDexNum: 649 },
  { gen: 6, numeral: 'VI', region: 'Kalos', games: 'X · Y', color: '#1f8fd6', lastDexNum: 721 },
  { gen: 7, numeral: 'VII', region: 'Alola', games: 'Sun · Moon', color: '#ee8a1f', lastDexNum: 809 },
  { gen: 8, numeral: 'VIII', region: 'Galar', games: 'Sword · Shield', color: '#d23c74', lastDexNum: 905 },
  { gen: 9, numeral: 'IX', region: 'Paldea', games: 'Scarlet · Violet', color: '#8e4fd1', lastDexNum: 1025 },
];

export const genInfo = (gen: number): GenerationInfo => GENERATIONS[Math.max(1, Math.min(9, gen)) - 1];

/** Generation that introduced a National Dex number (ignores later formes). */
export const genOfDexNum = (num: number): number => GENERATIONS.find((g) => num <= g.lastDexNum)?.gen ?? 9;

/** What a generation's battles had. Champions uses Gen 9 mechanics. */
export interface Mechanics {
  gen: number;
  abilities: boolean;
  natures: boolean;
  heldItems: boolean;
  /** Separate Sp. Atk / Sp. Def base stats (Gen 1 had one Special stat). */
  splitSpecial: boolean;
  /** Physical/special decided per move (Gen 4+) instead of by type. */
  moveCategorySplit: boolean;
  doubles: boolean;
  weather: boolean;
  /** Hail until Gen 8; Snow from Gen 9. */
  snowName: 'Hail' | 'Snow';
  terrain: boolean;
  psychicTerrain: boolean;
  trickRoom: boolean;
  gravity: boolean;
  tailwind: boolean;
  auroraVeil: boolean;
  helpingHand: boolean;
  friendGuard: boolean;
  hiddenAbilities: boolean;
}

export function mechanics(gen: number): Mechanics {
  return {
    gen,
    abilities: gen >= 3,
    natures: gen >= 3,
    heldItems: gen >= 2,
    splitSpecial: gen >= 2,
    moveCategorySplit: gen >= 4,
    doubles: gen >= 3,
    weather: gen >= 2,
    snowName: gen >= 9 ? 'Snow' : 'Hail',
    terrain: gen >= 6,
    psychicTerrain: gen >= 7,
    trickRoom: gen >= 4,
    gravity: gen >= 4,
    tailwind: gen >= 4,
    auroraVeil: gen >= 7,
    helpingHand: gen >= 3,
    friendGuard: gen >= 5,
    hiddenAbilities: gen >= 5,
  };
}

/** Main-series games each Gen format covers (the Pokédex and Area maps use these). */
export const GEN_GAMES: Record<number, string> = {
  1: 'Red · Blue · Yellow',
  2: 'Gold · Silver · Crystal',
  3: 'Ruby · Sapphire · Emerald · FireRed · LeafGreen',
  4: 'Diamond · Pearl · Platinum · HeartGold · SoulSilver',
  5: 'Black · White · Black 2 · White 2',
  6: 'X · Y · Omega Ruby · Alpha Sapphire',
  7: 'Sun · Moon · Ultra Sun · Ultra Moon',
  8: 'Sword · Shield (+ Isle of Armor, Crown Tundra)',
  9: 'Scarlet · Violet (+ Teal Mask, Indigo Disk)',
};
