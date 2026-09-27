import {
  STAT_IDS,
  type FormatRules,
  type Nature,
  type PokemonSet,
  type StatId,
  type StatSystem,
  type StatTable,
} from './types';

/** Nature multiplier applied as floor(stat * 110 / 100) — matches the games' integer math. */
export function applyNature(stat: number, statId: StatId, nature?: Nature): number {
  if (!nature || statId === 'hp') return stat;
  if (nature.plus === statId && nature.minus !== statId) return Math.floor((stat * 110) / 100);
  if (nature.minus === statId && nature.plus !== statId) return Math.floor((stat * 90) / 100);
  return stat;
}

export function natureModifier(statId: StatId, nature?: Nature): 1 | 1.1 | 0.9 {
  if (!nature || statId === 'hp' || nature.plus === nature.minus) return 1;
  if (nature.plus === statId) return 1.1;
  if (nature.minus === statId) return 0.9;
  return 1;
}

// ---------------------------------------------------------------------------
// Pokémon Champions (Lv 50, 31 IVs, Stat Points)
//   HP    = Base + SP + 75
//   Other = floor((Base + SP + 20) × alignment)
// These are exactly the Lv 50 / 31 IV forms of the main-series formula, with 1 SP = +1 stat.
// ---------------------------------------------------------------------------

export function championsStat(statId: StatId, base: number, sp: number, nature?: Nature): number {
  if (statId === 'hp') return base === 1 ? 1 : base + sp + 75;
  return applyNature(base + sp + 20, statId, nature);
}

// ---------------------------------------------------------------------------
// Gen 3–9 main series
//   HP    = floor((2B + IV + floor(EV/4)) × L / 100) + L + 10
//   Other = floor((floor((2B + IV + floor(EV/4)) × L / 100) + 5) × nature)
// ---------------------------------------------------------------------------

export function modernStat(
  statId: StatId,
  base: number,
  iv: number,
  ev: number,
  level: number,
  nature?: Nature,
): number {
  const core = Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100);
  if (statId === 'hp') return base === 1 ? 1 : core + level + 10;
  return applyNature(core + 5, statId, nature);
}

// ---------------------------------------------------------------------------
// Gen 1–2 (DVs 0–15, Stat Exp 0–65535, no natures)
//   bonus = floor(ceil(sqrt(statExp)) / 4)   (capped at 63)
//   HP    = floor(((B + DV) × 2 + bonus) × L / 100) + L + 10
//   Other = floor(((B + DV) × 2 + bonus) × L / 100) + 5
// HP DV = (Atk&1)<<3 | (Def&1)<<2 | (Spe&1)<<1 | (Spc&1)
// ---------------------------------------------------------------------------

export function gbStatExpBonus(statExp: number): number {
  return Math.min(63, Math.floor(Math.ceil(Math.sqrt(Math.max(0, statExp))) / 4));
}

export function gbHpDV(dvs: { atk: number; def: number; spe: number; spa: number }): number {
  return ((dvs.atk & 1) << 3) | ((dvs.def & 1) << 2) | ((dvs.spe & 1) << 1) | (dvs.spa & 1);
}

export function gbStat(statId: StatId, base: number, dv: number, statExp: number, level: number): number {
  const core = Math.floor((((base + dv) * 2 + gbStatExpBonus(statExp)) * level) / 100);
  return statId === 'hp' ? core + level + 10 : core + 5;
}

// ---------------------------------------------------------------------------
// Let's Go, Pikachu! / Eevee! (PKHeX PB7.LoadStats)
//   HP    = AV + floor((2B + IV) × L / 100) + L + 10
//   Other = AV + floor(friendship% × floor((floor((2B + IV) × L / 100) + 5) × nature) / 100)
//   friendship% = ⌊(friendship / 255 / 10 + 1) × 100⌋  (100–110), computed in 32-bit floats
// ---------------------------------------------------------------------------

export function lgpeFriendshipPercent(friendship: number): number {
  const f = Math.fround;
  return Math.trunc(f(f(f(f(Math.max(0, Math.min(255, friendship)) / 255) / 10) + 1) * 100));
}

export function lgpeStat(statId: StatId, base: number, iv: number, av: number, level: number, friendship: number, nature?: Nature): number {
  const core = Math.floor(((2 * base + iv) * level) / 100);
  if (statId === 'hp') return av + core + 10 + level;
  return av + Math.floor((lgpeFriendshipPercent(friendship) * applyNature(core + 5, statId, nature)) / 100);
}

