/**
 * `npm run meta`: builds src/data/generated/meta.json, the usage data behind the Meta tab, threat
 * report, speed tiers, Stat Point optimiser and bring planner. One snapshot per Champions
 * regulation: the best of these sources (metaSourceRank in src/domain/meta.ts):
 *
 *  1. Pokémon Champions' in-game Battle Data for the current ranked season (scripts/meta/ingame.ts):
 *     the real ladder, refreshed daily, for the regulation that season runs on.
 *  2. Smogon's monthly usage statistics (scripts/meta/smogon.ts).
 *  3. Until a regulation has either, early estimates, refreshed every run:
 *     - tournament team lists from Limitless (scripts/meta/limitless.ts),
 *     - public Showdown replays (scripts/meta/replays.ts),
 *     - the previous regulation's numbers for what's still allowed (carry-over).
 *     Their entries borrow spreads from another regulation's Smogon stats, or estimate one.
 *
 * A source that fails keeps its previous snapshot in play; nothing is invented, and a file the app
 * would reject is never written. Species names the Champions dataset doesn't know are listed.
 *
 *   npm run meta                                every source
 *   npm run meta -- --sources smogon,carryover  only some (ingame, smogon, tournaments, replays, carryover)
 *   npm run meta -- --months 3                  look back 3 Smogon months (default 8)
 *   npm run meta -- --max-replays 300           new replays read per format (default 1500)
 *
 * Needs network access to raw.githubusercontent.com, www.smogon.com, replay.pokemonshowdown.com and play.limitlesstcg.com (the
 * scheduled GitHub Action has it; it also keeps .cache/meta/ between runs). See docs/UPDATING_META.md.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compareSnapshots, metaSourceKind, parseMetaFile, type MetaFile, type MetaSnapshot } from '../src/domain/meta.ts';
import { carryOverSnapshot, fillSpreads } from '../src/domain/metaSources.ts';
import { Context, ROOT, type Regulation } from './meta/context.ts';
import { ingameSnapshot } from './meta/ingame.ts';
import { tournamentsSnapshot } from './meta/limitless.ts';
import { replaysSnapshot } from './meta/replays.ts';
import { listMonths, smogonSnapshot } from './meta/smogon.ts';
import { addIngameHistory, addSmogonHistory } from './meta/history.ts';
import { parseMetaHistory, EMPTY_HISTORY, type MetaHistory } from '../src/domain/metaHistory.ts';

const OUT = resolve(ROOT, 'src/data/generated/meta.json');
const HISTORY_OUT = resolve(ROOT, 'src/data/generated/meta-history.json');
const SOURCES = ['ingame', 'smogon', 'tournaments', 'replays', 'carryover'] as const;

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const monthsBack = Number(arg('--months')) || 8;
const maxReplays = Number(arg('--max-replays')) || 1500;
const wanted = new Set((arg('--sources') ?? SOURCES.join(',')).split(',').map((s) => s.trim()));
for (const s of wanted) if (!(SOURCES as readonly string[]).includes(s)) throw new Error(`Unknown source "${s}" (use ${SOURCES.join(', ')}).`);

const ctx = new Context();
const previous: MetaFile = existsSync(OUT) ? parseMetaFile(JSON.parse(readFileSync(OUT, 'utf8'))) : { version: 1, generatedAt: '1970-01-01', regulations: {} };
const now = new Date().toISOString();

const ingame = wanted.has('ingame') ? await attempt('In-game data', () => ingameSnapshot(ctx)) : null;

let months: string[] = [];
if (wanted.has('smogon')) {
  try {
    months = (await listMonths()).slice(0, monthsBack);
    console.log(`Smogon stats months (newest first): ${months.join(', ')}`);
  } catch (e) {
    console.log(`Smogon: ${(e as Error).message} — keeping the previous Smogon snapshots.`);
  }
}

const out: Record<string, MetaSnapshot> = {};
const isSmogon = (s: MetaSnapshot | undefined) => !!s && metaSourceKind(s) === 'smogon';

/** Smogon snapshots of other regulations, nearest in time first (earlier ones win ties): spread donors. */
function donors(reg: Regulation): MetaSnapshot[] {
  const at = Date.parse(reg.start);
  return ctx.regulations
    .filter((r) => r.id !== reg.id)
    .map((r) => ({ r, snap: [out[r.id], previous.regulations[r.id]].find(isSmogon) }))
    .filter((x): x is { r: Regulation; snap: MetaSnapshot } => !!x.snap)
    .sort((a, b) => Math.abs(Date.parse(a.r.start) - at) - Math.abs(Date.parse(b.r.start) - at) || a.r.start.localeCompare(b.r.start))
    .map((x) => x.snap);
}

