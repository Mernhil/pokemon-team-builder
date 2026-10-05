/**
 * Bring-4 planner: given my team and an opponent's six, suggest which Pokémon to bring and lead,
 * with reasons in plain language. Pure and React-free. It is a suggestion, not a prediction: it
 * scores every legal choice with the same damage and speed numbers as the Threat report
 * (src/domain/threats.ts), then explains the best three.
 *
 * Scoring (all weights are in WEIGHTS below):
 *  - pressure and risk: how hard my four can hit what they are likely to bring, and how hard that hits back;
 *  - tempo: who moves first, and whether that is followed by a real KO threat;
 *  - coverage: type coverage of my four's moves against their six;
 *  - speed control: Tailwind, Trick Room, Icy Wind / Electroweb, and whether they flip the matchup;
 *  - support: Fake Out, Intimidate, redirection, Wide Guard;
 *  - the Mega rule: only one Pokémon can Mega Evolve per battle, so two Mega Stone holders may both
 *    come, but only one of them gets its Mega stats in any one plan.
 */
import type { Dex } from '@/data/dex';
import { activeAbility, moveTypeFor, typeMultiplier } from './abilityTypes';
import { defaultField, type FieldConditions, type MegaMode } from './battle/conditions';
import { metaSet } from './metaSets';
import type { BringLimits, LoggedMon, Match } from './matches';
import type { MetaSnapshot } from './meta';
import { createSet } from './team';
import { computeCell, killRank, type ThreatCell } from './threats';
import type { FormatRules, PokemonSet } from './types';

/** Every tunable number of the planner, in one place. */
export const WEIGHTS = {
  /** How hard my four hits what they are likely to bring (0–1 per opponent). */
  pressure: 3,
  /** How hard what they bring hits my four; subtracted. */
  risk: 3,
  /** Moving first, with a real KO threat. */
  tempo: 1.5,
  /** Type coverage against their six. */
  coverage: 1,
  speedControl: 1,
  support: 1,
  /** The lead pair's own score (damage, tempo and support against their likely lead) counts this much on top of the four's. */
  lead: 2,
} as const;

/** How much an opponent counts in the score: the ones most dangerous to me (the "likely four") weigh fully. */
export const LIKELY_WEIGHT = 1;
export const UNLIKELY_WEIGHT = 0.4;
/** Each distinct support (Fake Out, Intimidate…) is worth this much of the 0–1 support score. */
export const SUPPORT_STEP = 0.4;

// ---------------------------------------------------------------------------
// The opponent's Pokémon
// ---------------------------------------------------------------------------

export interface OppMon {
  speciesId: string;
  set: PokemonSet;
  megaMode: MegaMode;
  /** How much of the set came from what is actually known (a pasted team, or the match log) rather than the meta. */
  known: 'full' | 'partial' | 'none';
}

/** A species the meta has no data for: its four hardest-hitting legal moves, so it can still be calculated. */
function fallbackSet(dex: Dex, speciesId: string, format: FormatRules): PokemonSet {
  const base = createSet(dex, speciesId, format);
  const moves = dex
    .learnset(speciesId, format.regulationId)
    .filter((m) => m.category !== 'Status')
    .sort((a, b) => b.basePower - a.basePower || a.id.localeCompare(b.id))
    .slice(0, 4)
    .map((m) => m.id);
  return { ...base, moves: [...moves, '', '', '', ''].slice(0, 4) as PokemonSet['moves'] };
}

/**
 * The opponent's Pokémon as a set to calculate: its meta set, unless more is known. A full set (a
 * pasted team, a saved enemy team) is used as it is; details from the match log override the meta
 * set field by field (known moves first, then the meta's remaining moves to fill four).
 */
