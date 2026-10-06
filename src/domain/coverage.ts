import type { Dex } from '@/data/dex';
import { activeAbility, moveTypeFor, typeMultiplier } from './abilityTypes';
import type { Move, Team, TypeName } from './types';

/** One member's best damaging move against a defending type. */
interface MemberHit {
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
  /** Of those, members whose best move has no effect at all (×0: Earthquake into a Flying type). */
  noEffect: number;
}

/**
 * Offensive type coverage: for each defending (mono-)type, how well each member's damaging moves
 * hit it. Attacking abilities count (Pixilate and the other "-ate" abilities, Scrappy, Tinted Lens); Freeze-Dry,
 * Flying Press and Tera Blast aren't modelled. Members without damaging moves are left out.
 */
export function offensiveCoverage(team: Team, dex: Dex, megaAbilities = false): OffenseRow[] {
  const members = team.slots.flatMap((s) => {
    if (!s) return [];
    const sp = dex.species(s.speciesId);
    const moves = s.moves.map((m) => dex.move(m)).filter((m) => m && m.category !== 'Status');
    return sp && moves.length ? [{ name: sp.name, ability: activeAbility(dex, s, megaAbilities), moves: moves as NonNullable<(typeof moves)[number]>[] }] : [];
  });

  // Only the types that exist in the format's generation (no Dark/Steel in Gen 1, no Fairy before Gen 6).
  return dex.types.map((defType) => {
    const hits = members.map(({ name, ability, moves }) => {
      let best: MemberHit = { name, mult: -1, move: '' };
      for (const mv of moves) {
        const mult = typeMultiplier(dex, moveTypeFor(mv.type, ability), [defType], { attacker: ability });
        if (mult > best.mult) best = { name, mult, move: mv.name };
      }
      return best;
    });
    return {
      defType,
      hits,
      superEffective: hits.filter((h) => h.mult > 1).length,
      walled: hits.filter((h) => h.mult < 1).length,
      noEffect: hits.filter((h) => h.mult === 0).length,
    };
  });
}

/** How one set's selected moves fare against a defending type. */
export interface MoveCoverageRow {
  defType: TypeName;
  /** Best multiplier among the damaging moves (0 = every move is blocked); undefined when there is no damaging move. */
  mult?: number;
  /** The moves reaching that multiplier. */
  moves: string[];
}

/**
 * Coverage of the moves currently selected on one set: for each defending (mono-)type, the best
 * multiplier among its damaging moves. Only move types count (same limits as `offensiveCoverage`).
 */
export function moveCoverage(dex: Dex, moveIds: string[], ability?: string): MoveCoverageRow[] {
  const attacks = moveIds.flatMap((id) => {
    const mv = id ? dex.move(id) : undefined;
    return mv && mv.category !== 'Status' ? [mv] : [];
  });
  return dex.types.map((defType) => {
    let mult: number | undefined;
    let moves: string[] = [];
    for (const mv of attacks) {
      const m = typeMultiplier(dex, moveTypeFor(mv.type, ability), [defType], { attacker: ability });
      if (mult === undefined || m > mult) {
        mult = m;
        moves = [mv.name];
      } else if (m === mult) moves.push(mv.name);
    }
    return { defType, mult, moves };
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
    return sp && moves.length ? [{ name: s.nickname || sp.name, ability: activeAbility(dex, s, false), moves }] : [];
  });
  return defenders.slots.flatMap((s) => {
    if (!s) return [];
    const sp = dex.species(s.speciesId);
    if (!sp) return [];
    const defAbility = activeAbility(dex, s, false);
    let best: MatchupRow['best'] = null;
    for (const a of atkMembers) {
      for (const mv of a.moves) {
        const mult = typeMultiplier(dex, moveTypeFor(mv.type, a.ability), sp.types, { attacker: a.ability, defender: defAbility });
        if (!best || mult > best.mult) best = { attacker: a.name, move: mv.name, mult };
      }
    }
    return [{ defender: s.nickname || sp.name, types: sp.types, best }];
  });
}

export interface Suggestion {
  id: string;
  /** 'tip' is an actionable fix, not a problem — shown with its own icon/colour. */
  severity: 'high' | 'medium' | 'tip';
  /** The type this suggestion is about (a problem row) or recommends (a 'tip' row) — for a type badge. */
  type: TypeName;
  /** Full sentence: a 'tip' row's own text, or a problem row's tooltip/accessible label. */
  text: string;
  /** A problem row's two counts for its compact chip, in the same left-to-right order and colour
   *  ('good'/'bad') as the matrix cell they're drawn from. Absent on a 'tip' row. */
  stats?: [{ value: number; tone: 'good' | 'bad' }, { value: number; tone: 'good' | 'bad' }];
  /** A 'tip' row's problem types it would fix, for their own small badges. Absent on a problem row. */
  related?: TypeName[];
}

