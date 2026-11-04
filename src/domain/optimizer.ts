/**
 * Stat Point optimiser: finds a spread for goals like "survive X's move, outspeed Y, put the rest
 * in Atk". Pure and React-free; every number comes from calcMoves / calcSpeed, so it can never
 * disagree with the Damage Calc.
 *
 * Each goal is monotonic in the stats it depends on (more HP, Def or SpD never makes a hit hurt
 * more; more Atk, SpA or Spe never makes a KO or a race worse). So instead of trying every
 * combination, for each HP value the least Def/SpD that passes is found with a two-pointer walk
 * (the requirement never rises as HP does), and the single-stat goals with a binary search.
 *
 * Designed around StatSystem: Champions Stat Points (66 total, 32 per stat, step 1) and Gen 3–9
 * EVs (510, 252, step 4) go through the same code. Other stat systems aren't supported.
 */
import type { Dex } from '@/data/dex';
import { calcMoves, calcSpeed } from './battle/damage';
import { defaultField, defaultSide, type FieldConditions, type SideConditions } from './battle/conditions';
import { canOptimize, investRange, spreadKey } from './stats';
import { STAT_IDS, STAT_LABELS, type FormatRules, type Nature, type PokemonSet, type StatId, type StatTable } from './types';

// ---------------------------------------------------------------------------
// Goals and options
// ---------------------------------------------------------------------------

/**
 * Who a goal is about, when that is known (a goal made from a species picked in the app, not a bare number):
 * kept so the goal can be saved as a benchmark and checked again later (src/domain/benchmarks.ts).
 */
export interface GoalFoe {
  speciesId: string;
  /** 'meta': the species' most-used set (re-resolved later); 'custom': exactly `set`. */
  source: 'meta' | 'custom';
  set?: PokemonSet;
}

/** What the Speed scenario was when an Outspeed goal was made (the other side's modifiers, and the field). */
export interface OutspeedScenario {
  /** The target has Tailwind up / a Speed stage / is paralysed / holds a Choice Scarf. */
  tailwind?: boolean;
  stage?: number;
  paralyzed?: boolean;
  scarf?: boolean;
  /** My side has Tailwind up. */
  myTailwind?: boolean;
}

/** Survive an attacker's move. Solves HP and Def (physical move) or SpD (special move). */
export interface SurviveGoal {
  kind: 'survive';
  foe?: GoalFoe;
  attacker: PokemonSet;
  attackerCond?: SideConditions;
  moveId: string;
  crit?: boolean;
  /** Survive at least this many of the 16 damage rolls: 16 = every roll, 15, 8 = half. */
  rolls: number;
}

/** Be faster than a target Speed (or, in Trick Room, slower). Solves Spe. */
interface OutspeedGoal {
  kind: 'outspeed';
  /** The Speed to beat, in the scenario being planned for. */
  target: number;
  /** 'under' for Trick Room: stay slower than the target. */
  mode?: 'over' | 'under';
  /** Shown in the result, e.g. "Flutter Mane (Tailwind)". */
  label?: string;
  foe?: GoalFoe;
  scenario?: OutspeedScenario;
}

/** Knock out a defender with one of my moves in 1 or 2 hits. Solves Atk (physical) or SpA (special). */
export interface KoGoal {
  kind: 'ko';
  foe?: GoalFoe;
  defender: PokemonSet;
  defenderCond?: SideConditions;
  moveId: string;
  hits: 1 | 2;
  /** At least this many of the 16 rolls must KO (16 = guaranteed). For 2 hits, of the 256 roll pairs, scaled. */
  rolls: number;
  crit?: boolean;
}

export type Goal = SurviveGoal | OutspeedGoal | KoGoal;

/** What to do with the points the goals leave over. */
export type Leftover = { kind: 'stat'; stat: StatId } | { kind: 'bulkSplit' };

