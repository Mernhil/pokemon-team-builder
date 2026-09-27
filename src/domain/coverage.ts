import type { Dex } from '@/data/dex';
import { TYPE_NAMES, type Team, type TypeName } from './types';

/** One member's best damaging move against a defending type. */
export interface MemberHit {
  name: string;
  /** Highest type multiplier among the member's damaging moves (0 = immune). */
  mult: number;
  /** Move achieving it. */
  move: string;
}

export interface OffenseRow {
  defType: TypeName;
  hits: MemberHit[];
  /** Members hitting this type super-effectively. */
  superEffective: number;
  /** Members whose best move is resisted or blocked. */
  walled: number;
}

/**
 * Offensive type coverage: for each defending (mono-)type, how well each member's damaging moves
 * hit it. Only move types count — type-changing abilities (Pixilate…), Freeze-Dry, Flying Press and
 * Tera Blast aren't modelled. Members without damaging moves are left out.
 */
export function offensiveCoverage(team: Team, dex: Dex): OffenseRow[] {
  const members = team.slots.flatMap((s) => {
    if (!s) return [];
    const sp = dex.species(s.speciesId);
    const moves = s.moves.map((m) => dex.move(m)).filter((m) => m && m.category !== 'Status');
    return sp && moves.length ? [{ name: sp.name, moves: moves as NonNullable<(typeof moves)[number]>[] }] : [];
  });

  return TYPE_NAMES.map((defType) => {
    const hits = members.map(({ name, moves }) => {
      let best: MemberHit = { name, mult: -1, move: '' };
      for (const mv of moves) {
        const mult = dex.effectiveness(mv.type, [defType]);
        if (mult > best.mult) best = { name, mult, move: mv.name };
      }
      return best;
    });
    return {
      defType,
      hits,
      superEffective: hits.filter((h) => h.mult > 1).length,
      walled: hits.filter((h) => h.mult < 1).length,
    };
  });
}