export function resolveOpponent(
  dex: Dex,
  format: FormatRules,
  speciesId: string,
  opts: { known?: Pick<LoggedMon, 'itemId' | 'abilityId' | 'moves'>; full?: PokemonSet; snapshot?: MetaSnapshot } = {},
): OppMon | undefined {
  const species = dex.species(speciesId);
  if (!species) return undefined;
  const mega = (set: PokemonSet): MegaMode => (dex.megaFor(set.speciesId, set.itemId) ? 'both' : 'base');
  if (opts.full) return { speciesId: species.id, set: opts.full, megaMode: mega(opts.full), known: 'full' };

  const entry = opts.snapshot?.entries.find((e) => e.speciesId === species.id);
  const meta = entry ? metaSet(entry, dex, format) : undefined;
  let set = meta?.set ?? fallbackSet(dex, species.id, format);

  const k = opts.known;
  const knownMoves = (k?.moves ?? []).filter((m) => dex.move(m));
  const any = !!(k?.itemId || k?.abilityId || knownMoves.length);
  if (k) {
    const moves = [...new Set([...knownMoves, ...set.moves.filter(Boolean)])].slice(0, 4);
    set = {
      ...set,
      itemId: k.itemId && dex.item(k.itemId) ? k.itemId : set.itemId,
      abilityId: k.abilityId && dex.ability(k.abilityId) ? k.abilityId : set.abilityId,
      moves: knownMoves.length ? ([...moves, '', '', '', ''].slice(0, 4) as PokemonSet['moves']) : set.moves,
    };
  }
  return { speciesId: species.id, set, megaMode: mega(set), known: any ? 'partial' : 'none' };
}

// ---------------------------------------------------------------------------
// Where the opponent's six come from
// ---------------------------------------------------------------------------

/** One of the opponent's six as entered: just a species, or with what is known about it (the match log, a pasted or saved set). */
export interface OppSource {
  speciesId: string;
  known?: Pick<LoggedMon, 'itemId' | 'abilityId' | 'moves'>;
  full?: PokemonSet;
}

/** The opponent's six from a logged match's Team Preview (with whatever was seen of each). */
export const sourcesFromLog = (mons: LoggedMon[]): OppSource[] =>
  mons.filter((m) => m.speciesId).map((m) => ({ speciesId: m.speciesId, known: { itemId: m.itemId, abilityId: m.abilityId, moves: m.moves } }));

/** The opponent's six from a saved (enemy) team: complete sets. */
export const sourcesFromTeam = (team: { slots: (PokemonSet | null)[] }): OppSource[] => team.slots.flatMap((s) => (s ? [{ speciesId: s.speciesId, full: s }] : []));

// ---------------------------------------------------------------------------
// Enumeration
// ---------------------------------------------------------------------------

/** All ways to choose `k` of `n` indexes, in a stable order. */
export function combinations(n: number, k: number): number[][] {
  const out: number[][] = [];
  const pick = (start: number, acc: number[]) => {
    if (acc.length === k) {
      out.push(acc);
      return;
    }
    for (let i = start; i < n; i++) pick(i + 1, [...acc, i]);
  };
  pick(0, []);
  return out;
}

/** Every (brought set, lead choice) the planner scores: C(n, bring) sets × C(bring, lead) leads. */
export function enumerateBrings(n: number, limits: BringLimits): { brought: number[]; leads: number[] }[] {
  const bring = Math.min(limits.bring, n);
  const lead = Math.min(limits.lead, bring);
  return combinations(n, bring).flatMap((brought) => combinations(bring, lead).map((l) => ({ brought, leads: l.map((i) => brought[i]) })));
}

/** Who may Mega in a four: nobody, or exactly one holder. Two Mega Stone holders can both come, but never both Mega. */
export function megaOptions(holders: number[]): (number | undefined)[] {
  return [undefined, ...holders];
}

// ---------------------------------------------------------------------------
// Support and speed control
// ---------------------------------------------------------------------------

import { controlOf, supportOf } from './roles';
export { controlOf, supportOf, type ControlKind, type SupportKind } from './roles';

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

export interface MyMon {
  uid: string;
  set: PokemonSet;
}

export interface Parts {
  pressure: number;
  risk: number;
  tempo: number;
  coverage: number;
  speedControl: number;
  support: number;
  /** The lead pair's own score. */
  lead: number;
}

export interface Plan {
  /** Pokémon uids: the four (or three) brought, the lead, and the rest. */
  brought: string[];
  leads: string[];
  back: string[];
  /** The one that Mega Evolves, if any. */
  mega?: string;
  score: number;
  parts: Parts;
  /** Two to four short reasons, then the main risk. */
  reasons: string[];
  risk: string;
}

export interface PlanResult {
  /** The best three plans, each with a different set of Pokémon brought. */
  plans: Plan[];
  /** Their Pokémon the plan treats as probably coming: the ones most dangerous to my team. */
  likelyBring: string[];
  likelyLeads: string[];
  /** Each of my Pokémon (rows, in `mine` order) against each of theirs (columns, in `opponents` order), as themselves. */
  matrix: ThreatCell[][];
}

export interface PlanInput {
  dex: Dex;
  format: FormatRules;
  mine: MyMon[];
  opponents: OppMon[];
  limits: BringLimits;
  field?: FieldConditions;
}