export interface OptimizeOptions {
  field?: FieldConditions;
  /** My side's conditions (Tailwind, stat stages, status…); defaults to none. */
  myCond?: SideConditions;
  nature: { mode: 'fixed'; name?: string } | { mode: 'suggest' };
  leftover?: Leftover;
  /** Smaller caps than the format's (for tests and "keep N points free"). */
  caps?: { total?: number; perStat?: number };
}

interface GoalResult {
  index: number;
  label: string;
  met: boolean;
  /** The calculator's description (or the Speed numbers) at the final spread. */
  text: string;
  /** Why an unmet goal isn't met, and what could help. */
  shortfall?: string;
}

export interface OptimizeResult {
  spread: StatTable;
  nature: string;
  natureChanged: boolean;
  goals: GoalResult[];
  /** Points spent in the spread, and the limit. */
  spent: number;
  cap: number;
  /** Points not placed anywhere. */
  unspent: number;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

interface Check {
  pass: boolean;
  text: string;
  /** How far from passing (survive: rolls survived; ko: rolls that KO; speed: the Speed). */
  value: number;
  /** Worst-case max damage as % of HP (survive) for shortfall text. */
  percent?: number;
}

const zero = (): StatTable => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 });

interface Ctx {
  dex: Dex;
  format: FormatRules;
  set: PokemonSet;
  key: 'sp' | 'evs';
  field: FieldConditions;
  myCond: SideConditions;
  max: number;
  step: number;
  total: number;
  cache: Map<string, Check>;
}

const withSpread = (ctx: Ctx, spread: StatTable, nature: string, moves?: PokemonSet['moves']): PokemonSet => ({
  ...ctx.set,
  nature,
  [ctx.key]: spread,
  ...(moves ? { moves } : {}),
});

const moveCategory = (ctx: Ctx, moveId: string) => ctx.dex.move(moveId)?.category;
const only = (moveId: string): PokemonSet['moves'] => [moveId, '', '', ''];

/** The stat a goal's damage side is solved in (besides HP for survive). */
function goalStat(ctx: Ctx, g: Goal): StatId {
  if (g.kind === 'outspeed') return 'spe';
  const cat = moveCategory(ctx, g.moveId);
  if (g.kind === 'survive') return cat === 'Special' ? 'spd' : 'def';
  return cat === 'Special' ? 'spa' : 'atk';
}

function evaluate(ctx: Ctx, g: Goal, spread: StatTable, nature: string, gi: number): Check {
  const key = `${gi}|${nature}|${STAT_IDS.map((s) => spread[s]).join('.')}`;
  const hit = ctx.cache.get(key);
  if (hit) return hit;
  const mine = withSpread(ctx, spread, nature);
  let out: Check;

  if (g.kind === 'outspeed') {
    const speeds = calcSpeed(ctx.dex, { set: mine, cond: ctx.myCond }, ctx.field).map((r) => r.speed);
    const under = g.mode === 'under';
    const speed = under ? Math.max(...speeds) : Math.min(...speeds);
    out = { pass: under ? speed < g.target : speed > g.target, text: `${speed} Speed vs ${g.target}${under ? ' (stay slower)' : ''}`, value: speed };
  } else if (g.kind === 'survive') {
    const results = calcMoves(
      ctx.dex,
      { set: { ...g.attacker, moves: only(g.moveId) }, cond: g.attackerCond ?? defaultSide(false) },
      { set: mine, cond: ctx.myCond },
      ctx.field,
      [!!g.crit],
    );
    const forms = results[0]?.forms ?? [];
    let worst: { survived: number; desc: string; percent: number } | undefined;
    for (const f of forms) {
      const survived = f.rolls.filter((r) => r < f.defenderCurHP).length * (16 / f.rolls.length);
      if (!worst || survived < worst.survived) worst = { survived, desc: f.desc, percent: f.percent[1] };
    }
    out = worst
      ? { pass: worst.survived >= g.rolls, text: worst.desc, value: worst.survived, percent: worst.percent }
      : { pass: false, text: 'No damage calculation for that move.', value: 0 };
  } else {
    const results = calcMoves(
      ctx.dex,
      { set: withSpread(ctx, spread, nature, only(g.moveId)), cond: ctx.myCond },
      { set: g.defender, cond: g.defenderCond ?? defaultSide(false) },
      ctx.field,
      [!!g.crit],
    );
    const forms = results[0]?.forms ?? [];
    let worst: { ko: number; desc: string } | undefined;
    for (const f of forms) {
      const hp = f.defenderCurHP;
      let ko: number;
      if (g.hits === 1) ko = f.rolls.filter((r) => r >= hp).length * (16 / f.rolls.length);
      else {
        let pairs = 0;
        for (const a of f.rolls) for (const b of f.rolls) if (a + b >= hp) pairs++;
        ko = pairs / f.rolls.length / (f.rolls.length / 16);
      }
      if (!worst || ko < worst.ko) worst = { ko, desc: f.desc };
    }
    out = worst
      ? { pass: worst.ko >= g.rolls, text: worst.desc, value: worst.ko }
      : { pass: false, text: 'No damage calculation for that move.', value: 0 };
  }
  ctx.cache.set(key, out);
  return out;
}

