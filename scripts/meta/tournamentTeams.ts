/**
 * The Meta tab's Teams tab data: top cuts of recent Limitless VGC tournaments (see
 * src/domain/tournamentTeams.ts). Reads the same public API as limitless.ts. Each finished
 * tournament's top 8 (with the event-level checks: nearly all teams legal in the regulation, most
 * holding a Mega Stone) is cached in .cache/meta/limitless-top.json, so a run only fetches events it
 * hasn't seen. A failing API keeps the previous file.
 */
import { z } from 'zod';
import { teamFromDecklist } from '../../src/domain/metaSources.ts';
import { TT_DAYS, TT_MIN_PLAYERS, TT_TOP_N, parseStanding, selectTopCuts, type RawEvent, type RawStanding, type TournamentRegulation } from '../../src/domain/tournamentTeams.ts';
import { API, MIN_LEGAL, MIN_MEGA, Tournament, headers, listTournaments, pinnedFormats } from './limitless.ts';
import { HttpDenied, getJson, pool } from './http.ts';
import type { Context, Regulation } from './context.ts';

interface CachedEvent {
  name: string;
  date: string;
  players: number;
  format: string;
  /** The event's team lists look like this regulation's. */
  looksRight: boolean;
  /** The top cut. */
  top: RawStanding[];
}
interface Cache {
  version: 2;
  events: Record<string, CachedEvent>;
}

const games = (process.env.LIMITLESS_GAMES || 'VGC').split(',').map((s) => s.trim()).filter(Boolean);

/** The regulation's recent top cuts; null when Limitless can't be read (the caller keeps the old data). */
export async function tournamentTeamsFor(ctx: Context, reg: Regulation): Promise<TournamentRegulation | null> {
  const cache = ctx.readCache<Cache>('limitless-top.json', { version: 2, events: {} });
  const legal = ctx.legality(reg.id);
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const windowStart = new Date(now.getTime() - TT_DAYS * 86_400_000).toISOString();
  const since = windowStart > reg.start ? windowStart : reg.start;
  const end = reg.end && reg.end < now.toISOString() ? reg.end : now.toISOString();
  if (since > end) return { events: [], teams: [] };
  const settled = new Date(now.getTime() - 2 * 86_400_000).toISOString();

  let listed: z.infer<typeof Tournament>[] = [];
  try {
    for (const game of games) listed.push(...(await listTournaments(game, since)));
  } catch (e) {
    console.log(`  Tournament teams: ${e instanceof HttpDenied ? `Limitless refused the request (HTTP ${e.status})` : (e as Error).message}`);
    return null;
  }
  listed = listed.filter((t) => t.date >= since && t.date <= end && (t.players ?? 0) >= TT_MIN_PLAYERS && (!pinnedFormats.size || pinnedFormats.has(t.format ?? '')));

  const events: RawEvent[] = [];
  const results = await pool(listed, 3, async (t) => {
    const key = `${reg.id}:${t.id}`;
    const hit = cache.events[key];
    if (hit) return { t, ev: hit };
    let ev: CachedEvent | undefined;
    try {
      const standings = z.array(z.unknown()).safeParse(await getJson(`${API}/tournaments/${t.id}/standings`, headers));
      if (standings.success) {
        const rows = standings.data.map((s) => parseStanding(s, (d) => teamFromDecklist(d, (n) => ctx.lookupSpecies(n)))).filter((x): x is RawStanding => !!x);
        const legalShare = rows.length ? rows.filter((r) => r.team.every((m) => legal.species(m.speciesId))).length / rows.length : 0;
        const megaShare = rows.length ? rows.filter((r) => r.team.some((m) => ctx.isMegaStone(m.itemId))).length / rows.length : 0;
        ev = {
          name: t.name ?? t.id,
          date: t.date,
          players: t.players ?? 0,
          format: t.format ?? '',
          looksRight: rows.length > 0 && (pinnedFormats.size > 0 || (legalShare >= MIN_LEGAL && megaShare >= MIN_MEGA)),
          top: rows.filter((r) => r.placing <= TT_TOP_N).sort((a, b) => a.placing - b.placing),
        };
        if (t.date < settled) cache.events[key] = ev;
      }
    } catch (e) {
      console.log(`  Tournament teams: ${t.name ?? t.id}: ${(e as Error).message}`);
    }
    return { t, ev };
  });
  ctx.writeCache('limitless-top.json', cache);
  for (const { t, ev } of results) if (ev?.looksRight) events.push({ id: t.id, name: ev.name, date: ev.date, players: ev.players, standings: ev.top });

  const out = selectTopCuts(events, { today, legal: (team) => team.every((m) => legal.species(m.speciesId)) });
  console.log(`  Tournament teams: ${out.teams.length} top-cut teams from ${out.events.length} events.`);
  return out;
}
