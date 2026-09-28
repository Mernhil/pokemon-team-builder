/**
 * Per-game battle mechanics ("gimmicks"), keyed by dataset id — each dataset is one game or one
 * generation's main games (gen9 = Scarlet/Violet, za = Legends: Z-A, champions = Pokémon Champions…).
 *
 * Every piece of UI, import/export and calculator input that touches a gimmick asks this one table,
 * so enabling a mechanic for a game (or a new game) is a one-line change here.
 */
import type { PokemonSet } from './types';

export interface Capabilities {
  /** Terastallization: Scarlet/Violet only. */
  tera: boolean;
  /** Mega Evolution: X/Y/ORAS, Sun/Moon/USUM, Let's Go, Legends: Z-A and Champions. */
  mega: boolean;
  /** Z-Moves: Sun/Moon/USUM. Informational — the damage calculator doesn't model them. */
  zMoves: boolean;
  /** Dynamax/Gigantamax: Sword/Shield. Informational — the damage calculator doesn't model it. */
  dynamax: boolean;
}

const NONE: Capabilities = { tera: false, mega: false, zMoves: false, dynamax: false };

/** Only what each game adds; everything not listed is off. */
const BY_DATASET: Record<string, Partial<Capabilities>> = {
  champions: { mega: true },
  gen6: { mega: true },
  gen7: { mega: true, zMoves: true },
  gen8: { dynamax: true },
  gen9: { tera: true },
  lgpe: { mega: true },
  za: { mega: true },
};

export function datasetCapabilities(datasetId: string): Capabilities {
  return { ...NONE, ...(Object.hasOwn(BY_DATASET, datasetId) ? BY_DATASET[datasetId] : {}) };
}

/** Z-Crystals (Gen 7): Showdown ids all end in "iumz" (Firium Z, Pikanium Z…). */
export const isZCrystal = (itemId?: string): boolean => !!itemId && /iumz$/.test(itemId);

/**
 * Drops data the game can't have (a Tera Type outside Scarlet/Violet). Returns the same object when
 * nothing changes, so it's cheap to run on every store update.
 */
export function stripUnsupported(set: PokemonSet, caps: Capabilities): PokemonSet {
  if (caps.tera || set.teraType === undefined) return set;
  const { teraType: _dropped, ...rest } = set;
  return rest;
}