interface Cells {
  base: ThreatCell;
  mega?: ThreatCell;
}

const nameOf = (dex: Dex, id: string) => dex.species(id)?.name ?? id;
const listJoin = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

export function planBring(input: PlanInput): PlanResult {
  const { dex, mine, opponents, limits } = input;
  const field = input.field ?? defaultField();
  if (mine.length === 0 || opponents.length === 0) return { plans: [], likelyBring: [], likelyLeads: [], matrix: [] };

  const holders = mine.map((m) => !!dex.megaFor(m.set.speciesId, m.set.itemId));
  // cells[i][o]: my Pokémon i against their o, as itself and (for a Mega Stone holder) Mega Evolved.
  const cells: Cells[][] = mine.map((m, i) =>
    opponents.map((o) => ({
      base: computeCell(dex, m.set, o, field, 'base'),
      mega: holders[i] ? computeCell(dex, m.set, o, field, 'mega') : undefined,
    })),
  );
  const cellOf = (i: number, o: number, mega: boolean) => (mega && cells[i][o].mega ? cells[i][o].mega! : cells[i][o].base);

  // Who they will probably bring: the four most dangerous to my team (Mega forme for my holders).
  const danger = opponents.map((_, o) => mine.reduce((a, _m, i) => a + Math.max(0, -cellOf(i, o, true).verdict), 0));
  const order = opponents.map((_, o) => o).sort((a, b) => danger[b] - danger[a] || a - b);
  const likely = new Set(order.slice(0, Math.min(4, opponents.length)));
  const likelyLeads = order.slice(0, Math.min(2, opponents.length));
  const weight = (o: number) => (likely.has(o) ? LIKELY_WEIGHT : UNLIKELY_WEIGHT);
  const totalWeight = opponents.reduce((a, _o, o) => a + weight(o), 0);
  const norm = (sum: number) => sum / totalWeight;

  // Type coverage of each of my Pokémon's damaging moves against each of their Pokémon.
  const coverage = mine.map((m) =>
    opponents.map((o) => {
      const types = dex.species(o.speciesId)?.types ?? [];
      const mine = activeAbility(dex, m.set, false);
      const theirs = activeAbility(dex, o.set, o.megaMode !== 'base');
      let top = 0;
      for (const id of m.set.moves) {
        const mv = id ? dex.move(id) : undefined;
        if (mv && mv.category !== 'Status') top = Math.max(top, typeMultiplier(dex, moveTypeFor(mv.type, mine), types, { attacker: mine, defender: theirs }));
      }
      return top;
    }),
  );

  const score = (four: number[], mega: number | undefined, leads: number[]): { total: number; parts: Parts } => {
    const form = (i: number) => i === mega;
    let pressure = 0;
    let risk = 0;
    let tempo = 0;
    let cover = 0;
    opponents.forEach((_o, o) => {
      const w = weight(o);
      pressure += w * (Math.max(...four.map((i) => killRank(cellOf(i, o, form(i)).mine?.kill ?? 'none'))) / 4);
      risk += w * (four.reduce((a, i) => a + killRank(cellOf(i, o, form(i)).theirs?.kill ?? 'none'), 0) / four.length / 4);
      tempo +=
        w *
        Math.max(
          ...four.map((i) => {
            const c = cellOf(i, o, form(i));
            return c.first === 'me' ? (killRank(c.mine?.kill ?? 'none') >= 2 ? 1 : 0.5) : c.first === 'tie' ? 0.25 : 0;
          }),
        );
      const best = Math.max(...four.map((i) => coverage[i][o]));
      cover += w * (best >= 2 ? 1 : best >= 1 ? 0.5 : 0);
    });

    // Speed control: does it flip the matchup against what they will bring?
    const controls = new Set(four.flatMap((i) => controlOf(mine[i].set)));
    let control = 0;
    if (controls.has('Tailwind')) {
      let flips = 0;
      let seen = 0;
      for (const o of likely) {
        const myBest = Math.max(...four.map((i) => cellOf(i, o, form(i)).mySpeed));
        const theirs = cellOf(four[0], o, form(four[0])).theirSpeed;
        seen++;
        if (myBest < theirs && myBest * 2 > theirs) flips++;
        else if (myBest >= theirs) flips += 0.25;
      }
      control = Math.max(control, seen ? Math.min(1, flips / seen) : 0);
    }
    if (controls.has('Trick Room')) {
      let slower = 0;
      let pairs = 0;
      for (const o of likely) {
        const theirs = cellOf(four[0], o, form(four[0])).theirSpeed;
        for (const i of four) {
          pairs++;
          if (cellOf(i, o, form(i)).mySpeed < theirs) slower++;
        }
      }
      control = Math.max(control, pairs ? slower / pairs : 0);
    }
    if (controls.has('Icy Wind') || controls.has('Electroweb')) control = Math.max(control, 0.5);

    const supports = new Set(four.flatMap((i) => supportOf(mine[i].set)));
    const support = Math.min(1, supports.size * SUPPORT_STEP);

    // The lead pair against the leads they probably open with.
    let leadScore = 0;
    if (leads.length && likelyLeads.length) {
      let lp = 0;
      let lr = 0;
      let lt = 0;
      for (const o of likelyLeads) {
        lp += Math.max(...leads.map((i) => killRank(cellOf(i, o, form(i)).mine?.kill ?? 'none'))) / 4;
        lr += leads.reduce((a, i) => a + killRank(cellOf(i, o, form(i)).theirs?.kill ?? 'none'), 0) / leads.length / 4;
        lt += Math.max(...leads.map((i) => (cellOf(i, o, form(i)).first === 'me' ? 1 : 0)));
      }
      const n = likelyLeads.length;
      const leadSupport = Math.min(1, new Set(leads.flatMap((i) => [...supportOf(mine[i].set), ...controlOf(mine[i].set)])).size * SUPPORT_STEP);
      leadScore = lp / n + 0.5 * (lt / n) + 0.7 * leadSupport - lr / n;
    }

    const parts: Parts = { pressure: norm(pressure), risk: norm(risk), tempo: norm(tempo), coverage: norm(cover), speedControl: control, support, lead: leadScore };
    const total =
      WEIGHTS.pressure * parts.pressure - WEIGHTS.risk * parts.risk + WEIGHTS.tempo * parts.tempo + WEIGHTS.coverage * parts.coverage + WEIGHTS.speedControl * parts.speedControl + WEIGHTS.support * parts.support + WEIGHTS.lead * parts.lead;
    return { total, parts };
  };

  // Best (Mega choice, lead) for each set brought. Totals within EPS count as equal (sums can differ in
  // the last bits with the team's order); ties break by the Pokémon's uids, so the result depends on
  // who is on the team, never on where they sit.
  type Pick = { four: number[]; mega: number | undefined; leads: number[]; total: number; parts: Parts };
  const EPS = 1e-9;
  const uids = (idx: number[]) => idx.map((i) => mine[i].uid).sort().join(',');
  const tieKey = (p: Pick) => `${uids(p.four)}|${uids(p.leads)}|${p.mega === undefined ? '' : mine[p.mega].uid}`;
  const better = (a: Pick, b: Pick) => (Math.abs(a.total - b.total) > EPS ? b.total - a.total : tieKey(a).localeCompare(tieKey(b)));
  const bestPerFour = new Map<string, Pick>();
  for (const { brought, leads } of enumerateBrings(mine.length, limits)) {
    const key = brought.join(',');
    for (const mega of megaOptions(brought.filter((i) => holders[i]))) {
      const s = score(brought, mega, leads);
      const cand: Pick = { four: brought, mega, leads, total: s.total, parts: s.parts };
      const cur = bestPerFour.get(key);
      if (!cur || better(cand, cur) < 0) bestPerFour.set(key, cand);
    }
  }
  const top = [...bestPerFour.values()].sort(better).slice(0, 3);

  const plans = top.map((p): Plan => {
    const bench = mine.map((_m, i) => i).filter((i) => !p.four.includes(i));
    const form = (i: number) => i === p.mega;
    const display = (i: number) => (form(i) ? `${nameOf(dex, mine[i].set.speciesId)} (Mega)` : nameOf(dex, mine[i].set.speciesId));
    const reasons = explain(p, display);
    return {
      brought: p.four.map((i) => mine[i].uid),
      leads: p.leads.map((i) => mine[i].uid),
      back: bench.map((i) => mine[i].uid),
      mega: p.mega !== undefined ? mine[p.mega].uid : undefined,
      score: Math.round(p.total * 1000) / 1000,
      parts: p.parts,
      reasons: reasons.slice(0, 4),
      risk: riskOf(p.four, form),
    };
  });

  /** 2–4 short reasons: the lead, the damage, the Mega or speed control, and coverage. */
  function explain(p: { four: number[]; mega: number | undefined; leads: number[]; parts: Parts }, display: (i: number) => string): string[] {
    const out: string[] = [];
    const form = (i: number) => i === p.mega;
    const oppName = (o: number) => nameOf(dex, opponents[o].speciesId);
    const leadNames = p.leads.map(display);
    const facts = [...new Set(p.leads.flatMap((i) => [...supportOf(mine[i].set), ...controlOf(mine[i].set)]))];
    const theirLead = likelyLeads.map(oppName);
    if (leadNames.length && theirLead.length) {
      if (facts.length) out.push(`Lead ${leadNames.join(' + ')}: ${listJoin(facts)} ${facts.length > 1 ? 'blunt' : 'blunts'} their likely lead ${theirLead.join(' + ')}.`);
      else {
        const hit = likelyLeads.filter((o) => p.leads.some((i) => killRank(cellOf(i, o, form(i)).mine?.kill ?? 'none') >= 2));
        out.push(hit.length ? `Lead ${leadNames.join(' + ')}: threatens a KO on ${listJoin(hit.map(oppName))} from their likely lead ${theirLead.join(' + ')}.` : `Lead ${leadNames.join(' + ')}: your best opening against their likely lead ${theirLead.join(' + ')}.`);
      }
    }
    const likelyOpps = [...likely];
    const threatened = likelyOpps.filter((o) => p.four.some((i) => killRank(cellOf(i, o, form(i)).mine?.kill ?? 'none') >= 2));
    if (likelyOpps.length) out.push(`This ${p.four.length === 1 ? 'Pokémon' : 'four'} threatens a KO (OHKO or 2HKO) on ${threatened.length} of their ${likelyOpps.length} likeliest: ${threatened.length ? listJoin(threatened.map(oppName)) : 'none of them'}.`);
    if (p.mega !== undefined) {
      const stones = p.four.filter((i) => holders[i]).length;
      out.push(`${nameOf(dex, mine[p.mega].set.speciesId)} is the Mega${stones > 1 ? ' (only one Pokémon can Mega Evolve per battle)' : ''}.`);
    } else if (p.parts.speedControl >= 0.5) {
      const users = p.four.filter((i) => controlOf(mine[i].set).length);
      out.push(`Speed control from ${listJoin(users.map((i) => `${display(i)}'s ${listJoin(controlOf(mine[i].set))}`))}.`);
    }
    const covered = opponents.filter((_o, o) => p.four.some((i) => coverage[i][o] >= 2)).length;
    out.push(`Super-effective coverage on ${covered} of their ${opponents.length} Pokémon.`);
    return out;
  }

  /** The one thing most likely to go wrong with this four. */
  function riskOf(four: number[], form: (i: number) => boolean): string {
    const likelyOpps = order.filter((o) => likely.has(o));
    const tailwind = four.some((i) => controlOf(mine[i].set).includes('Tailwind'));
    for (const o of likelyOpps) {
      if (four.every((i) => cellOf(i, o, form(i)).first !== 'me')) return `Nothing in this ${four.length === 1 ? 'Pokémon' : 'four'} outspeeds ${nameOf(dex, opponents[o].speciesId)}${tailwind ? ' outside Tailwind' : ''}.`;
    }
    let worst: { o: number; n: number } | undefined;
    for (const o of likelyOpps) {
      const n = four.filter((i) => cellOf(i, o, form(i)).theirs?.kill === 'ohko').length;
      if (n > 0 && (!worst || n > worst.n)) worst = { o, n };
    }
    if (worst) return `${nameOf(dex, opponents[worst.o].speciesId)} OHKOs ${worst.n} of this ${four.length === 1 ? 'Pokémon' : 'four'}.`;
    return 'No single Pokémon of theirs stands out as a problem.';
  }

  return {
    plans,
    likelyBring: order.filter((o) => likely.has(o)).map((o) => opponents[o].speciesId),
    likelyLeads: likelyLeads.map((o) => opponents[o].speciesId),
    matrix: cells.map((row) => row.map((c) => c.base)),
  };
}

// ---------------------------------------------------------------------------
// Saving a plan onto a match
// ---------------------------------------------------------------------------

/**
 * What "Use this plan" writes onto a match: my team, what I bring and who leads. The ids are the
 * Pokémon uids of the saved team (what the match log stores for a saved team).
 */
export function planToMatchPatch(plan: Pick<Plan, 'brought' | 'leads'>, teamId: string): Pick<Match, 'myTeamId' | 'myBrought' | 'myLeads'> {
  return { myTeamId: teamId, myBrought: [...plan.brought], myLeads: [...plan.leads] };
}
