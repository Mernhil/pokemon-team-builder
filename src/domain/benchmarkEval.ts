/**
 * Checking benchmarks (src/domain/benchmarks.ts): resolve the other Pokémon, build the goal, and ask the
 * optimiser's own calculation whether it holds for the set as it is now. Heavy (it needs the damage
 * engine), so the UI loads it on demand.
 */
import type { Dex } from '@/data/dex';
import { calcSpeed } from './battle/damage';
import { defaultField, defaultSide, type FieldConditions, type MegaMode, type SideConditions, type Status, type Terrain, type Weather } from './battle/conditions';
import { benchmarkId, describeBenchmark, savedOn, type BenchConditions, type BenchFoe, type BenchSeen, type BenchSet, type Benchmark } from './benchmarks';
import { REGULATION_MANIFEST } from './formats';
import type { MetaSnapshot } from './meta';
import { metaSet } from './metaSets';
import { checkGoal, type Goal, type GoalFoe, type OutspeedScenario } from './optimizer';
import { canOptimize, spreadKey } from './stats';
import { SCARF_ID } from './speedTiers';
import { createSet } from './team';
import { STAT_IDS, type FormatRules, type PokemonSet, type StatTable } from './types';

export type BenchmarkStatus = 'met' | 'notmet' | 'cant';

export interface BenchmarkResult {
  id: string;
  /** "Survive Garchomp's Earthquake". */
  label: string;
  status: BenchmarkStatus;
  /** The calculator's line, or why it can't be checked. */
  text: string;
  /** Set when the answer differs from when it was saved: "met when saved on 5 Oct 2026; now not met: …". */
  change?: string;
}

const regName = (format: FormatRules) => REGULATION_MANIFEST.regulations.find((r) => r.id === format.regulationId)?.shortName ?? format.name;
const table = (values: readonly number[]): StatTable => Object.fromEntries(STAT_IDS.map((k, i) => [k, values[i] ?? 0])) as StatTable;
const values = (t: StatTable): number[] => STAT_IDS.map((k) => t[k]);

// ---- sets <-> benchmark sets --------------------------------------------------------------

export function benchSetOf(set: PokemonSet, format: FormatRules): BenchSet {
  const key = spreadKey(format.statSystem) as 'sp' | 'evs';
  return { speciesId: set.speciesId, abilityId: set.abilityId, itemId: set.itemId, nature: set.nature, moves: set.moves.filter(Boolean), spread: values(set[key] as StatTable) };
}

export function setOfBench(dex: Dex, format: FormatRules, b: BenchSet): PokemonSet {
  const key = spreadKey(format.statSystem) as 'sp' | 'evs';
  const set = createSet(dex, b.speciesId, format);
  return { ...set, abilityId: b.abilityId ?? set.abilityId, itemId: b.itemId, nature: b.nature, moves: [b.moves[0] ?? '', b.moves[1] ?? '', b.moves[2] ?? '', b.moves[3] ?? ''], [key]: table(b.spread) };
}

export function seenOf(set: PokemonSet, format: FormatRules): BenchSeen {
  const key = spreadKey(format.statSystem) as 'sp' | 'evs';
  return { itemId: set.itemId, abilityId: set.abilityId, nature: set.nature, spread: values(set[key] as StatTable) };
}

// ---- the other Pokémon ----------------------------------------------------------------------

interface Resolved {
  set?: PokemonSet;
  megaMode: MegaMode;
  /** Why it can't be used. */
  cant?: string;
}

