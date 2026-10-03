/**
 * Pokémon Champions' own Battle Data: the game's ranked usage for the current season, the real
 * ladder rather than Showdown, refreshed daily. The game shows it in its Battle Data screen; a
 * community mirror (https://github.com/Gheist23/pokemonbattledata) saves a dated JSON snapshot of it
 * every day, which is what this reads (raw.githubusercontent.com; INGAME_DATA_BASE overrides).
 *
 * Which snapshot, for which regulation:
 *  - the newest Doubles snapshot of the newest season, once that season has MIN_DAYS daily
 *    snapshots (a season's first days are thin; until then the previous season's last snapshot,
 *    kept in meta.json, stays in use);
 *  - assigned to the regulation live on the snapshot's date, and only when nearly every species in
 *    it is legal there (MIN_LEGAL), so a season is never filed under the wrong regulation.
 * Usage is a rank (the game publishes no species %); see ingameToSnapshot.
 */
import { z } from 'zod';
import type { MetaSnapshot } from '../../src/domain/meta.ts';
import { ingameDate, ingameToSnapshot } from '../../src/domain/metaSources.ts';
import { getJson } from './http.ts';
import type { Context } from './context.ts';

const BASE = (process.env.INGAME_DATA_BASE || 'https://raw.githubusercontent.com/Gheist23/pokemonbattledata/main/data/meta').replace(/\/$/, '');
const PAGE = 'https://github.com/Gheist23/pokemonbattledata';
const FORMAT = 'Doubles';
const MIN_DAYS = 3;
const MIN_LEGAL = 0.98;

const IndexSchema = z.object({
  seasons: z.array(z.object({ season: z.string().regex(/^[A-Za-z0-9_-]{1,16}$/), dates: z.array(z.string().regex(/^\d{2}_\d{2}_\d{4}$/)), formats: z.array(z.string()).default([]) })),
});

/** The current season's newest snapshot, as a snapshot for the regulation it belongs to (or null). */
export async function ingameSnapshot(ctx: Context): Promise<MetaSnapshot | null> {
  const index = IndexSchema.safeParse(await getJson(`${BASE}/index.json`));
  if (!index.success) {
    console.log(`In-game data: unexpected index (${index.error.issues[0]?.message ?? 'no data'}).`);
    return null;
  }
  const newest = (dates: string[]) => dates.map(ingameDate).sort().at(-1);
  const current = index.data.seasons.filter((s) => s.dates.length && s.formats.includes(FORMAT)).sort((a, b) => (newest(b.dates) ?? '').localeCompare(newest(a.dates) ?? ''))[0];
  if (!current) {
    console.log('In-game data: no season with Doubles snapshots.');
    return null;
  }
  const date = current.dates.slice().sort((a, b) => ingameDate(b).localeCompare(ingameDate(a)))[0];
  if (current.dates.length < MIN_DAYS) {
    console.log(`In-game data: season ${current.season} has ${current.dates.length} day(s) of data; waiting for ${MIN_DAYS} (the previous snapshot stays).`);
    return null;
  }
  const iso = ingameDate(date);
  const reg = ctx.regulations.find((r) => r.start.slice(0, 10) <= iso && (!r.end || iso <= r.end.slice(0, 10)));
  if (!reg) {
    console.log(`In-game data: no Champions regulation was live on ${iso}.`);
    return null;
  }
  const url = `${BASE}/${current.season}/${date}/${FORMAT}.json`;
  const raw = await getJson(url);
  if (!raw) {
    console.log(`In-game data: ${url} not found.`);
    return null;
  }
  const names = Object.keys((raw as { pokemon?: Record<string, unknown> }).pokemon ?? {});
  const known = names.map((n) => ctx.lookupSpecies(n)).filter((id): id is string => !!id);
  const legal = ctx.legality(reg.id);
  const share = known.length ? known.filter((id) => legal.species(id)).length / known.length : 0;
  if (share < MIN_LEGAL) {
    console.log(`In-game data: season ${current.season} doesn't look like ${reg.shortName} (${Math.round(share * 100)}% of its species are legal there); skipped.`);
    return null;
  }
  const snap = ingameToSnapshot(raw, { regulationId: reg.id, url: PAGE, speciesId: (n) => ctx.speciesId(n) });
  console.log(`In-game data: season ${current.season} ${iso} → ${reg.shortName}, ${snap.entries.length} Pokémon.`);
  return snap;
}