// ---------------------------------------------------------------------------
// Per-nature solving
// ---------------------------------------------------------------------------

const INF = Number.POSITIVE_INFINITY;
const valueAt = (ctx: Ctx, idx: number) => Math.min(ctx.max, idx * ctx.step);

interface Curves {
  /** Index of the least value of the goal's own stat that passes, per HP index (survive); a single entry for others. INF = never. */
  req: number[];
}

/** Least stat index passing a single-stat goal (binary search; monotone), or INF. */
function singleReq(ctx: Ctx, g: OutspeedGoal | KoGoal, gi: number, nature: string, maxIdx: number): number {
  const stat = goalStat(ctx, g);
  const at = (i: number) => evaluate(ctx, g, { ...zero(), [stat]: valueAt(ctx, i) }, nature, gi).pass;
  if (g.kind === 'outspeed' && g.mode === 'under') return at(0) ? 0 : INF;
  if (!at(maxIdx)) return INF;
  let lo = 0;
  let hi = maxIdx;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (at(mid)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** For each HP index, the least Def/SpD index that survives (two pointers: the need never rises with HP). */
function surviveReq(ctx: Ctx, g: SurviveGoal, gi: number, nature: string, maxIdx: number): number[] {
  const stat = goalStat(ctx, g);
  const at = (h: number, d: number) => evaluate(ctx, g, { ...zero(), hp: valueAt(ctx, h), [stat]: valueAt(ctx, d) }, nature, gi).pass;
  const req: number[] = [];
  let d = maxIdx + 1;
  for (let h = 0; h <= maxIdx; h++) {
    if (d > maxIdx) {
      if (!at(h, maxIdx)) {
        req.push(INF);
        continue;
      }
      d = maxIdx;
    }
    while (d > 0 && at(h, d - 1)) d--;
    req.push(d);
  }
  return req;
}

interface ClassSolution {
  nature: string;
  spread: StatTable;
  /** Goal indexes that are met, in priority order. */
  met: number[];
  /** Why a goal wasn't met. */
  dropped: Map<number, { reason: 'unreachable' | 'budget'; shortBy?: number }>;
  spent: number;
}

function solveNature(ctx: Ctx, goals: Goal[], nature: string): ClassSolution {
  const maxIdx = Math.floor(ctx.max / ctx.step);
  const curves = goals.map((g, gi): Curves => ({ req: g.kind === 'survive' ? surviveReq(ctx, g, gi, nature, maxIdx) : [singleReq(ctx, g, gi, nature, maxIdx)] }));
  const dropped: ClassSolution['dropped'] = new Map();
  let active = goals.map((_, i) => i).filter((i) => curves[i].req.some((r) => r < INF));
  goals.forEach((_, i) => {
    if (!active.includes(i)) dropped.set(i, { reason: 'unreachable' });
  });

  /** Cheapest allocation for a set of goals ignoring the total cap: [total value, hp idx, per-stat idx], or null. */
  const best = (idxs: number[]) => {
    let top: { total: number; h: number; stats: Partial<Record<StatId, number>> } | null = null;
    for (let h = 0; h <= maxIdx; h++) {
      const stats: Partial<Record<StatId, number>> = {};
      let ok = true;
      for (const i of idxs) {
        const g = goals[i];
        const r = g.kind === 'survive' ? curves[i].req[h] : curves[i].req[0];
        if (r === INF) {
          ok = false;
          break;
        }
        const s = goalStat(ctx, g);
        stats[s] = Math.max(stats[s] ?? 0, r);
      }
      if (!ok) continue;
      const needsHp = idxs.some((i) => goals[i].kind === 'survive');
      const hVal = needsHp ? valueAt(ctx, h) : 0;
      const total = hVal + Object.values(stats).reduce((a, idx) => a + valueAt(ctx, idx as number), 0);
      if (!top || total < top.total) top = { total, h: needsHp ? h : 0, stats };
      if (!needsHp) break;
    }
    return top;
  };

  // Drop the lowest-priority goals until the rest fit in the budget.
  let chosen = best(active);
  while (active.length > 0 && (!chosen || chosen.total > ctx.total)) {
    const last = active[active.length - 1];
    const withLast = best(active);
    dropped.set(last, { reason: 'budget', shortBy: withLast ? withLast.total - ctx.total : undefined });
    active = active.slice(0, -1);
    chosen = best(active);
  }

  const spread = zero();
  if (chosen) {
    if (active.some((i) => goals[i].kind === 'survive')) spread.hp = valueAt(ctx, chosen.h);
    for (const [s, idx] of Object.entries(chosen.stats)) spread[s as StatId] = valueAt(ctx, idx as number);
  }
  const spent = STAT_IDS.reduce((a, s) => a + spread[s], 0);
  return { nature, spread, met: active, dropped, spent };
}

/** Natures with the same effect on the stats that matter are interchangeable: one candidate per effect. */
function candidateNatures(ctx: Ctx, goalStats: Set<StatId>, opts: OptimizeOptions): string[] {
  if (opts.nature.mode === 'fixed') return [opts.nature.name ?? ctx.set.nature];
  const natures = ctx.dex.natures;
  const sig = (n: Nature) => [...goalStats].map((s) => (n.plus === s && n.minus !== s ? '+' : n.minus === s && n.plus !== s ? '-' : '0')).join('');
  const usedByMoves = new Set<StatId>();
  for (const m of ctx.set.moves) {
    const cat = m ? ctx.dex.move(m)?.category : undefined;
    if (cat === 'Physical') usedByMoves.add('atk');
    if (cat === 'Special') usedByMoves.add('spa');
  }
  const groups = new Map<string, Nature[]>();
  for (const n of natures) {
    const k = sig(n);
    if (k.includes('-')) continue; // never lower a stat a goal needs
    groups.set(k, [...(groups.get(k) ?? []), n]);
  }
  const rank = (n: Nature) => (n.name === ctx.set.nature ? -2 : n.plus === n.minus ? -1 : n.minus && usedByMoves.has(n.minus) ? 1 : 0);
  return [...groups.values()].map((g) => [...g].sort((a, b) => rank(a) - rank(b))[0].name);
}

// ---------------------------------------------------------------------------
// Leftovers
// ---------------------------------------------------------------------------

function applyLeftover(ctx: Ctx, spread: StatTable, leftover: Leftover | undefined): StatTable {
  const out = { ...spread };
  let room = ctx.total - STAT_IDS.reduce((a, s) => a + out[s], 0);
  const give = (s: StatId, want: number) => {
    const n = Math.max(0, Math.min(want, room, ctx.max - out[s]));
    const stepped = ctx.step > 1 ? n - (n % ctx.step) : n;
    // A capped stat can end below a step boundary; allow the final partial step only at the cap.
    const add = stepped === 0 && out[s] + n === ctx.max ? n : stepped;
    out[s] += add;
    room -= add;
  };
  if (!leftover) return out;
  if (leftover.kind === 'stat') give(leftover.stat, ctx.max);
  else {
    give('hp', ctx.max);
    const others: StatId[] = ['def', 'spd', 'atk', 'spa', 'spe'];
    let progressed = true;
    while (room >= ctx.step && progressed) {
      progressed = false;
      for (const s of others) {
        if (room >= ctx.step && out[s] + ctx.step <= ctx.max) {
          out[s] += ctx.step;
          room -= ctx.step;
          progressed = true;
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export { canOptimize };

/**
 * Whether a goal holds for the set exactly as it is now (its current spread and nature), with the same
 * numbers the optimiser uses. For benchmarks: an optimiser run solves goals, this only checks them.
 */
export function checkGoal(dex: Dex, format: FormatRules, set: PokemonSet, goal: Goal, opts: { field?: FieldConditions; myCond?: SideConditions } = {}): { pass: boolean; text: string } {
  if (!canOptimize(format)) throw new Error('Goals are checked for Champions Stat Points and Gen 3–9 EVs only.');
  const sys = format.statSystem as Extract<FormatRules['statSystem'], { kind: 'champions-sp' | 'modern-ev' }>;
  const range = investRange(sys);
  const key = spreadKey(sys) as 'sp' | 'evs';
  const ctx: Ctx = {
    dex,
    format,
    set,
    key,
    field: opts.field ?? defaultField(),
    myCond: opts.myCond ?? defaultSide(!!dex.megaFor(set.speciesId, set.itemId)),
    max: range.max,
    step: range.step,
    total: sys.totalCap,
    cache: new Map(),
  };
  const { pass, text } = evaluate(ctx, goal, set[key] as StatTable, set.nature, 0);
  return { pass, text };
}

/** A goal in words: "Survive Garchomp's Earthquake", "Outspeed Flutter Mane (Tailwind)". */
export function describeGoal(dex: Dex, g: Goal): string {
  const name = (s: PokemonSet) => dex.species(s.speciesId)?.name ?? s.speciesId;
  const move = (id: string) => dex.move(id)?.name ?? id;
  if (g.kind === 'survive') return `Survive ${name(g.attacker)}'s ${move(g.moveId)}${g.crit ? ' (crit)' : ''}`;
  if (g.kind === 'ko') return `${g.hits === 1 ? 'OHKO' : '2HKO'} ${name(g.defender)} with ${move(g.moveId)}`;
  return `${g.mode === 'under' ? 'Stay slower than' : 'Outspeed'} ${g.label ?? `Speed ${g.target}`}`;
}

/** The first line of a goal result that isn't met: what's missing and what could help. */
function shortfallText(ctx: Ctx, g: Goal, why: { reason: 'unreachable' | 'budget'; shortBy?: number }, atMax: Check): string {
  if (why.reason === 'budget') {
    const n = Math.max(1, Math.ceil(why.shortBy ?? 1));
    return `needs ${n} more ${ctx.key === 'sp' ? 'SP' : 'EVs'} than you have`;
  }
  if (g.kind === 'survive') {
    const special = moveCategory(ctx, g.moveId) === 'Special';
    const rollsText = g.rolls >= 16 ? `short by ${Math.max(0, (atMax.percent ?? 100) - 100).toFixed(1)}% even at max HP and ${special ? 'SpD' : 'Def'}` : `only ${Math.floor(atMax.value)} of 16 rolls survive even at max HP and ${special ? 'SpD' : 'Def'} (need ${g.rolls})`;
    const hint = special && ctx.set.itemId !== 'assaultvest' ? ': consider Assault Vest' : !special ? ': consider a bulkier item or nature' : '';
    return rollsText + hint;
  }
  if (g.kind === 'outspeed') {
    const diff = Math.abs(atMax.value - g.target) + (g.mode === 'under' ? 1 : 1);
    return g.mode === 'under' ? 'a Speed-lowering nature or item is needed to stay under it' : `short by ${diff} Speed even at max investment: consider Choice Scarf or a Speed-raising nature`;
  }
  return `only ${atMax.value.toFixed(1)} of 16 rolls KO even at max ${moveCategory(ctx, g.moveId) === 'Special' ? 'SpA' : 'Atk'}: consider a stronger item, nature or move`;
}

/**
 * Finds the cheapest spread meeting the goals, in priority order (earlier goals win when the points
 * run out), then places the leftovers. Goals that can't be met are reported with how short they fall.
 */
export function optimize(dex: Dex, format: FormatRules, set: PokemonSet, goals: Goal[], opts: OptimizeOptions): OptimizeResult {
  if (!canOptimize(format)) throw new Error('The optimiser supports Champions Stat Points and Gen 3–9 EVs only.');
  const sys = format.statSystem as Extract<FormatRules['statSystem'], { kind: 'champions-sp' | 'modern-ev' }>;
  const range = investRange(sys);
  const hasMega = !!dex.megaFor(set.speciesId, set.itemId);
  const ctx: Ctx = {
    dex,
    format,
    set,
    key: spreadKey(sys) as 'sp' | 'evs',
    field: opts.field ?? defaultField(),
    myCond: opts.myCond ?? defaultSide(hasMega),
    max: Math.min(range.max, opts.caps?.perStat ?? range.max),
    step: range.step,
    total: Math.min(sys.totalCap, opts.caps?.total ?? sys.totalCap),
    cache: new Map(),
  };

  const goalStats = new Set<StatId>(goals.map((g) => goalStat(ctx, g)).filter((s) => s !== 'hp'));
  if (opts.leftover?.kind === 'stat' && opts.leftover.stat !== 'hp') goalStats.add(opts.leftover.stat);

  const solutions = candidateNatures(ctx, goalStats, opts).map((n) => solveNature(ctx, goals, n));
  const idx = (n: string) => (n === set.nature ? 0 : 1);
  solutions.sort((a, b) => b.met.length - a.met.length || a.spent - b.spent || idx(a.nature) - idx(b.nature));
  const sol = solutions[0] ?? { nature: set.nature, spread: zero(), met: [], dropped: new Map(), spent: 0 };

  const spread = applyLeftover(ctx, sol.spread, opts.leftover);
  const spent = STAT_IDS.reduce((a, s) => a + spread[s], 0);
  const maxSpread = (g: Goal): StatTable => ({ ...zero(), [goalStat(ctx, g)]: ctx.max, ...(g.kind === 'survive' ? { hp: ctx.max } : {}) });

  const results: GoalResult[] = goals.map((g, i) => {
    const final = evaluate(ctx, g, spread, sol.nature, i);
    const label = describeGoal(ctx.dex, g);
    if (final.pass) return { index: i, label, met: true, text: final.text };
    const why = sol.dropped.get(i) ?? { reason: 'unreachable' as const };
    const atMax = evaluate(ctx, g, maxSpread(g), sol.nature, i);
    return { index: i, label, met: false, text: final.text, shortfall: shortfallText(ctx, g, why, atMax) };
  });
  return { spread, nature: sol.nature, natureChanged: sol.nature !== set.nature, goals: results, spent, cap: ctx.total, unspent: ctx.total - spent };
}

export const statLabel = (s: StatId) => STAT_LABELS[s];