/** The other Pokémon of a benchmark as it is today: a custom set as saved, a meta one as the snapshot has it. */
export function resolveFoe(dex: Dex, format: FormatRules, foe: BenchFoe, snapshot: MetaSnapshot | undefined): Resolved {
  const species = dex.species(foe.speciesId);
  if (!species) return { megaMode: 'base', cant: `${foe.speciesId} is not in this game's Pokédex` };
  if (format.regulationId && !species.legalIn.includes(format.regulationId)) return { megaMode: 'base', cant: `${species.name} is not legal in ${regName(format)}` };
  if (foe.source === 'custom' && foe.set) {
    const set = setOfBench(dex, format, foe.set);
    return { set, megaMode: dex.megaFor(set.speciesId, set.itemId) ? 'both' : 'base' };
  }
  if (!snapshot) return { megaMode: 'base', cant: `there is no usage data for ${regName(format)} yet` };
  const entry = snapshot.entries.find((e) => e.speciesId === foe.speciesId);
  const m = entry && metaSet(entry, dex, format);
  if (!m) return { megaMode: 'base', cant: `${species.name} has no usage data in ${regName(format)}` };
  return { set: m.set, megaMode: m.megaMode };
}

/** Whether a set is the species' most-used build (item, ability, nature and spread), so a goal made from it is a 'meta' one. */
function sameBuild(a: PokemonSet, b: PokemonSet, format: FormatRules): boolean {
  const key = spreadKey(format.statSystem) as 'sp' | 'evs';
  return a.itemId === b.itemId && a.abilityId === b.abilityId && a.nature === b.nature && values(a[key] as StatTable).join() === values(b[key] as StatTable).join();
}

export function foeFromSet(dex: Dex, format: FormatRules, set: PokemonSet, snapshot: MetaSnapshot | undefined): GoalFoe {
  const entry = snapshot?.entries.find((e) => e.speciesId === set.speciesId);
  const m = entry && metaSet(entry, dex, format);
  return m && sameBuild(m.set, set, format) ? { speciesId: set.speciesId, source: 'meta' } : { speciesId: set.speciesId, source: 'custom', set };
}

// ---- benchmark <-> goal ---------------------------------------------------------------------

const fieldOf = (c: BenchConditions | undefined, trickRoom?: boolean): FieldConditions => ({
  ...defaultField(),
  ...(c?.field ? { weather: (c.field.weather ?? '') as Weather, terrain: (c.field.terrain ?? '') as Terrain, trickRoom: !!c.field.trickRoom, gravity: !!c.field.gravity, ...(c.field.gameType ? { gameType: c.field.gameType } : {}) } : {}),
  ...(trickRoom ? { trickRoom: true } : {}),
});

const foeCond = (c: BenchConditions | undefined, megaMode: MegaMode): SideConditions => ({
  ...defaultSide(megaMode !== 'base'),
  megaMode: c?.foe?.megaMode ?? megaMode,
  tailwind: !!c?.foe?.tailwind,
  status: (c?.foe?.status ?? '') as Status,
  boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: c?.foe?.stage ?? 0 },
});

/** The goal a benchmark asks, for the set as it is, or why there is none. */
function goalOf(dex: Dex, format: FormatRules, b: Benchmark, foe: Resolved, mine: PokemonSet): { goal?: Goal; field: FieldConditions; myCond: SideConditions; cant?: string } {
  const myCond: SideConditions = { ...defaultSide(!!dex.megaFor(mine.speciesId, mine.itemId)), tailwind: !!(b.cond?.mine?.tailwind || (b.kind === 'outspeed' && b.scenario.myTailwind)), status: (b.cond?.mine?.status ?? '') as Status };
  const field = fieldOf(b.cond, b.kind === 'outspeed' ? b.scenario.trickRoom : false);
  if (!foe.set) return { field, myCond, cant: foe.cant };
  if (b.kind !== 'outspeed') {
    const move = dex.move(b.moveId);
    if (!move) return { field, myCond, cant: `${b.moveId} is not a move in this game` };
    if (format.regulationId && !move.legalIn.includes(format.regulationId)) return { field, myCond, cant: `${move.name} is not legal in ${regName(format)}` };
  }
  if (b.kind === 'survive') return { goal: { kind: 'survive', attacker: foe.set, attackerCond: foeCond(b.cond, foe.megaMode), moveId: b.moveId, crit: b.crit, rolls: b.rolls }, field, myCond };
  if (b.kind === 'ko') return { goal: { kind: 'ko', defender: foe.set, moveId: b.moveId, hits: b.hits, rolls: b.rolls, crit: b.crit }, field, myCond };
  const s = b.scenario;
  const theirs = s.scarf ? { ...foe.set, itemId: SCARF_ID } : foe.set;
  const speeds = calcSpeed(dex, { set: theirs, cond: foeCond({ foe: { tailwind: s.tailwind, stage: s.stage, status: s.paralyzed ? 'par' : undefined, ...b.cond?.foe } }, foe.megaMode) }, field).map((r) => r.speed);
  return { goal: { kind: 'outspeed', target: Math.max(...speeds), mode: s.trickRoom ? 'under' : 'over' }, field, myCond };
}

