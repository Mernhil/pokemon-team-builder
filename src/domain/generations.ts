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