// ---------------------------------------------------------------------------
// Legends: Arceus (PKHeX PA8.LoadStats, GanbaruExtensions), in the game's 32-bit float arithmetic
//   bonus = round((√B × M[EL] + L) / 2.5)          M = 0, 2, 3, 4, 7, 8, 9, 14, 15, 16, 25
//   HP    = bonus + ⌊(L/100 + 1) × B + L⌋
//   Other = bonus + ⌊⌊(L/50 + 1) × B / 1.5⌋ × nature⌋
// ---------------------------------------------------------------------------

const EFFORT_MULTIPLIER = [0, 2, 3, 4, 7, 8, 9, 14, 15, 16, 25];

export function plaEffortBonus(base: number, effortLevel: number, level: number): number {
  const f = Math.fround;
  const mul = EFFORT_MULTIPLIER[Math.max(0, Math.min(10, Math.round(effortLevel)))];
  const v = f(f(f(Math.sqrt(base) * mul) + level) / 2.5);
  return Math.sign(v) * Math.round(Math.abs(v)); // MidpointRounding.AwayFromZero
}

export function plaStat(statId: StatId, base: number, effortLevel: number, level: number, nature?: Nature): number {
  const f = Math.fround;
  const bonus = plaEffortBonus(base, effortLevel, level);
  if (statId === 'hp') return bonus + Math.trunc(f(f(f(f(level / 100) + 1) * base) + level));
  return bonus + applyNature(Math.trunc(f(f(f(f(level / 50) + 1) * base) / 1.5)), statId, nature);
}

// ---------------------------------------------------------------------------
// Unified entry point
// ---------------------------------------------------------------------------