/** What differs between the other Pokémon's most-used set when the benchmark was saved and now. */
function whatChanged(dex: Dex, format: FormatRules, b: Benchmark, now: PokemonSet | undefined): string | undefined {
  if (b.foe.source !== 'meta' || !b.seen || !now) return undefined;
  const name = dex.species(b.foe.speciesId)?.name ?? b.foe.speciesId;
  const nowSeen = seenOf(now, format);
  const items = (id?: string) => (id ? (dex.item(id)?.name ?? id) : 'no item');
  const out: string[] = [];
  if (b.seen.itemId !== nowSeen.itemId) out.push(`${name}'s most-used item is now ${items(nowSeen.itemId)} (was ${items(b.seen.itemId)})`);
  if (b.seen.abilityId && b.seen.abilityId !== nowSeen.abilityId) out.push(`${name}'s most-used ability is now ${dex.ability(nowSeen.abilityId)?.name ?? nowSeen.abilityId}`);
  if (b.seen.nature && b.seen.nature !== nowSeen.nature) out.push(`${name}'s most-used nature is now ${nowSeen.nature} (was ${b.seen.nature})`);
  if (b.seen.spread && nowSeen.spread && b.seen.spread.join() !== nowSeen.spread.join()) out.push(`${name}'s most-used spread changed`);
  return out.length ? out.join('; ') : undefined;
}

/** Checks each benchmark for the set as it is now, with the snapshot of the format's regulation. */
export function evaluateBenchmarks(dex: Dex, format: FormatRules, set: PokemonSet, benchmarks: readonly Benchmark[], snapshot?: MetaSnapshot): BenchmarkResult[] {
  return benchmarks.map((b): BenchmarkResult => {
    const label = describeBenchmark(dex, b);
    if (!canOptimize(format)) return { id: b.id, label, status: 'cant', text: 'Benchmarks need Champions Stat Points or Gen 3–9 EVs.' };
    const foe = resolveFoe(dex, format, b.foe, snapshot);
    const g = goalOf(dex, format, b, foe, set);
    if (!g.goal) return { id: b.id, label, status: 'cant', text: `Can't check: ${g.cant ?? 'no goal'}.` };
    const { pass, text } = checkGoal(dex, format, set, g.goal, { field: g.field, myCond: g.myCond });
    const status: BenchmarkStatus = pass ? 'met' : 'notmet';
    let change: string | undefined;
    if (b.metAtSave && !pass) {
      const why = whatChanged(dex, format, b, foe.set);
      change = `Met when saved on ${savedOn(b.savedAt)}; now not met${why ? `: ${why}` : ''}`;
    } else if (!b.metAtSave && pass) change = `Not met when saved on ${savedOn(b.savedAt)}; met now`;
    return { id: b.id, label, status, text, ...(change ? { change } : {}) };
  });
}

export { brokenCount } from './benchmarks';

// ---- from a goal ----------------------------------------------------------------------------

