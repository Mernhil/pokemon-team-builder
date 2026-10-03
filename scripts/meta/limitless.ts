/**
 * Tournament team lists from Limitless (https://play.limitlesstcg.com), where most online VGC
 * tournaments run with open team sheets: every player's six Pokémon with item, ability and moves
 * (no spreads). Usable from a regulation's first weekend.
 *
 * Reads the public API (https://docs.limitlesstcg.com/developer): the tournament list for the game,
 * then each finished tournament's standings with their team lists. An access key, when Limitless
 * asks for one, goes in LIMITLESS_API_KEY (sent as X-Access-Key).
 *
 * Which tournaments count: dated inside the regulation, at least MIN_PLAYERS players, and either a
 * format listed in LIMITLESS_FORMATS or — when that isn't set — team lists that look like this
 * regulation (nearly every team legal in it, and most holding a Mega Stone, which only Champions
 * has). Every accepted and rejected format code is printed, so it can be pinned.
 */
import { z } from 'zod';
import { MIN_TOURNAMENT_TEAMS, type MetaSnapshot } from '../../src/domain/meta.ts';
import { teamFromDecklist, teamsToSnapshot, type TeamRecord } from '../../src/domain/metaSources.ts';
import { getJson, HttpDenied, pool } from './http.ts';
import type { Context, Regulation } from './context.ts';

const API = 'https://play.limitlesstcg.com/api';
const MIN_PLAYERS = 16;
const MAX_PAGES = 20;
/** Share of a tournament's teams that must be legal in the regulation, and hold a Mega Stone. */
const MIN_LEGAL = 0.8;
const MIN_MEGA = 0.5;

const games = (process.env.LIMITLESS_GAMES || 'VGC').split(',').map((s) => s.trim()).filter(Boolean);
const pinnedFormats = new Set((process.env.LIMITLESS_FORMATS ?? '').split(',').map((s) => s.trim()).filter(Boolean));
const headers: Record<string, string> = process.env.LIMITLESS_API_KEY ? { 'X-Access-Key': process.env.LIMITLESS_API_KEY } : {};

const Tournament = z.object({ id: z.string(), game: z.string().nullish(), format: z.string().nullish(), name: z.string().nullish(), date: z.string(), players: z.number().nullish() }).passthrough();
const Standing = z.object({ placing: z.number().nullish(), decklist: z.unknown() }).passthrough();

interface CachedTournament {
  date: string;
  format: string;
  name: string;
  /** Team lists (null: the tournament had none). */
  teams: TeamRecord[] | null;
}
interface Cache {
  version: 1;
  tournaments: Record<string, CachedTournament>;
}

async function listTournaments(game: string, sinceIso: string) {
  const out: z.infer<typeof Tournament>[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const parsed = z.array(Tournament).safeParse(await getJson(`${API}/tournaments?game=${encodeURIComponent(game)}&limit=50&page=${page}`, headers));
    if (!parsed.success) {
      if (page === 1) console.log(`  Tournaments: unexpected answer for game=${game} (${parsed.error.issues[0]?.message ?? 'no data'}).`);
      break;
    }
    out.push(...parsed.data);
    if (parsed.data.length < 50 || parsed.data.every((t) => t.date < sinceIso)) break;
  }
  return out;
}

export async function tournamentsSnapshot(ctx: Context, reg: Regulation): Promise<MetaSnapshot | null> {
  const cache = ctx.readCache<Cache>('limitless.json', { version: 1, tournaments: {} });
  const legal = ctx.legality(reg.id);
  const now = new Date().toISOString();
  const end = reg.end && reg.end < now ? reg.end : now;
  /** Finished a couple of days ago: its standings won't change, so it's cached. */
  const settled = new Date(Date.now() - 2 * 86_400_000).toISOString();

  let listed: z.infer<typeof Tournament>[] = [];
  try {
    for (const game of games) listed.push(...(await listTournaments(game, reg.start)));
  } catch (e) {
    console.log(`  Tournaments: ${e instanceof HttpDenied ? `Limitless refused the request (HTTP ${e.status}); set LIMITLESS_API_KEY if it needs a key.` : (e as Error).message}`);
    return null;
  }
  listed = listed.filter((t) => t.date >= reg.start && t.date <= end && (t.players ?? 0) >= MIN_PLAYERS && (!pinnedFormats.size || pinnedFormats.has(t.format ?? '')));

  const results = await pool(listed, 3, async (t): Promise<[string, CachedTournament]> => {
    const hit = cache.tournaments[t.id];
    if (hit) return [t.id, hit];
    let teams: TeamRecord[] | null = null;
    try {
      const standings = z.array(Standing).safeParse(await getJson(`${API}/tournaments/${t.id}/standings`, headers));
      if (standings.success) {
        const lists = standings.data.map((s) => teamFromDecklist(s.decklist, (name) => ctx.lookupSpecies(name))).filter((x): x is TeamRecord => !!x);
        teams = lists.length ? lists : null;
      }
    } catch (e) {
      console.log(`  Tournaments: ${t.name ?? t.id}: ${(e as Error).message}`);
    }
    const entry: CachedTournament = { date: t.date, format: t.format ?? '', name: t.name ?? t.id, teams };
    if (t.date < settled) cache.tournaments[t.id] = entry;
    return [t.id, entry];
  });
  ctx.writeCache('limitless.json', cache);

  const teams: TeamRecord[] = [];
  const accepted = new Map<string, number>();
  const rejected = new Map<string, number>();
  let events = 0;
  for (const [, t] of results) {
    if (!t.teams?.length) continue;
    const legalTeams = t.teams.filter((team) => team.every((m) => legal.species(m.speciesId)));
    const megaShare = t.teams.filter((team) => team.some((m) => ctx.isMegaStone(m.itemId))).length / t.teams.length;
    const looksRight = pinnedFormats.size > 0 || (legalTeams.length / t.teams.length >= MIN_LEGAL && megaShare >= MIN_MEGA);
    const tally = looksRight ? accepted : rejected;
    tally.set(t.format || '?', (tally.get(t.format || '?') ?? 0) + 1);
    if (!looksRight) continue;
    events++;
    teams.push(...legalTeams);
  }
  const fmt = (m: Map<string, number>) => [...m].map(([f, n]) => `${f} ×${n}`).join(', ') || 'none';
  console.log(`  Tournaments: ${listed.length} in the window; formats used: ${fmt(accepted)}; skipped: ${fmt(rejected)}.`);
  if (!teams.length) return null;

  const snap = teamsToSnapshot(teams, {
    regulationId: reg.id,
    source: {
      kind: 'tournaments',
      name: 'Limitless VGC tournament team lists',
      url: 'https://play.limitlesstcg.com/tournaments/completed?game=VGC',
      teams: teams.length,
      events,
    },
  });
  if (snap) console.log(`  Tournaments: ${teams.length} teams from ${events} events${teams.length < MIN_TOURNAMENT_TEAMS ? ' (thin sample)' : ''}, ${snap.entries.length} Pokémon.`);
  return snap;
}
