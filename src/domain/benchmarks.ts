/**
 * Benchmarks: goals a Pokémon's spread was built to meet ("survive Garchomp's Earthquake", "outspeed
 * Flutter Mane in Tailwind"), kept on its set and checked again when the meta or the regulation changes.
 *
 * A benchmark stores the intent, never resolved numbers: who the other Pokémon is (the species' most-used
 * set, or an exact custom one), the move, how sure, the conditions, and for a Speed benchmark the scenario.
 * What it was when saved (the date, whether it held, a small note of the other Pokémon's most-used set) is
 * kept so a later check can say what changed. This file is the light half (types, sanitising, wording) that
 * the store and the share code use; the checking (it needs the damage engine) is benchmarkEval.ts.
 */
import type { Dex } from '@/data/dex';
import { TERRAINS, WEATHERS, type MegaMode } from './battle/conditions';

export const MAX_BENCHMARKS = 8;

/** A custom Pokémon, kept small: what a damage or Speed calculation needs. */
export interface BenchSet {
  speciesId: string;
  abilityId?: string;
  itemId?: string;
  nature: string;
  moves: string[];
  /** Stat Points or EVs in HP, Atk, Def, SpA, SpD, Spe order. */
  spread: number[];
}

export interface BenchFoe {
  speciesId: string;
  /** 'meta': its most-used set today (re-resolved at every check); 'custom': exactly `set`. */
  source: 'meta' | 'custom';
  set?: BenchSet;
}

/** The part of the conditions that is not the default. */
export interface BenchConditions {
  field?: { weather?: string; terrain?: string; trickRoom?: boolean; gravity?: boolean; gameType?: 'Doubles' | 'Singles' };
  /** The other Pokémon's side. */
  foe?: { megaMode?: MegaMode; tailwind?: boolean; stage?: number; status?: string };
  /** My side. */
  mine?: { tailwind?: boolean; status?: string };
}

/** The other Pokémon's most-used set when the benchmark was saved, so a later check can say what changed. */
export interface BenchSeen {
  itemId?: string;
  abilityId?: string;
  nature?: string;
  /** Spread in HP, Atk, Def, SpA, SpD, Spe order. */
  spread?: number[];
}

/** A Speed benchmark's scenario: modifiers on the other Pokémon, and whether Trick Room is up. */
interface BenchScenario {
  tailwind?: boolean;
  stage?: number;
  paralyzed?: boolean;
  scarf?: boolean;
  trickRoom?: boolean;
  myTailwind?: boolean;
}

interface Common {
  id: string;
  /** Epoch ms. */
  savedAt: number;
  /** Whether it held when it was saved. */
  metAtSave: boolean;
  foe: BenchFoe;
  seen?: BenchSeen;
  cond?: BenchConditions;
}
interface SurviveBenchmark extends Common {
  kind: 'survive';
  moveId: string;
  /** Survive at least this many of the 16 rolls. */
  rolls: number;
  crit?: boolean;
}
interface KoBenchmark extends Common {
  kind: 'ko';
  moveId: string;
  hits: 1 | 2;
  rolls: number;
  crit?: boolean;
}
interface OutspeedBenchmark extends Common {
  kind: 'outspeed';
  scenario: BenchScenario;
}
export type Benchmark = SurviveBenchmark | KoBenchmark | OutspeedBenchmark;

// ---- sanitising ---------------------------------------------------------------------------

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : undefined);
const id = (v: unknown): string | undefined => (typeof v === 'string' && /^[a-z0-9]{1,64}$/.test(v) ? v : undefined);
const num = (v: unknown, min: number, max: number): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : undefined);
const bool = (v: unknown): true | undefined => (v === true ? true : undefined);
const spread = (v: unknown): number[] | undefined => (Array.isArray(v) && v.length === 6 ? v.map((x) => num(x, 0, 65535) ?? 0) : undefined);
const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | undefined => (typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : undefined);
const clean = <T extends object>(o: T): T | undefined => (Object.values(o).some((x) => x !== undefined) ? (Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined)) as T) : undefined);

function benchSet(v: unknown): BenchSet | undefined {
  if (!isObj(v)) return undefined;
  const speciesId = id(v.speciesId);
  const sp = spread(v.spread);
  if (!speciesId || !sp) return undefined;
  const moves = Array.isArray(v.moves) ? v.moves.map((m) => id(m)).filter((m): m is string => !!m).slice(0, 4) : [];
  return { speciesId, abilityId: id(v.abilityId), itemId: id(v.itemId), nature: text(v.nature, 20) ?? 'Hardy', moves, spread: sp };
}

function foeOf(v: unknown): BenchFoe | undefined {
  if (!isObj(v)) return undefined;
  const speciesId = id(v.speciesId);
  const source = oneOf(v.source, ['meta', 'custom'] as const);
  if (!speciesId || !source) return undefined;
  const set = benchSet(v.set);
  if (source === 'custom' && !set) return undefined;
  return { speciesId, source, ...(source === 'custom' && set ? { set } : {}) };
}

function condOf(v: unknown): BenchConditions | undefined {
  if (!isObj(v)) return undefined;
  const f = isObj(v.field) ? v.field : {};
  const foe = isObj(v.foe) ? v.foe : {};
  const mine = isObj(v.mine) ? v.mine : {};
  const status = (x: unknown) => oneOf(x, ['brn', 'par', 'psn', 'tox', 'slp', 'frz'] as const);
  const out: BenchConditions = {
    field: clean({
      weather: oneOf(f.weather, WEATHERS.map((w) => w.id).filter(Boolean)),
      terrain: oneOf(f.terrain, TERRAINS.map((t) => t.id).filter(Boolean)),
      trickRoom: bool(f.trickRoom),
      gravity: bool(f.gravity),
      gameType: oneOf(f.gameType, ['Doubles', 'Singles'] as const),
    }),
    foe: clean({ megaMode: oneOf(foe.megaMode, ['base', 'mega', 'both'] as const), tailwind: bool(foe.tailwind), stage: num(foe.stage, -6, 6) || undefined, status: status(foe.status) }),
    mine: clean({ tailwind: bool(mine.tailwind), status: status(mine.status) }),
  };
  return clean(out);
}

