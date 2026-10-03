/**
 * Public Pokémon Showdown replays (https://replay.pokemonshowdown.com/): the early meta source that
 * follows the ladder day by day. Searches the regulation's format(s) newest first, reads each new
 * replay's log once (parsed games are cached in .cache/meta/), and aggregates the games at the
 * highest rating cutoff that still has enough of them.
 *
 * Only replays players chose to upload are public, so this is a sample, not the whole ladder:
 * species usage and teammates are exact for that sample (Team Preview shows all six), moves, items
 * and abilities only as revealed in battle.
 */
import { z } from 'zod';
import { MIN_REPLAY_GAMES, type MetaSnapshot } from '../../src/domain/meta.ts';
import { parseReplayLog, ratingFromLog, replayCutoff, teamsToSnapshot, type ReplayGame } from '../../src/domain/metaSources.ts';
import { getJson, pool } from './http.ts';
import type { Context, Regulation } from './context.ts';

const REPLAYS = 'https://replay.pokemonshowdown.com/';
/** Replay search pages (about 50 results each, newest first) read per format and run. */
const MAX_PAGES = 60;
/** Games kept per format in the cache (newest first). */
const KEEP = 8000;
const CONCURRENCY = 4;

const SearchResult = z.array(
  z.object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    uploadtime: z.number(),
    rating: z.number().nullish(),
    private: z.union([z.number(), z.boolean()]).nullish(),
  }).passthrough(),
);
const ReplayJson = z.object({ log: z.string(), uploadtime: z.number().optional(), rating: z.number().nullish() }).passthrough();

/** A cached game: parsed teams, or null when the log couldn't be read (so it isn't fetched again). */
type CachedGame = Omit<ReplayGame, 'teams'> & { teams: ReplayGame['teams'] | null };
interface Cache {
  version: 1;
  games: CachedGame[];
}

async function searchNew(format: string, sinceSec: number, known: Set<string>, maxNew: number) {
  const found: z.infer<typeof SearchResult> = [];
  const seen = new Set<string>();
  let before: number | undefined;
  for (let page = 0; page < MAX_PAGES && found.length < maxNew; page++) {
    const url = `${REPLAYS}search.json?format=${format}${before ? `&before=${before}` : ''}`;
    const parsed = SearchResult.safeParse(await getJson(url));
    if (!parsed.success) {
      if (page === 0) console.log(`  Replays: unexpected search answer for ${format} (${parsed.error.issues[0]?.message ?? 'no data'}).`);
      break;
    }
    const rows = parsed.data.filter((r) => !seen.has(r.id));
    for (const r of rows) seen.add(r.id);
    const fresh = rows.filter((r) => r.uploadtime >= sinceSec && !r.private && !known.has(r.id));
    found.push(...fresh);
    // Newest first: stop at the regulation's start, at the end of the results, or once a page is all known.
    if (!rows.length || !fresh.length || rows.at(-1)!.uploadtime < sinceSec) break;
    before = Math.min(...rows.map((r) => r.uploadtime));
  }
  return found.slice(0, maxNew);
}

export async function replaysSnapshot(ctx: Context, reg: Regulation, opts: { maxNew: number }): Promise<MetaSnapshot | null> {
  const sinceSec = Math.floor(Date.parse(reg.start) / 1000);
  const endSec = reg.end ? Math.floor(Date.parse(reg.end) / 1000) : Infinity;
  const games: ReplayGame[] = [];
  const formats: string[] = [];
  for (const format of ctx.formatIds(reg)) {
    const cacheName = `replays-${format}.json`;
    const cache = ctx.readCache<Cache>(cacheName, { version: 1, games: [] });
    const known = new Set(cache.games.map((g) => g.id));
    const fresh = await searchNew(format, sinceSec, known, opts.maxNew);
    let read = 0;
    const parsed = await pool(fresh, CONCURRENCY, async (row): Promise<CachedGame | null> => {
      const json = ReplayJson.safeParse(await getJson(`${REPLAYS}${row.id}.json`).catch(() => null));
      if (!json.success) return null; // not cached: tried again next run
      read++;
      const teams = parseReplayLog(json.data.log, (name) => ctx.speciesId(name));
      return { id: row.id, uploadtime: row.uploadtime, rating: row.rating || json.data.rating || ratingFromLog(json.data.log), teams };
    });
    const all = [...parsed.filter((g): g is CachedGame => !!g), ...cache.games].sort((a, b) => b.uploadtime - a.uploadtime).slice(0, KEEP);
    ctx.writeCache(cacheName, { version: 1, games: all } satisfies Cache);
    const usable = all.filter((g): g is ReplayGame => !!g.teams && g.uploadtime >= sinceSec && g.uploadtime < endSec);
    if (fresh.length || usable.length) console.log(`  Replays: ${format}: ${fresh.length} new (${read} read), ${usable.length} usable games.`);
    if (usable.length) formats.push(format);
    games.push(...usable);
  }
  if (!games.length) return null;

  const cutoff = replayCutoff(games, MIN_REPLAY_GAMES);
  const sample = games.filter((g) => g.rating >= cutoff);
  const snap = teamsToSnapshot(
    sample.flatMap((g) => g.teams),
    {
      regulationId: reg.id,
      source: {
        kind: 'replays',
        name: 'Public Pokémon Showdown replays',
        url: `${REPLAYS}?format=${formats[0] ?? ctx.formatIds(reg)[0]}`,
        format: formats.join(', ').slice(0, 80) || undefined,
        cutoff,
        battles: sample.length,
      },
    },
  );
  if (snap) console.log(`  Replays: ${sample.length} games${cutoff ? ` rated ${cutoff}+` : ''}, ${snap.entries.length} Pokémon.`);
  return snap;
}
