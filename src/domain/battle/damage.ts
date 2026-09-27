/**
 * Damage calculator adapter over @smogon/calc (the Pokémon Showdown calculator), which ships a
 * dedicated Pokémon Champions mechanics module as generation 0. In that generation, EVs are
 * Stat Points, level is 50 and IVs are 31 — so our sets map across 1:1.
 */
import { Field, Generations, Move as CalcMove, Pokemon as CalcPokemon, Side, calculate } from '@smogon/calc';
import { getFinalSpeed } from '@smogon/calc/dist/mechanics/util';
import type { Dex } from '@/data/dex';
import type { PokemonSet, TypeName } from '../types';
import type { FieldConditions, SideConditions } from './conditions';

const gen = Generations.get(0 as never);

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
function calcSpeciesName(dex: Dex, id: string): string {
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

export function toCalcPokemon(dex: Dex, set: PokemonSet, cond: SideConditions): CalcPokemon {
  const forme = battleForme(dex, set, cond)!;
  const isMega = forme.id !== set.speciesId;
  const ability = isMega ? Object.values(forme.abilities)[0] : dex.ability(set.abilityId)?.name;
  const item = dex.item(set.itemId)?.name;
  const p = new CalcPokemon(gen, calcSpeciesName(dex, forme.id), {
    level: 50,
    nature: set.nature as never,
    ability: ability as never,
    abilityOn: cond.abilityOn,
    item: item as never,
    evs: { ...set.sp },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    boosts: { ...cond.boosts, hp: 0 },
    status: (cond.status || '') as never,
    teraType: cond.tera && set.teraType ? (set.teraType as never) : undefined,
    // Keep our (announcement-patched) typing and stats authoritative.
    overrides: { types: forme.types as [TypeName] | [TypeName, TypeName], baseStats: forme.baseStats } as never,
  });
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

export function toCalcField(field: FieldConditions, attacker: SideConditions, defender: SideConditions): Field {
  return new Field({
    gameType: field.gameType,
    weather: (field.weather || undefined) as never,
    terrain: (field.terrain || undefined) as never,
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
  const f = toCalcField(field, attacker.cond, defender.cond);
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
  const f = toCalcField(field, input.cond, input.cond);
  return finalSpeed(p, f);
}

function finalSpeed(p: CalcPokemon, f: Field): number {
  return getFinalSpeed(gen, p, f, f.attackerSide);
}