const listJoin = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/** The type that would help most against a list of problem types — resisting (defense) or hitting them super-effectively (offense) — if at least 2 of them. */
function bestTypeFix(dex: Dex, problemTypes: TypeName[], relation: (candidate: TypeName, problem: TypeName) => boolean): { type: TypeName; fixes: TypeName[] } | null {
  let best: { type: TypeName; fixes: TypeName[] } | null = null;
  for (const t of dex.types) {
    const fixes = problemTypes.filter((p) => relation(t, p));
    if (fixes.length >= 2 && (!best || fixes.length > best.fixes.length)) best = { type: t, fixes };
  }
  return best;
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
      type: r.defType,
      // Same order as the matrix cell: super-effective (good) then walled (bad).
      stats: [{ value: r.superEffective, tone: 'good' }, { value: r.walled, tone: 'bad' }],
      text: gap
        ? `You have no super-effective attacks against ${r.defType}, and most of your team is resisted or walled by it — consider adding a move or Pokémon that hits it hard.`
        : `Nothing on your team hits ${r.defType} super-effectively yet, though you can still land neutral damage.`,
    });
  }
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'high' ? -1 : 1));
}

/** One move type that would hit several of the team's current coverage gaps super-effectively at once, if any does. */
export function offensiveFixSuggestion(dex: Dex, suggestions: Suggestion[]): Suggestion | null {
  const problems = suggestions.map((s) => s.type);
  const best = bestTypeFix(dex, problems, (candidate, problem) => dex.effectiveness(candidate, [problem]) > 1);
  if (!best) return null;
  return {
    id: `fix-${best.type}`,
    severity: 'tip',
    type: best.type,
    related: best.fixes,
    text: `A ${best.type}-type move would hit ${best.fixes.length} of your coverage gaps super-effectively: ${listJoin(best.fixes)}.`,
  };
}

export interface DefenseRow {
  atkType: TypeName;
  /** One entry per member: its name and the multiplier it takes from this type. */
  mults: { name: string; mult: number }[];
  /** Members hit super-effectively. */
  weak: number;
  /** Members resisting or immune (immune ones are counted here too). */
  resist: number;
  /** Members immune (×0): Fighting into a Ghost, Ground into a Flying type. A subset of `resist`. */
  immune: number;
  /** Three or more weak, or two weak and nobody resisting. */
  danger: boolean;
}

/**
 * Defensive type coverage: for each attacking type, the multiplier every member takes. Uses a
 * Mega's typing and ability when the member holds its stone and the game has Megas (`megaTyping`).
 * Abilities that change what a type does count: Levitate and the absorbing abilities are immune,
 * Thick Fat resists Fire and Ice, Fluffy is weak to Fire, and so on (src/domain/abilityTypes.ts).
 */
export function defensiveCoverage(team: Team, dex: Dex, megaTyping: boolean): DefenseRow[] {
  const mons = team.slots.flatMap((s) => {
    if (!s) return [];
    const sp = dex.species(s.speciesId);
    const mega = megaTyping ? dex.megaFor(s.speciesId, s.itemId) : undefined;
    return sp ? [{ name: (mega ?? sp).name, types: (mega ?? sp).types, ability: activeAbility(dex, s, megaTyping) }] : [];
  });
  if (!mons.length) return [];
  return dex.types.map((atkType) => {
    const mults = mons.map((m) => ({ name: m.name, mult: typeMultiplier(dex, atkType, m.types, { defender: m.ability }) }));
    const weak = mults.filter((m) => m.mult > 1).length;
    const resist = mults.filter((m) => m.mult < 1).length;
    const immune = mults.filter((m) => m.mult === 0).length;
    return { atkType, mults, weak, resist, immune, danger: weak >= 3 || (weak >= 2 && resist === 0) };
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
        type: r.atkType,
        stats: [{ value: r.weak, tone: 'bad' }, { value: r.resist, tone: 'good' }],
        text:
          r.weak >= 3
            ? `${r.atkType} is a big problem for your team: ${r.weak} of your ${memberCount} Pokémon are weak to it${r.resist ? `, and only ${r.resist} resist it` : ''}.`
            : `${r.atkType} is a real risk: ${r.weak} of your ${memberCount} Pokémon are weak to it, and none of them resist it either.`,
      });
    } else if (r.weak >= 2) {
      out.push({
        id: r.atkType,
        severity: 'medium',
        type: r.atkType,
        stats: [{ value: r.weak, tone: 'bad' }, { value: r.resist, tone: 'good' }],
        text: `${r.weak} of your Pokémon are weak to ${r.atkType}, though ${r.resist} can switch in.`,
      });
    }
  }
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'high' ? -1 : 1));
}

/** One defending type that would resist several of the team's current weaknesses at once, if any does. */
export function defensiveFixSuggestion(dex: Dex, suggestions: Suggestion[]): Suggestion | null {
  const problems = suggestions.map((s) => s.type);
  const best = bestTypeFix(dex, problems, (candidate, problem) => dex.effectiveness(problem, [candidate]) < 1);
  if (!best) return null;
  return {
    id: `fix-${best.type}`,
    severity: 'tip',
    type: best.type,
    related: best.fixes,
    text: `A ${best.type}-type Pokémon would resist ${best.fixes.length} of your weak types: ${listJoin(best.fixes)}.`,
  };
}
