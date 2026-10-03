/**
 * Numbers for the side-by-side Compare view that are neither a set diff (teamDiff.ts) nor
 * calculator output: the two teams' type matrices lined up, and a Speed summary against the meta ladder.
 */
import type { DefenseRow, OffenseRow } from './coverage';
import type { SpeedRow } from './speedTiers';
import type { TypeName } from './types';

export interface MatrixCompareRow {
  type: TypeName;
  a: { good: number; bad: number };
  b: { good: number; bad: number };
  /** The two teams differ on this type. */
  differs: boolean;
}

/** Defensive matrices side by side: good = members resisting, bad = members weak. */
export function compareDefense(a: DefenseRow[], b: DefenseRow[]): MatrixCompareRow[] {
  const bBy = new Map(b.map((r) => [r.atkType, r]));
  return a.map((r) => {
    const o = bBy.get(r.atkType);
    const x = { good: r.resist, bad: r.weak };
    const y = { good: o?.resist ?? 0, bad: o?.weak ?? 0 };
    return { type: r.atkType, a: x, b: y, differs: x.good !== y.good || x.bad !== y.bad };
  });
}

/** Offensive matrices side by side: good = members hitting it super effectively, bad = members walled by it. */
export function compareOffense(a: OffenseRow[], b: OffenseRow[]): MatrixCompareRow[] {
  const bBy = new Map(b.map((r) => [r.defType, r]));
  return a.map((r) => {
    const o = bBy.get(r.defType);
    const x = { good: r.superEffective, bad: r.walled };
    const y = { good: o?.superEffective ?? 0, bad: o?.walled ?? 0 };
    return { type: r.defType, a: x, b: y, differs: x.good !== y.good || x.bad !== y.bad };
  });
}

export interface SpeedLine {
  slot: number;
  speciesId: string;
  name: string;
  speed: number;
  mega: boolean;
  /** Meta rows this Pokémon is faster than. */
  outspeeds: number;
  /** Meta rows in the ladder. */
  total: number;
}

/**
 * One line per team member, fastest first: its (fastest forme's) Speed and how many of the ladder's
 * most-used meta Speeds it beats outright. Ties don't count as beating.
 */
export function speedSummary(ladder: SpeedRow[]): SpeedLine[] {
  const meta = ladder.filter((r) => !r.mine);
  const best = new Map<number, SpeedRow>();
  for (const r of ladder) if (r.mine && r.slot !== undefined) if (!best.has(r.slot) || r.speed > best.get(r.slot)!.speed) best.set(r.slot, r);
  return [...best.values()]
    .map((r): SpeedLine => ({ slot: r.slot!, speciesId: r.speciesId, name: r.name, speed: r.speed, mega: r.forme === 'mega', outspeeds: meta.filter((m) => m.speed < r.speed).length, total: meta.length }))
    .sort((x, y) => y.speed - x.speed || x.slot - y.slot);
}
