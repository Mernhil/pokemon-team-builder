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
// Unified entry point
// ---------------------------------------------------------------------------

export function calcStats(
  baseStats: StatTable,
  set: Pick<PokemonSet, 'sp' | 'evs' | 'ivs' | 'level'>,
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
        const dvs = { atk: set.ivs.atk, def: set.ivs.def, spe: set.ivs.spe, spa: set.ivs.spa };
        const dv = s === 'hp' ? gbHpDV(dvs) : s === 'spd' ? set.ivs.spa : set.ivs[s];
        const exp = s === 'spd' ? set.evs.spa : set.evs[s];
        out[s] = gbStat(s, baseStats[s], dv, exp, level);
        break;
      }
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
  if (sys.kind === 'gb-statexp') return null;
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