export function calcStats(
  baseStats: StatTable,
  set: Pick<PokemonSet, 'sp' | 'evs' | 'ivs' | 'level' | 'friendship'>,
  format: FormatRules,
  nature?: Nature,
): StatTable {
  const sys = format.statSystem;
  const level = format.level.fixed ?? set.level;
  const out = {} as StatTable;
  for (const s of STAT_IDS) {
    switch (sys.kind) {
      case 'champions-sp':
        out[s] = championsStat(s, baseStats[s], set.sp[s], nature);
        break;
      case 'modern-ev':
        out[s] = modernStat(s, baseStats[s], format.fixedIVs ?? set.ivs[s], set.evs[s], level, nature);
        break;
      case 'gb-statexp': {
        // Legacy mapping: ivs holds DVs (0–15), evs holds Stat Exp. Special uses spa.
        // Clamp so a set carried over from an IV-based format (31s) reads as max DVs.
        const d = (k: StatId) => Math.max(0, Math.min(sys.dvMax, set.ivs[k]));
        const dvs = { atk: d('atk'), def: d('def'), spe: d('spe'), spa: d('spa') };
        const dv = s === 'hp' ? gbHpDV(dvs) : s === 'spd' ? dvs.spa : d(s);
        const exp = Math.min(sys.statExpMax, s === 'spd' ? set.evs.spa : set.evs[s]);
        out[s] = gbStat(s, baseStats[s], dv, exp, level);
        break;
      }
      case 'lgpe-av':
        out[s] = lgpeStat(s, baseStats[s], set.ivs[s], set.evs[s], level, set.friendship ?? 255, nature);
        break;
      case 'pla-effort':
        out[s] = plaStat(s, baseStats[s], set.evs[s], level, nature);
        break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Budget helpers (Champions SP / modern EVs)
// ---------------------------------------------------------------------------

export const sumStats = (t: StatTable): number => STAT_IDS.reduce((a, s) => a + t[s], 0);

export interface Budget {
  used: number;
  cap: number;
  perStatCap: number;
  remaining: number;
  status: 'under' | 'complete' | 'over';
}

export function spendBudget(sys: StatSystem, spread: StatTable): Budget | null {
  if (sys.kind !== 'champions-sp' && sys.kind !== 'modern-ev') return null;
  const used = sumStats(spread);
  const remaining = sys.totalCap - used;
  return {
    used,
    cap: sys.totalCap,
    perStatCap: sys.perStatCap,
    remaining,
    status: remaining < 0 ? 'over' : remaining === 0 ? 'complete' : 'under',
  };
}

/**
 * Set one stat of a spread, clamping to the per-stat cap and to what the total budget allows.
 * Returns a new spread; never produces an over-budget result.
 */
export function setSpreadValue(
  spread: StatTable,
  stat: StatId,
  value: number,
  totalCap: number,
  perStatCap: number,
): StatTable {
  const others = sumStats(spread) - spread[stat];
  const room = Math.max(0, totalCap - others);
  const v = Math.max(0, Math.min(perStatCap, room, Math.round(Number.isFinite(value) ? value : 0)));
  return { ...spread, [stat]: v };
}

/**
 * Smallest SP investment that reaches a target stat value (Champions). Returns null if the
 * target is unreachable within the per-stat cap.
 */
export function spForTarget(
  statId: StatId,
  base: number,
  target: number,
  perStatCap: number,
  nature?: Nature,
): number | null {
  for (let sp = 0; sp <= perStatCap; sp++) {
    if (championsStat(statId, base, sp, nature) >= target) return sp;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Generic "invest to reach a target" (Champions SP, EVs, Stat Exp)
// ---------------------------------------------------------------------------

/** Which spread field a stat system edits: Champions → sp; EVs and Stat Exp → evs. */
export const spreadKey = (sys: StatSystem): 'sp' | 'evs' => (sys.kind === 'champions-sp' ? 'sp' : 'evs');

/** Max investment in one stat, and the step the UI moves in (EVs count in 4s; Stat Exp in 1s). */
export function investRange(sys: StatSystem): { max: number; step: number } {
  if (sys.kind === 'champions-sp') return { max: sys.perStatCap, step: 1 };
  if (sys.kind === 'modern-ev') return { max: sys.perStatCap, step: 4 };
  if (sys.kind === 'lgpe-av') return { max: sys.avMax, step: 1 };
  if (sys.kind === 'pla-effort') return { max: sys.levelMax, step: 1 };
  return { max: sys.statExpMax, step: 1 };
}

/**
 * Smallest investment (SP, EVs or Stat Exp) that brings one stat to at least `target`, keeping the
 * rest of the set as is. Returns null if even the maximum falls short.
 */
export function investmentForTarget(
  statId: StatId,
  baseStats: StatTable,
  target: number,
  set: Pick<PokemonSet, 'sp' | 'evs' | 'ivs' | 'level' | 'friendship'>,
  format: FormatRules,
  nature?: Nature,
): number | null {
  const sys = format.statSystem;
  const key = spreadKey(sys);
  const { max, step } = investRange(sys);
  const statOf = (v: number) => calcStats(baseStats, { ...set, [key]: { ...set[key], [statId]: v } }, format, nature)[statId];
  if (statOf(max) < target) return null;
  if (sys.kind === 'gb-statexp') {
    // Stat Exp only matters through ⌊⌈√x⌉/4⌋: test the smallest value of each bonus step.
    for (let bonus = 0; bonus <= 63; bonus++) {
      const v = Math.min(max, (bonus * 4 - 1) ** 2 + 1);
      if (statOf(bonus === 0 ? 0 : v) >= target) return bonus === 0 ? 0 : v;
    }
    return max;
  }
  for (let v = 0; v <= max; v += step) if (statOf(v) >= target) return v;
  return max;
}

/** Gen 1–2 Stat Exp ↔ Showdown EVs (Showdown stores ⌈√StatExp⌉ as the EV; 252 EVs = max). */
export const statExpToEV = (statExp: number) => Math.min(252, Math.ceil(Math.sqrt(Math.max(0, statExp))));
export const evToStatExp = (ev: number) => Math.min(65535, Math.max(0, ev) ** 2);

/**
 * A set with one spread value changed, clamped to the stat system's rules: SP/EV caps, IVs 0–31,
 * Stat Exp 0–65535 and DVs 0–15 (Gen 1–2 keep Sp. Atk and Sp. Def on one Special value).
 */
export function withSpreadValue<T extends Pick<PokemonSet, 'sp' | 'evs' | 'ivs'>>(
  p: T,
  sys: StatSystem,
  kind: 'sp' | 'evs' | 'ivs',
  stat: StatId,
  value: number,
): T {
  const special = sys.kind === 'gb-statexp' && stat === 'spa';
  const n = Math.round(Number.isFinite(value) ? value : 0) || 0;
  if (kind === 'ivs') {
    const v = Math.max(0, Math.min(sys.kind === 'gb-statexp' ? sys.dvMax : 31, n));
    if (sys.kind === 'pla-effort') return p; // Legends: Arceus shows Effort Levels, which already include IVs
    return { ...p, ivs: { ...p.ivs, [stat]: v, ...(special ? { spd: v } : {}) } };
  }
  if (sys.kind === 'gb-statexp') {
    const v = Math.max(0, Math.min(sys.statExpMax, n));
    return { ...p, evs: { ...p.evs, [stat]: v, ...(special ? { spd: v } : {}) } };
  }
  if (sys.kind === 'lgpe-av' || sys.kind === 'pla-effort') {
    // No shared cap: each stat trains on its own.
    return { ...p, evs: { ...p.evs, [stat]: Math.max(0, Math.min(sys.kind === 'lgpe-av' ? sys.avMax : sys.levelMax, n)) } };
  }
  return { ...p, [kind]: setSpreadValue(p[kind], stat, value, sys.totalCap, sys.perStatCap) };
}
