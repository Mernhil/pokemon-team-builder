/**
 * Damage calculator adapter over @smogon/calc (the Pokémon Showdown calculator).
 *
 * Champions: the calculator's dedicated Champions mechanics module (generation 0), where EVs are
 * Stat Points, level is 50 and IVs are 31 — so our sets map across 1:1.
 * Gen 1–9: that generation's own mechanics module (Gen 1 crits, the type-based physical/special
 * split, Gen 2–4 ??? Curse, …). Gen 1–2 sets go in as Showdown does: EV = ⌈√Stat Exp⌉, IV = 2 × DV.
 */
import { Field, Generations, Move as CalcMove, Pokemon as CalcPokemon, Side, calculate } from '@smogon/calc';
import { getFinalSpeed } from '@smogon/calc/dist/mechanics/util';
import type { Dex } from '@/data/dex';
import { datasetMechanics } from '../games';
import { mechanics } from '../generations';
import { FORMATS } from '../formats';
import { calcStats, statExpToEV } from '../stats';
import { STAT_IDS, type PokemonSet, type StatTable, type TypeName } from '../types';
import type { FieldConditions, SideConditions } from './conditions';

/** The calculator generation for a dataset: 0 (Champions) or the dataset's generation. */
const calcGen = (dex: Dex) => Generations.get((dex.data.generation ?? 0) as never);
type CalcGen = ReturnType<typeof calcGen>;
const mapStats = (t: StatTable, f: (v: number) => number) => Object.fromEntries(STAT_IDS.map((s) => [s, f(t[s])])) as StatTable;

export interface CalcSideInput {
  set: PokemonSet;
  cond: SideConditions;
}

export interface MoveResult {
  moveId: string;
  name: string;
  type: string;
  category: string;
  /** Damage range [min, max] in HP. */
  range: [number, number];
  /** Same range as % of the defender's max HP. */
  percent: [number, number];
  /** All 16 damage rolls (per hit for multi-hit moves: summed). */
  rolls: number[];
  koText: string;
  desc: string;
  defenderHP: number;
  defenderCurHP: number;
  crit: boolean;
}

/** Species name the calculator knows for a dataset species (cosmetic formes → base). */
function calcSpeciesName(dex: Dex, gen: CalcGen, id: string): string {
  const sp = dex.species(id)!;
  for (const name of [sp.name, `${sp.name}-Shield`, sp.baseSpecies]) {
    if (gen.species.get(name.toLowerCase().replace(/[^a-z0-9]/g, '') as never)) return name;
  }
  return sp.baseSpecies;
}

/** The forme in battle: Mega forme when toggled on and the stone is held. */
export function battleForme(dex: Dex, set: PokemonSet, cond: SideConditions) {
  const base = dex.species(set.speciesId);
  const mega = cond.mega ? dex.megaFor(set.speciesId, set.itemId) : undefined;
  return mega ?? base;
}

/**
 * A calculator Pokémon whose stats are given rather than computed — for games whose stat formula
 * @smogon/calc doesn't know (Let's Go's AVs and friendship). Clones keep the given stats.
 */
class FixedStatsPokemon extends CalcPokemon {
  fixedStats?: StatTable;
  clone(): CalcPokemon {
    const c = super.clone();
    if (this.fixedStats) {
      c.rawStats = { ...this.fixedStats };
      c.stats = { ...this.fixedStats };
      c.originalCurHP = Math.min(this.originalCurHP, this.fixedStats.hp);
    }
    return c;
  }
}

export function toCalcPokemon(dex: Dex, set: PokemonSet, cond: SideConditions): CalcPokemon {
  const gen = calcGen(dex);
  const g = dex.data.generation;
  const mech = datasetMechanics(dex.data.id, g ?? 9);
  const forme = battleForme(dex, set, cond)!;
  const isMega = forme.id !== set.speciesId;
  const ability = !mech.abilities ? undefined : isMega ? Object.values(forme.abilities)[0] : dex.ability(set.abilityId)?.name;
  const item = mech.heldItems ? dex.item(set.itemId)?.name : undefined;
  const spread = !g
    ? { evs: { ...set.sp }, ivs: mapStats(set.ivs, () => 31), level: 50 }
    : g <= 2
      ? { evs: mapStats(set.evs, statExpToEV), ivs: mapStats(set.ivs, (dv) => Math.min(15, dv) * 2), level: set.level }
      : { evs: { ...set.evs }, ivs: { ...set.ivs }, level: set.level };
  const game = FORMATS.find((f) => f.game && f.datasetId === dex.data.id);
  const fixed = game?.statSystem.kind === 'lgpe-av' ? calcStats(forme.baseStats, set, game, dex.nature(set.nature)) : undefined;
  const p = new (fixed ? FixedStatsPokemon : CalcPokemon)(gen, calcSpeciesName(dex, gen, forme.id), {
    level: spread.level,
    nature: (mech.natures ? set.nature : undefined) as never,
    ability: ability as never,
    abilityOn: cond.abilityOn,
    item: item as never,
    evs: spread.evs,
    ivs: spread.ivs,
    boosts: { ...cond.boosts, hp: 0 },
    status: (cond.status || '') as never,
    teraType: (!g || g === 9) && cond.tera && set.teraType ? (set.teraType as never) : undefined,
    // Keep our (announcement-patched) typing and stats authoritative.
    overrides: { types: forme.types as [TypeName] | [TypeName, TypeName], baseStats: forme.baseStats } as never,
  });
  if (fixed) {
    (p as FixedStatsPokemon).fixedStats = fixed;
    p.rawStats = { ...fixed };
    p.stats = { ...fixed };
  }
  const max = p.maxHP();
  p.originalCurHP = Math.max(1, Math.round((max * Math.max(1, Math.min(100, cond.hpPercent))) / 100));
  return p;
}

