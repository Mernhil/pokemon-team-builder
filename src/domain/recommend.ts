/**
 * Recommendations for one Pokémon from the meta data: the items, abilities, moves and spreads people
 * actually run on it, in the order they're used, limited to what the format allows. Pure and React-free;
 * `metaSet` (src/domain/metaSets.ts) builds the full recommended set the same way.
 */
import type { Dex } from '@/data/dex';
import type { MetaEntry, MetaSnapshot } from './meta';
import { metaSet, type MetaSet } from './metaSets';
import type { FormatRules } from './types';

export interface Share {
  id: string;
  name: string;
  /** % of this Pokémon's sets that use it. */
  pct: number;
}

export interface Recommendation {
  speciesId: string;
  /** The Pokémon's own usage: a %, or (in-game data) a rank. */
  usagePct?: number;
  usageRank?: number;
  items: Share[];
  abilities: Share[];
  moves: Share[];
  /** Its most common spreads (nature + the six values), most used first. */
  spreads: { nature: string; values: [number, number, number, number, number, number]; pct: number }[];
  /** The whole recommended set, ready to apply (undefined when there's no spread data to build one from). */
  set?: MetaSet;
}

const COUNT = 5;

/** What the meta data recommends for a species in a format, or undefined when it has no entry. */
export function recommendFor(snapshot: MetaSnapshot, speciesId: string, dex: Dex, format: FormatRules): Recommendation | undefined {
  const entry: MetaEntry | undefined = snapshot.entries.find((e) => e.speciesId === speciesId);
  const species = dex.species(speciesId);
  if (!entry || !species) return undefined;
  const reg = format.regulationId;

  const items: Share[] = [];
  for (const i of entry.items) {
    const item = dex.item(i.id);
    const legal = !!item && (!reg || item.legalIn.includes(reg)) && (!item.megaStone || !!dex.megaFor(species.id, item.id));
    if (legal) items.push({ id: item!.id, name: item!.name, pct: i.pct });
  }
  const own = new Set(Object.values(species.abilities).map((a) => dex.ability(a)?.id));
  const abilities: Share[] = [];
  for (const a of entry.abilities) {
    const ab = dex.ability(a.id);
    if (ab && own.has(ab.id)) abilities.push({ id: ab.id, name: ab.name, pct: a.pct });
  }
  const moves: Share[] = [];
  for (const m of entry.moves) {
    const mv = dex.move(m.id);
    if (mv && dex.canLearn(species.id, mv.id) && (!reg || mv.legalIn.includes(reg))) moves.push({ id: mv.id, name: mv.name, pct: m.pct });
  }
  return {
    speciesId,
    usagePct: entry.usagePct,
    usageRank: entry.usageRank,
    items: items.slice(0, COUNT),
    abilities: abilities.slice(0, 3),
    moves: moves.slice(0, 8),
    spreads: entry.spreads.slice(0, 3).map((s) => ({ nature: dex.nature(s.nature)?.name ?? s.nature, values: s.values, pct: s.pct })),
    set: metaSet(entry, dex, format),
  };
}
