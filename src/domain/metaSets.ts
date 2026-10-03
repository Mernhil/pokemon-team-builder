/**
 * Meta sets: a playable set for a species from what people actually run (a MetaEntry): its most
 * common ability, item, spread + nature and four moves. Pure and React-free.
 *
 * Reused by the Threat report; the Stat Point optimiser and the bring-4 planner build on the same
 * API. Anything the format doesn't allow (an item, a move, an ability, or the species itself) is
 * dropped and reported rather than silently kept.
 */
import type { Dex } from '@/data/dex';
import type { MegaMode } from './battle/conditions';
import type { MetaEntry, MetaSnapshot } from './meta';
import { createSet } from './team';
import type { FormatRules, PokemonSet } from './types';

/** How many of the most-used species `metaSets` returns by default. */
export const DEFAULT_META_COUNT = 20;

export interface MetaSet {
  speciesId: string;
  /** The species' usage %. */
  usagePct: number;
  set: PokemonSet;
  /** 'both' when the set holds a Mega Stone (Mega in play), else 'base'. */
  megaMode: MegaMode;
  /** Plain-language notes about what was left out because the format doesn't allow it. */
  dropped: string[];
}

/** A stable identity for a meta set (species + its spread), for caches and React keys. */
export const metaSetKey = (m: Pick<MetaSet, 'speciesId' | 'set'>) =>
  `${m.speciesId}:${m.set.nature}:${Object.values(m.set.sp).join('.')}:${m.set.itemId ?? ''}:${m.set.moves.join('.')}`;

/**
 * The set for one meta entry in a format, or undefined when the species isn't legal there (or the
 * entry has no spread data to build a set from).
 */
export function metaSet(entry: MetaEntry, dex: Dex, format: FormatRules): MetaSet | undefined {
  const species = dex.species(entry.speciesId);
  const reg = format.regulationId;
  if (!species || entry.spreads.length === 0) return undefined;
  if (reg && !species.legalIn.includes(reg)) return undefined;
  const dropped: string[] = [];
  const name = species.name;

  // Ability: the most common one the species really has.
  const own = new Set(Object.values(species.abilities).map((a) => dex.ability(a)?.id));
  let abilityId: string | undefined;
  for (const a of entry.abilities) {
    const ab = dex.ability(a.id);
    if (ab && own.has(ab.id)) {
      abilityId ??= ab.id;
    } else if (!abilityId) dropped.push(`${name}: ability ${ab?.name ?? a.id} isn't legal.`);
  }
  abilityId ??= dex.ability(species.abilities['0'])?.id;

  // Item: the most common one the format allows (Mega Stones only for the species that can use them).
  let itemId: string | undefined;
  for (const i of entry.items) {
    const item = dex.item(i.id);
    const legal = !!item && (!reg || item.legalIn.includes(reg)) && (!item.megaStone || !!dex.megaFor(species.id, item.id));
    if (legal) {
      itemId = item!.id;
      break;
    }
    dropped.push(`${name}: item ${item?.name ?? i.id} isn't legal.`);
  }

  // Moves: top by usage, legal only; never four status moves.
  const legalMoves: { id: string; attack: boolean }[] = [];
  for (const m of entry.moves) {
    const mv = dex.move(m.id);
    if (mv && dex.canLearn(species.id, mv.id) && (!reg || mv.legalIn.includes(reg))) legalMoves.push({ id: mv.id, attack: mv.category !== 'Status' });
    else dropped.push(`${name}: move ${mv?.name ?? m.id} isn't legal.`);
  }
  let moves = legalMoves.slice(0, 4);
  if (moves.length === 4 && moves.every((m) => !m.attack)) {
    const attack = legalMoves.slice(4).find((m) => m.attack);
    if (attack) moves = [...moves.slice(0, 3), attack];
  }

  const spread = entry.spreads[0];
  const [hp, atk, def, spa, spd, spe] = spread.values;
  const base = createSet(dex, species.id, format);
  const set: PokemonSet = {
    ...base,
    abilityId,
    itemId,
    nature: dex.nature(spread.nature)?.name ?? base.nature,
    sp: { hp, atk, def, spa, spd, spe },
    moves: [...moves.map((m) => m.id), '', '', '', ''].slice(0, 4) as PokemonSet['moves'],
  };
  const megaMode: MegaMode = dex.megaFor(species.id, itemId) ? 'both' : 'base';
  return { speciesId: species.id, usagePct: entry.usagePct, set, megaMode, dropped };
}

/** Meta sets for the `n` most used species that have one. */
export function metaSets(snapshot: MetaSnapshot, dex: Dex, format: FormatRules, n = DEFAULT_META_COUNT): MetaSet[] {
  const out: MetaSet[] = [];
  for (const entry of snapshot.entries) {
    if (out.length >= n) break;
    const m = metaSet(entry, dex, format);
    if (m) out.push(m);
  }
  return out;
}
