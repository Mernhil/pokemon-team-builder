/**
 * Smogon's monthly usage statistics, https://www.smogon.com/stats/ — the "chaos" JSON files, from
 * rated battles on the Pokémon Showdown ladder. The best source once a regulation's first month is
 * published (a few days after the month ends).
 */
import { chaosToSnapshot, type MetaSnapshot } from '../../src/domain/meta.ts';
import { get } from './http.ts';
import type { Context, Regulation } from './context.ts';

const STATS = 'https://www.smogon.com/stats/';
/** Smogon's VGC cutoffs, best first. */
const CUTOFFS = [1760, 1630, 1500, 0];

/** Stats months on the index page, newest first ("2026-08", …; the -DLC variants are skipped). */
export async function listMonths(): Promise<string[]> {
  const res = await get(STATS);
  if (!res) throw new Error(`Couldn't read ${STATS}`);
  const html = await res.text();
  return [...new Set([...html.matchAll(/href="(\d{4}-\d{2})\/"/g)].map((m) => m[1]))].sort().reverse();
}

async function findChaos(ctx: Context, reg: Regulation, months: string[]) {
  for (const month of monthsToTry(reg, months)) {
    for (const format of ctx.formatIds(reg)) {
      for (const cutoff of CUTOFFS) {
        const url = `${STATS}${month}/chaos/${format}-${cutoff}.json`;
        const res = await get(url);
        if (res) return { month, format, cutoff, url, json: (await res.json()) as unknown };
      }
    }
  }
  return null;
}

/** Days of `month` (YYYY-MM) the regulation was live. */
function liveDays(reg: Regulation, month: string): number {
  const from = Math.max(Date.parse(`${month}-01T00:00:00Z`), Date.parse(reg.start));
  const [y, m] = month.split('-').map(Number);
  const to = Math.min(Date.UTC(y, m, 1), reg.end ? Date.parse(reg.end) : Infinity);
  return Math.max(0, (to - from) / 86_400_000);
}

/**
 * Newest first, but months the regulation was live for at least two weeks before the rest: an ended
 * regulation's last stats month can hold just a few days of it (Reg M-B ended on 2 September, so
 * September has two days), and Showdown keeps the old format's ladder open after it ends.
 */
function monthsToTry(reg: Regulation, months: string[]): string[] {
  const full = months.filter((m) => liveDays(reg, m) >= 14);
  return [...full, ...months.filter((m) => !full.includes(m))];
}

/** The newest published month for `reg`, or null when Smogon has none yet. */
export async function smogonSnapshot(ctx: Context, reg: Regulation, months: string[]): Promise<MetaSnapshot | null> {
  const found = await findChaos(ctx, reg, months);
  if (!found) return null;
  const snap = chaosToSnapshot(found.json, {
    regulationId: reg.id,
    format: found.format,
    month: found.month,
    url: found.url,
    speciesId: (name) => ctx.speciesId(name),
  });
  console.log(`  Smogon: ${found.format} ${found.month} ≥${found.cutoff}, ${snap.source.battles} battles, ${snap.entries.length} Pokémon.`);
  return snap;
}
