import type { Dex } from '@/data/dex';
import type { Move, Team, TypeName } from './types';

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

  // Only the types that exist in the format's generation (no Dark/Steel in Gen 1, no Fairy before Gen 6).
  return dex.types.map((defType) => {
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

export interface MatchupRow {
  defender: string;
  types: TypeName[];
  /** The attacking team's single best hit on this defender, or null with no damaging moves at all. */
  best: { attacker: string; move: string; mult: number } | null;
}

/**
 * Head-to-head coverage: for each member of `defenders`, the hardest hit anything on `attackers`
 * can land on it (across both its types), using its actual movepool rather than a generic per-type
 * summary. Used to compare two built teams (e.g. the Matches tab's Your Team vs Enemy Team).
 */
export function teamVsTeam(attackers: Team, defenders: Team, dex: Dex): MatchupRow[] {
  const atkMembers = attackers.slots.flatMap((s) => {
    if (!s) return [];
    const sp = dex.species(s.speciesId);
    const moves = s.moves.map((m) => dex.move(m)).filter((m): m is Move => !!m && m.category !== 'Status');
    return sp && moves.length ? [{ name: s.nickname || sp.name, moves }] : [];
  });
  return defenders.slots.flatMap((s) => {
    if (!s) return [];
    const sp = dex.species(s.speciesId);
    if (!sp) return [];
    let best: MatchupRow['best'] = null;
    for (const a of atkMembers) {
      for (const mv of a.moves) {
        const mult = dex.effectiveness(mv.type, sp.types);
        if (!best || mult > best.mult) best = { attacker: a.name, move: mv.name, mult };
      }
    }
    return [{ defender: s.nickname || sp.name, types: sp.types, best }];
  });
}

export interface Suggestion {
  id: string;
  severity: 'high' | 'medium';
  text: string;
}

/**
 * Plain-language read of the offensive matrix: types nobody on the team threatens. Ranked worst
 * first (no super-effective hit and most of the team is resisted/walled, before no hit but some
 * neutral damage still gets through).
 */
export function offensiveSuggestions(rows: OffenseRow[]): Suggestion[] {
  const out: Suggestion[] = [];
  // Fewer than 3 attackers: a type-coverage gap is expected, not yet worth flagging.
  if ((rows[0]?.hits.length ?? 0) < 3) return out;
  for (const r of rows) {
    if (!r.hits.length || r.superEffective > 0) continue;
    const gap = r.walled * 2 >= r.hits.length;
    out.push({
      id: r.defType,
      severity: gap ? 'high' : 'medium',
      text: gap
        ? `You have no super-effective attacks against ${r.defType}, and most of your team is resisted or walled by it — consider adding a move or Pokémon that hits it hard.`
        : `Nothing on your team hits ${r.defType} super-effectively yet, though you can still land neutral damage.`,
    });
  }
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'high' ? -1 : 1));
}

export interface DefenseRow {
  atkType: TypeName;
  /** One entry per member: its name and the multiplier it takes from this type. */
  mults: { name: string; mult: number }[];
  /** Members hit super-effectively. */
  weak: number;
  /** Members resisting or immune. */
  resist: number;
  /** Three or more weak, or two weak and nobody resisting. */
  danger: boolean;
}

/**
 * Defensive type coverage: for each attacking type, the multiplier every member takes. Uses a
 * Mega's typing when the member holds its stone and the game has Megas (`megaTyping`). Abilities
 * (Levitate…) aren't applied.
 */
export function defensiveCoverage(team: Team, dex: Dex, megaTyping: boolean): DefenseRow[] {
  const mons = team.slots.flatMap((s) => {
    if (!s) return [];
    const sp = dex.species(s.speciesId);
    const mega = megaTyping ? dex.megaFor(s.speciesId, s.itemId) : undefined;
    return sp ? [{ name: (mega ?? sp).name, types: (mega ?? sp).types }] : [];
  });
  if (!mons.length) return [];
  return dex.types.map((atkType) => {
    const mults = mons.map((m) => ({ name: m.name, mult: dex.effectiveness(atkType, m.types) }));
    const weak = mults.filter((m) => m.mult > 1).length;
    const resist = mults.filter((m) => m.mult < 1).length;
    return { atkType, mults, weak, resist, danger: weak >= 3 || (weak >= 2 && resist === 0) };
  });
}

/**
 * Plain-language read of the defensive matrix: types that threaten a real chunk of the team.
 * Ranked worst first (danger rows — 3+ weak, or 2+ weak with no one to switch in — before a
 * smaller weakness that still has an answer on the team).
 */
export function defensiveSuggestions(rows: DefenseRow[], memberCount: number): Suggestion[] {
  const out: Suggestion[] = [];
  for (const r of rows) {
    if (r.weak === 0 || memberCount < 2) continue;
    if (r.danger) {
      out.push({
        id: r.atkType,
        severity: 'high',
        text:
          r.weak >= 3
            ? `${r.atkType} is a big problem for your team: ${r.weak} of your ${memberCount} Pokémon are weak to it${r.resist ? `, and only ${r.resist} resist it` : ''}.`
            : `${r.atkType} is a real risk: ${r.weak} of your ${memberCount} Pokémon are weak to it, and none of them resist it either.`,
      });
    } else if (r.weak >= 2) {
      out.push({ id: r.atkType, severity: 'medium', text: `${r.weak} of your Pokémon are weak to ${r.atkType}, though ${r.resist} can switch in.` });
    }
  }
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'high' ? -1 : 1));
}