const nonDefaultField = (f: FieldConditions | undefined): BenchConditions['field'] | undefined => {
  if (!f) return undefined;
  const d = defaultField();
  const out: NonNullable<BenchConditions['field']> = {
    ...(f.weather !== d.weather ? { weather: f.weather } : {}),
    ...(f.terrain !== d.terrain ? { terrain: f.terrain } : {}),
    ...(f.trickRoom ? { trickRoom: true } : {}),
    ...(f.gravity ? { gravity: true } : {}),
    ...(f.gameType !== d.gameType ? { gameType: f.gameType } : {}),
  };
  return Object.keys(out).length ? out : undefined;
};

/**
 * A benchmark from a goal (an optimiser goal, once it has been applied), or undefined when the goal
 * does not say who it is about (a bare Speed number). `met` is whether it holds for the spread applied.
 */
export function benchmarkFromGoal(
  dex: Dex,
  format: FormatRules,
  goal: Goal,
  o: { snapshot?: MetaSnapshot; field?: FieldConditions; myCond?: SideConditions; met: boolean; now?: number },
): Benchmark | undefined {
  const field = nonDefaultField(o.field);
  const mine = o.myCond?.tailwind ? { tailwind: true } : undefined;
  const base = (foe: GoalFoe, cond?: BenchConditions['foe'], extraField?: BenchConditions['field']) => {
    const resolved = resolveFoe(dex, format, { speciesId: foe.speciesId, source: foe.source, set: foe.set ? benchSetOf(foe.set, format) : undefined }, o.snapshot);
    const bf: BenchFoe = foe.source === 'custom' && foe.set ? { speciesId: foe.speciesId, source: 'custom', set: benchSetOf(foe.set, format) } : { speciesId: foe.speciesId, source: 'meta' };
    const condition: BenchConditions = { ...((field || extraField) ? { field: { ...field, ...extraField } } : {}), ...(cond && Object.keys(cond).length ? { foe: cond } : {}), ...(mine ? { mine } : {}) };
    return {
      id: benchmarkId(),
      savedAt: o.now ?? Date.now(),
      metAtSave: o.met,
      foe: bf,
      ...(foe.source === 'meta' && resolved.set ? { seen: seenOf(resolved.set, format) } : {}),
      ...(Object.keys(condition).length ? { cond: condition } : {}),
    };
  };
  if (goal.kind === 'survive') {
    const foe = goal.foe ?? foeFromSet(dex, format, goal.attacker, o.snapshot);
    const c = goal.attackerCond;
    const cond: NonNullable<BenchConditions['foe']> = { ...(c && c.megaMode !== (dex.megaFor(goal.attacker.speciesId, goal.attacker.itemId) ? 'both' : 'base') ? { megaMode: c.megaMode } : {}), ...(c?.tailwind ? { tailwind: true } : {}), ...(c?.boosts.spe ? { stage: c.boosts.spe } : {}), ...(c?.status ? { status: c.status } : {}) };
    return { ...base(foe, cond), kind: 'survive', moveId: goal.moveId, rolls: goal.rolls, ...(goal.crit ? { crit: true } : {}) };
  }
  if (goal.kind === 'ko') {
    const foe = goal.foe ?? foeFromSet(dex, format, goal.defender, o.snapshot);
    return { ...base(foe), kind: 'ko', moveId: goal.moveId, hits: goal.hits, rolls: goal.rolls, ...(goal.crit ? { crit: true } : {}) };
  }
  if (!goal.foe) return undefined;
  const s: OutspeedScenario = goal.scenario ?? {};
  return {
    ...base(goal.foe, undefined, goal.mode === 'under' || o.field?.trickRoom ? { trickRoom: true } : undefined),
    kind: 'outspeed',
    scenario: {
      ...(s.tailwind ? { tailwind: true } : {}),
      ...(s.stage ? { stage: s.stage } : {}),
      ...(s.paralyzed ? { paralyzed: true } : {}),
      ...(s.scarf ? { scarf: true } : {}),
      ...(s.myTailwind || o.myCond?.tailwind ? { myTailwind: true } : {}),
      ...(goal.mode === 'under' ? { trickRoom: true } : {}),
    },
  };
}