/** The same numbers as `b` (ignoring when it was built)? Keeps a daily run from rewriting unchanged data. */
const sameData = (a: MetaSnapshot, b: MetaSnapshot) => JSON.stringify({ ...a, updatedAt: '' }) === JSON.stringify({ ...b, updatedAt: '' });

async function attempt<T>(label: string, fn: () => Promise<T | null>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    console.log(`  ${label}: failed (${(e as Error).message}); keeping the previous snapshot if any.`);
    return null;
  }
}

for (const reg of ctx.regulations) {
  console.log(`${reg.shortName}:`);
  const prev = previous.regulations[reg.id];
  const fresh: MetaSnapshot[] = [];

  const smogon = wanted.has('smogon') && months.length ? await attempt('Smogon', () => smogonSnapshot(ctx, reg, months)) : null;
  if (smogon) fresh.push(smogon);
  if (ingame?.regulationId === reg.id) fresh.push(ingame);
  // With real usage data (Smogon's or the game's own), the early estimates aren't needed.
  const hasSmogon = !!smogon || isSmogon(prev) || ingame?.regulationId === reg.id || (!!prev && metaSourceKind(prev) === 'ingame');

  if (!hasSmogon && reg.start <= now) {
    if (wanted.has('tournaments')) {
      const t = await attempt('Tournaments', () => tournamentsSnapshot(ctx, reg));
      if (t) fresh.push(t);
    }
    if (wanted.has('replays')) {
      const r = await attempt('Replays', () => replaysSnapshot(ctx, reg, { maxNew: maxReplays }));
      if (r) fresh.push(r);
    }
  }
  if (!hasSmogon && wanted.has('carryover')) {
    // The latest earlier regulation with data (its own best snapshot).
    const before = ctx.regulations.filter((r) => r.start < reg.start && out[r.id]).at(-1);
    const c = before ? carryOverSnapshot(out[before.id], reg.id, ctx.legality(reg.id)) : null;
    if (c) {
      fresh.push(c);
      console.log(`  Carry-over: ${c.entries.length} Pokémon from ${before!.shortName} still allowed.`);
    }
  }

  const filled = fresh.map((s) => (['smogon', 'ingame'].includes(metaSourceKind(s)) ? s : fillSpreads(s, donors(reg), (id) => ctx.baseStats(id))));
  // A fresh snapshot replaces the previous one from the same source; otherwise the previous one competes.
  const candidates = [...filled, ...(prev && !filled.some((s) => metaSourceKind(s) === metaSourceKind(prev)) ? [prev] : [])];
  const best = candidates.sort(compareSnapshots)[0];
  if (!best) {
    console.log('  no data yet.');
    continue;
  }
  out[reg.id] = prev && sameData(best, prev) ? prev : best;
  console.log(`  → using ${metaSourceKind(best)}${best === prev ? ' (previous snapshot)' : ''}: ${best.entries.length} Pokémon.`);
}
if (ctx.unknown.size) console.log(`Not in the Champions dataset (dropped): ${[...ctx.unknown].sort().join(', ')}`);

const file: MetaFile = { version: 1, generatedAt: now.slice(0, 10), regulations: out };
parseMetaFile(file); // never write a file the app would reject
const unchanged = JSON.stringify(previous.regulations) === JSON.stringify(out);
if (!unchanged) writeFileSync(OUT, JSON.stringify(file, null, 1) + '\n');
console.log(unchanged ? 'No change in the data; meta.json left as is.' : `wrote ${OUT}`);

// History for the Meta tab's Trends: the game's daily snapshots (backfilled from the mirror's index)
// and Smogon's months, appended per regulation (src/domain/metaHistory.ts).
const prevHistoryText = existsSync(HISTORY_OUT) ? readFileSync(HISTORY_OUT, 'utf8') : '';
const history: MetaHistory = prevHistoryText ? parseMetaHistory(JSON.parse(prevHistoryText)) : structuredClone(EMPTY_HISTORY);
const before = JSON.stringify(history);
if (wanted.has('ingame')) await attempt('In-game history', async () => (console.log(`History: ${await addIngameHistory(ctx, history)} in-game day(s) added.`), 1));
if (wanted.has('smogon') && months.length) await attempt('Smogon history', async () => (console.log(`History: ${await addSmogonHistory(ctx, history, months)} Smogon month(s) added.`), 1));
if (JSON.stringify(history) !== before) {
  parseMetaHistory(history);
  writeFileSync(HISTORY_OUT, JSON.stringify(history) + '\n');
  console.log(`wrote ${HISTORY_OUT}`);
}
