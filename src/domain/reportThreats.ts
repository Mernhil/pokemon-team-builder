/**
 * The opponents of the OHKO report: the most-used sets ("top N"), or every Pokémon the regulation allows
 * ("details"), each with the player's own build when they made one. Pure and React-free.
 *
 * The details list is the Reverse search's candidates: meta-backed species first (by usage), then the
 * rest with a computed default build, then every Mega-capable species holding a stone it isn't holding
 * already ("with <Stone>"), so the Megas show up as their own rows.
 */
import type { Dex } from '@/data/dex';
import type { MetaSnapshot } from './meta';
import { metaSets, type MetaSet } from './metaSets';
import { buildCandidates, candidateKey, targetMegaMode, type BuildOverrides } from './reverseSearch';
import type { FormatRules } from './types';
import { byUsage } from './usage.ts';

export interface ReportThreat extends MetaSet {
  /** Unique within a list: the species, plus `:stone` for a "with <Stone>" row. */
  key: string;
  /** A row that only holds this stone to be tried as the Mega (not a set anyone plays). */
  withStone?: string;
  /** The player's own build of the species is in use. */
  custom?: boolean;
}

/** The `count` most-used sets, the player's own builds in place of theirs. */
export function topThreats(dex: Dex, format: FormatRules, snapshot: MetaSnapshot, count: number, builds: BuildOverrides = {}): ReportThreat[] {
  return metaSets(snapshot, dex, format, count).map((t) => {
    const own = builds[t.speciesId];
    return own ? { ...t, key: t.speciesId, set: own, megaMode: targetMegaMode(dex, format, own), dropped: [], custom: true } : { ...t, key: t.speciesId };
  });
}

/** Every Pokémon the format allows, meta-backed ones first, "with <Stone>" rows last. */
export function everyThreat(dex: Dex, format: FormatRules, snapshot: MetaSnapshot, builds: BuildOverrides = {}): ReportThreat[] {
  const rows = buildCandidates(dex, format, snapshot, { overrides: builds, tryStones: true }).map<ReportThreat>((c) => ({
    key: candidateKey(c),
    speciesId: c.speciesId,
    // A stone row's usage is its species' own, which it doesn't have: left off.
    usagePct: c.withStone ? undefined : c.usagePct,
    usageRank: c.withStone ? undefined : c.usageRank,
    set: c.set,
    // A set holding its stone Megas as it moves (like the top-N sets); the player can still flip it to Base.
    megaMode: c.megaMode === 'both' ? 'mega' : c.megaMode,
    dropped: [],
    withStone: c.withStone,
    custom: c.build === 'custom',
  }));
  const tier = (t: ReportThreat) => (t.withStone ? 2 : t.usagePct !== undefined || t.usageRank !== undefined ? 0 : 1);
  // Array#sort is stable: within a tier the species keep the Dex order.
  return rows.sort((a, b) => tier(a) - tier(b) || (tier(a) === 0 ? byUsage(a, b) : 0));
}
