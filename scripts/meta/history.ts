/**
 * Builds src/data/generated/meta-history.json (see src/domain/metaHistory.ts): the day's in-game
 * snapshot and Smogon's published months, appended per regulation. The in-game mirror's index
 * lists every daily snapshot since the season began, so the first run backfills them all; later
 * runs only fetch dates the history doesn't have yet. Smogon months are fetched only for months a
 * regulation was live for at least two weeks (monthsToTry's rule), and only once.
 */
import { z } from 'zod';
import { chaosToSnapshot } from '../../src/domain/meta.ts';
import { ingameToSnapshot } from '../../src/domain/metaSources.ts';
import { appendHistory, hasDate, ingameIndexDates, snapshotToHistoryEntry, type MetaHistory } from '../../src/domain/metaHistory.ts';
import { get, getJson } from './http.ts';
import type { Context, Regulation } from './context.ts';

const BASE = (process.env.INGAME_DATA_BASE || 'https://raw.githubusercontent.com/Gheist23/pokemonbattledata/main/data/meta').replace(/\/$/, '');
const PAGE = 'https://github.com/Gheist23/pokemonbattledata';
const STATS = 'https://www.smogon.com/stats/';
const CUTOFFS = [1760, 1630, 1500, 0];
const MIN_LEGAL = 0.98;

const regulationOn = (ctx: Context, iso: string) => ctx.regulations.find((r) => r.start.slice(0, 10) <= iso && (!r.end || iso <= r.end.slice(0, 10)));

/** Adds the mirror's dated Doubles snapshots the history lacks. Returns how many were added. */
export async function addIngameHistory(ctx: Context, history: MetaHistory): Promise<number> {
  const index = await getJson(`${BASE}/index.json`);
  let added = 0;
  for (const day of ingameIndexDates(index)) {
    const reg = regulationOn(ctx, day.iso);
    if (!reg) continue;
    const entries = history.regulations[reg.id]?.entries ?? [];
    if (hasDate(entries, day.iso)) continue;
    const raw = await getJson(`${BASE}/${day.season}/${day.date}/Doubles.json`);
    if (!raw) continue;
    const names = Object.keys(z.object({ pokemon: z.record(z.string(), z.unknown()) }).parse(raw).pokemon);
    const known = names.map((n) => ctx.lookupSpecies(n)).filter((x): x is string => !!x);
    const legal = ctx.legality(reg.id);
    if (!known.length || known.filter((x) => legal.species(x)).length / known.length < MIN_LEGAL) continue; // another regulation's ladder
    const entry = snapshotToHistoryEntry(ingameToSnapshot(raw, { regulationId: reg.id, url: PAGE, speciesId: (n) => ctx.lookupSpecies(n) }));
    if (!entry) continue;
    history.regulations[reg.id] = { entries: appendHistory(entries, entry) };
    added++;
  }
  return added;
}

const liveDays = (reg: Regulation, month: string) => {
  const from = Math.max(Date.parse(`${month}-01T00:00:00Z`), Date.parse(reg.start));
  const [y, m] = month.split('-').map(Number);
  const to = Math.min(Date.UTC(y, m, 1), reg.end ? Date.parse(reg.end) : Infinity);
  return Math.max(0, (to - from) / 86_400_000);
};
const lastDay = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

/** Adds Smogon months (newest `months`, as listed on the stats index) the history lacks. */
export async function addSmogonHistory(ctx: Context, history: MetaHistory, months: string[]): Promise<number> {
  let added = 0;
  for (const reg of ctx.regulations) {
    for (const month of months) {
      if (liveDays(reg, month) < 14) continue;
      const entries = history.regulations[reg.id]?.entries ?? [];
      if (entries.some((e) => e.k === 'smogon' && e.d === lastDay(month))) continue;
      let snap = null;
      search: for (const format of ctx.formatIds(reg)) {
        for (const cutoff of CUTOFFS) {
          const url = `${STATS}${month}/chaos/${format}-${cutoff}.json`;
          const res = await get(url);
          if (!res) continue;
          snap = chaosToSnapshot((await res.json()) as unknown, { regulationId: reg.id, format, month, url, speciesId: (n) => ctx.lookupSpecies(n) });
          break search;
        }
      }
      const entry = snap && snapshotToHistoryEntry(snap);
      if (!entry) continue;
      history.regulations[reg.id] = { entries: appendHistory(entries, entry) };
      added++;
    }
  }
  return added;
}