function side(c: SideConditions): Side {
  return new Side({
    isReflect: c.reflect,
    isLightScreen: c.lightScreen,
    isAuroraVeil: c.auroraVeil,
    isHelpingHand: c.helpingHand,
    isFriendGuard: c.friendGuard,
    isTailwind: c.tailwind,
  });
}

export function toCalcField(field: FieldConditions, attacker: SideConditions, defender: SideConditions, gen = 9): Field {
  const mech = mechanics(gen);
  // "Snow" was Hail until Gen 9; terrain starts in Gen 6; Gen 1–2 battles were always singles.
  const weather = !mech.weather ? '' : field.weather === 'Snow' ? mech.snowName : field.weather;
  return new Field({
    gameType: mech.doubles ? field.gameType : 'Singles',
    weather: (weather || undefined) as never,
    terrain: (mech.terrain ? field.terrain || undefined : undefined) as never,
    isGravity: field.gravity,
    attackerSide: side(attacker),
    defenderSide: side(defender),
  });
}

/** Damage of each of the attacker's moves against the defender. */
export function calcMoves(
  dex: Dex,
  attacker: CalcSideInput,
  defender: CalcSideInput,
  field: FieldConditions,
  crits: boolean[] = [],
): MoveResult[] {
  const a = toCalcPokemon(dex, attacker.set, attacker.cond);
  const d = toCalcPokemon(dex, defender.set, defender.cond);
  const f = toCalcField(field, attacker.cond, defender.cond, dex.generation);
  const gen = calcGen(dex);
  const out: MoveResult[] = [];
  attacker.set.moves.forEach((moveId, i) => {
    const mv = dex.move(moveId);
    if (!mv) return;
    const crit = !!crits[i];
    const move = new CalcMove(gen, mv.name, { isCrit: crit });
    const r = calculate(gen, a, d, move, f);
    const [min, max] = safeRange(r);
    const maxHP = d.maxHP();
    let koText = '';
    let desc = '';
    try {
      koText = r.kochance().text;
    } catch {
      /* status or immune */
    }
    try {
      desc = r.desc();
    } catch {
      desc = `${mv.name}: no damage`;
    }
    out.push({
      moveId,
      name: mv.name,
      type: move.type,
      category: move.category,
      range: [min, max],
      percent: [pct(min, maxHP), pct(max, maxHP)],
      rolls: flatRolls(r.damage),
      koText,
      desc,
      defenderHP: maxHP,
      defenderCurHP: d.curHP(),
      crit,
    });
  });
  return out;
}

const pct = (n: number, of: number) => Math.round((n / of) * 1000) / 10;

function safeRange(r: ReturnType<typeof calculate>): [number, number] {
  try {
    const [min, max] = r.range();
    return [min, max];
  } catch {
    return [0, 0];
  }
}

function flatRolls(d: number | number[] | number[][]): number[] {
  if (typeof d === 'number') return [d];
  if (Array.isArray(d[0])) {
    // multi-hit: sum the per-hit rolls index-wise
    const hits = d as number[][];
    return hits[0].map((_, i) => hits.reduce((a, h) => a + h[i], 0));
  }
  return d as number[];
}

/** Final speed as the calculator sees it (for turn order). */
export function calcSpeed(dex: Dex, input: CalcSideInput, field: FieldConditions): number {
  const p = toCalcPokemon(dex, input.set, input.cond);
  const f = toCalcField(field, input.cond, input.cond, dex.generation);
  return getFinalSpeed(calcGen(dex), p, f, f.attackerSide);
}
