/**
 * How a Champions species' move list is worked out from Showdown's data, shared by the data build
 * (scripts/build-data.ts) and the audit against upstream (scripts/audit-data.ts), so both always
 * apply the same rules.
 */
import type { Dex } from '@pkmn/dex';
import { toID } from '../../src/domain/id.ts';

export type AnyDex = ReturnType<typeof Dex.mod>;
type Species = ReturnType<AnyDex['species']['get']>;


/**
 * A species' own Showdown learnset plus what it inherits from its pre-evolutions: egg moves live on the base
 * form (Rillaboom's Fake Out is Grookey's) and level-up moves a pre-evolution learned stay with the evolution.
 * TMs/tutors don't carry over, and only Generation 9 sources count (older ones are moves Champions dropped).
 */
async function withPrevoMoves(dex: AnyDex, s: Species, own: string[]): Promise<string[]> {
  if (!own.length) return own;
  const moves = [...own];
  const have = new Set(moves);
  for (let prevo = s.prevo ? dex.species.get(s.prevo) : undefined; prevo?.exists; prevo = prevo.prevo ? dex.species.get(prevo.prevo) : undefined) {
    const ls = (await dex.learnsets.get(prevo.id))?.learnset;
    for (const [m, sources] of Object.entries(ls ?? {})) {
      if (!have.has(m) && sources.some((c) => /^9[LE]/.test(c))) {
        have.add(m);
        moves.push(m);
      }
    }
  }
  return moves;
}

/**
 * The (unfiltered) move ids of a non-Mega species: the Champions learnset, falling back to the
 * out-of-battle forme, then to the Scarlet/Violet learnset (flagged `provisional`) for Pokémon
 * Showdown hasn't covered yet.
 */
export async function learnsetFor(dex: AnyDex, gen9: AnyDex, s: Species): Promise<{ moves: string[]; provisional: boolean }> {
  const chain = [s.id, s.changesFrom && toID(s.changesFrom), toID(s.baseSpecies)].filter(Boolean) as string[];
  let moves: string[] = [];
  for (const src of chain) {
    const ls = await dex.learnsets.get(src);
    if (ls?.learnset) {
      moves = Object.keys(ls.learnset);
      break;
    }
  }
  moves = await withPrevoMoves(dex, s, moves);
  if (!moves.length) {
    for (const src of chain) {
      const ls = await gen9.learnsets.get(src);
      if (ls?.learnset) return { moves: await withPrevoMoves(gen9, s, Object.keys(ls.learnset)), provisional: true };
    }
  }
  return { moves, provisional: false };
}