function oneBenchmark(v: unknown): Benchmark | undefined {
  if (!isObj(v)) return undefined;
  const bid = typeof v.id === 'string' && ID.test(v.id) ? v.id : undefined;
  const foe = foeOf(v.foe);
  if (!bid || !foe) return undefined;
  const common = {
    id: bid,
    savedAt: num(v.savedAt, 0, 8.64e15) ?? 0,
    metAtSave: v.metAtSave === true,
    foe,
    seen: isObj(v.seen) ? clean({ itemId: id(v.seen.itemId), abilityId: id(v.seen.abilityId), nature: text(v.seen.nature, 20), spread: spread(v.seen.spread) }) : undefined,
    cond: condOf(v.cond),
  };
  if (v.kind === 'outspeed') {
    const s = isObj(v.scenario) ? v.scenario : {};
    return { ...common, kind: 'outspeed', scenario: clean({ tailwind: bool(s.tailwind), stage: num(s.stage, -6, 6) || undefined, paralyzed: bool(s.paralyzed), scarf: bool(s.scarf), trickRoom: bool(s.trickRoom), myTailwind: bool(s.myTailwind) }) ?? {} };
  }
  const moveId = id(v.moveId);
  const rolls = num(v.rolls, 1, 16);
  if (!moveId || rolls === undefined) return undefined;
  if (v.kind === 'survive') return { ...common, kind: 'survive', moveId, rolls, crit: bool(v.crit) };
  if (v.kind === 'ko') return { ...common, kind: 'ko', moveId, rolls, hits: v.hits === 2 ? 2 : 1, crit: bool(v.crit) };
  return undefined;
}

/** A saved list of benchmarks as a valid one (bad entries drop out, at most MAX_BENCHMARKS), or undefined when none are left. */
export function sanitizeBenchmarks(v: unknown): Benchmark[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const seen = new Set<string>();
  const out: Benchmark[] = [];
  for (const raw of v) {
    const b = oneBenchmark(raw);
    if (b && !seen.has(b.id)) {
      seen.add(b.id);
      out.push(b);
    }
    if (out.length >= MAX_BENCHMARKS) break;
  }
  return out.length ? out : undefined;
}

/** Adds benchmarks to a set's list: a new one replaces an earlier one that asks the same thing; the list never passes the limit (the oldest go). */
export function mergeBenchmarks(current: readonly Benchmark[] | undefined, added: readonly Benchmark[]): Benchmark[] {
  const same = (a: Benchmark, b: Benchmark) => benchmarkKey(a) === benchmarkKey(b);
  const kept = (current ?? []).filter((c) => !added.some((a) => same(a, c)));
  return [...kept, ...added].slice(-MAX_BENCHMARKS);
}

/** What a benchmark asks, ignoring when it was saved: two with the same key are the same benchmark. */
export const benchmarkKey = (b: Benchmark): string => JSON.stringify([b.kind, b.foe, 'moveId' in b ? b.moveId : '', 'hits' in b ? b.hits : '', 'rolls' in b ? b.rolls : '', 'crit' in b ? !!b.crit : '', 'scenario' in b ? b.scenario : '', b.cond ?? '']);

// ---- words --------------------------------------------------------------------------------

const nameOf = (dex: Dex, speciesId: string) => dex.species(speciesId)?.name ?? speciesId;

/** "Survive Garchomp's Earthquake", "OHKO Kingambit with Close Combat", "Outspeed Flutter Mane (Tailwind)". */
export function describeBenchmark(dex: Dex, b: Benchmark): string {
  const foe = nameOf(dex, b.foe.speciesId);
  const move = (m: string) => dex.move(m)?.name ?? m;
  const sure = (r: number) => (r >= 16 ? '' : r >= 15 ? ' (15 of 16 rolls)' : ` (${r} of 16 rolls)`);
  if (b.kind === 'survive') return `Survive ${foe}'s ${move(b.moveId)}${b.crit ? ' (crit)' : ''}${sure(b.rolls)}`;
  if (b.kind === 'ko') return `${b.hits === 1 ? 'OHKO' : '2HKO'} ${foe} with ${move(b.moveId)}${b.crit ? ' (crit)' : ''}${sure(b.rolls)}`;
  const mods = [b.scenario.tailwind && 'Tailwind', b.scenario.stage && `${b.scenario.stage > 0 ? '+' : ''}${b.scenario.stage}`, b.scenario.paralyzed && 'paralysed', b.scenario.scarf && 'Scarf'].filter(Boolean).join(', ');
  return `${b.scenario.trickRoom ? 'Stay slower than' : 'Outspeed'} ${foe}${mods ? ` (${mods})` : ''}${b.scenario.myTailwind ? ' with my Tailwind' : ''}`;
}

/** "5 Oct 2026" from a saved time. */
export const savedOn = (ms: number): string => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** A new benchmark id. */
export const benchmarkId = (): string => `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** How many of a list of results have drifted from met to not met (what Team check counts). */
export const brokenCount = (results: readonly import('./benchmarkEval').BenchmarkResult[], benchmarks: readonly Benchmark[]): number =>
  results.filter((r) => r.status === 'notmet' && benchmarks.find((b) => b.id === r.id)?.metAtSave).length;
