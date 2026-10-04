/**
 * Usage as a meta source gives it: a % of teams (Smogon, replays, team lists), or only a rank
 * (Pokémon Champions' in-game Battle Data). Dependency-free, so the threat worker can use it.
 */
export type Usage = { usagePct?: number; usageRank?: number };
/** "47.2%", or "#3" for rank-only data. */
export const usageLabel = (u: Usage): string => (u.usagePct !== undefined ? `${u.usagePct.toFixed(1)}%` : u.usageRank !== undefined ? `#${u.usageRank}` : '');
/** "47.2% usage" / "#3 in usage", for running text. */
export const usageText = (u: Usage): string => (u.usagePct !== undefined ? `${u.usagePct.toFixed(1)}% usage` : u.usageRank !== undefined ? `#${u.usageRank} in usage` : '');
/** Sort helper, most used first: by %, else by rank. */
export const byUsage = (a: Usage, b: Usage): number => (b.usagePct ?? -1) - (a.usagePct ?? -1) || (a.usageRank ?? Number.MAX_SAFE_INTEGER) - (b.usageRank ?? Number.MAX_SAFE_INTEGER);
