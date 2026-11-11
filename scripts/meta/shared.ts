/** Constants and small lookups shared by the meta source modules and scripts/check-meta.ts. */
import type { Context, Regulation } from './context.ts';

/** The in-game Battle Data mirror (INGAME_DATA_BASE overrides it), without a trailing slash. */
export const INGAME_BASE = (process.env.INGAME_DATA_BASE || 'https://raw.githubusercontent.com/Gheist23/pokemonbattledata/main/data/meta').replace(/\/$/, '');

/** Smogon's monthly usage statistics. */
export const SMOGON_STATS = 'https://www.smogon.com/stats/';
/** Smogon's VGC cutoffs, best first. */
export const CUTOFFS = [1760, 1630, 1500, 0];

/** Days of `month` (YYYY-MM) the regulation was live. */
export function liveDays(reg: Regulation, month: string): number {
  const from = Math.max(Date.parse(`${month}-01T00:00:00Z`), Date.parse(reg.start));
  const [y, m] = month.split('-').map(Number);
  const to = Math.min(Date.UTC(y, m, 1), reg.end ? Date.parse(reg.end) : Infinity);
  return Math.max(0, (to - from) / 86_400_000);
}

/** The regulation live on `iso` (YYYY-MM-DD), if any. */
export const regulationOn = (ctx: Context, iso: string) => ctx.regulations.find((r) => r.start.slice(0, 10) <= iso && (!r.end || iso <= r.end.slice(0, 10)));
