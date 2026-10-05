/**
 * Tournament teams: the top cut of online VGC tournaments (Limitless open team sheets) as a browsable
 * list. `npm run meta` writes src/data/generated/tournament-teams.json (selectTopCuts keeps top 8 of
 * events with ≥ 32 players in the last 60 days, at most 300 teams per regulation); the Meta tab's
 * Teams tab loads it lazily. Team sheets show species, item, ability and moves but no spreads, so a
 * team used in the app (tournamentImport.ts) gets the species' most common spread from the meta, or
 * an estimate from base stats, and every set says so. Pure.
 */
import { z } from 'zod';
import type { TeamRecord } from './metaSources.ts';

export const TT_TOP_N = 8;
export const TT_MIN_PLAYERS = 32;
export const TT_DAYS = 60;
export const TT_CAP = 300;

const id = z.string().regex(/^[a-z0-9]{0,64}$/);
export const TournamentEventSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  /** YYYY-MM-DD */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  players: z.number().int().min(0),
  url: z.string().url(),
});
export type TournamentEvent = z.infer<typeof TournamentEventSchema>;

/** [species id, item id, ability id, moves] ('' where the sheet doesn't say). */
const SetTuple = z.tuple([id.refine((s) => s.length > 0), id, id, z.array(id).max(4)]);
export type TournamentSet = z.infer<typeof SetTuple>;

export const TournamentTeamSchema = z.object({
  /** Index into the regulation's events. */
  e: z.number().int().min(0),
  /** Placing in the event. */
  p: z.number().int().min(1),
  /** Player name, as the public standings show it. */
  n: z.string().max(60),
  m: z.array(SetTuple).min(4).max(6),
});
export type TournamentTeam = z.infer<typeof TournamentTeamSchema>;

export const TournamentTeamsSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
  regulations: z.record(z.string(), z.object({ events: z.array(TournamentEventSchema), teams: z.array(TournamentTeamSchema) })),
});
export type TournamentTeamsFile = z.infer<typeof TournamentTeamsSchema>;
export type TournamentRegulation = TournamentTeamsFile['regulations'][string];

export const EMPTY_TOURNAMENT_TEAMS: TournamentTeamsFile = { version: 1, generatedAt: '1970-01-01', regulations: {} };

export function parseTournamentTeams(json: unknown): TournamentTeamsFile {
  const r = TournamentTeamsSchema.safeParse(json);
  if (!r.success) {
    const first = r.error.issues[0];
    throw new Error(`Tournament teams failed validation at ${first.path.join('.') || '(root)'}: ${first.message}`);
  }
  for (const reg of Object.values(r.data.regulations)) for (const t of reg.teams) if (t.e >= reg.events.length) throw new Error('Tournament teams: a team points at a missing event.');
  return r.data;
}

// ---- building the file (scripts/meta/limitless.ts) ---------------------------------------------

/** One standings row of a tournament, as the API gives it (decklist: a team record once parsed). */
export interface RawStanding {
  placing: number;
  player: string;
  team: TeamRecord;
}
export interface RawEvent {
  id: string;
  name: string;
  /** ISO date or date-time */
  date: string;
  players: number;
  standings: RawStanding[];
}

const Standing = z
  .object({ placing: z.number().nullish(), name: z.string().nullish(), player: z.string().nullish(), decklist: z.unknown() })
  .passthrough();

/** One standings row with its team list; null when it has no usable team list or placing. */
export function parseStanding(raw: unknown, teamFromDecklist: (decklist: unknown) => TeamRecord | null): RawStanding | null {
  const s = Standing.safeParse(raw);
  if (!s.success || !s.data.placing || s.data.placing < 1) return null;
  const team = teamFromDecklist(s.data.decklist);
  if (!team) return null;
  const player = (s.data.name || s.data.player || 'Unknown player').replace(/\s+/g, ' ').trim().slice(0, 60);
  return { placing: Math.floor(s.data.placing), player, team };
}

export const limitlessUrl = (eventId: string) => `https://play.limitlesstcg.com/tournament/${encodeURIComponent(eventId)}`;
const toId = (s: string | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

export interface SelectOptions {
  today?: string;
  topN?: number;
  minPlayers?: number;
  days?: number;
  cap?: number;
  /** Is every Pokémon of this team legal in the regulation? Illegal teams are never kept. */
  legal?: (team: TeamRecord) => boolean;
}

/**
 * The top cuts worth keeping: top `topN` of events with at least `minPlayers` players dated in the
 * last `days` days, newest event first and best placing first, at most `cap` teams (the oldest and
 * lowest placings are the ones to go).
 */
export function selectTopCuts(events: RawEvent[], o: SelectOptions = {}): TournamentRegulation {
  const today = o.today ?? new Date().toISOString().slice(0, 10);
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - (o.days ?? TT_DAYS) * 86_400_000).toISOString().slice(0, 10);
  const topN = o.topN ?? TT_TOP_N;
  const cap = o.cap ?? TT_CAP;
  const picked = events
    .filter((e) => e.players >= (o.minPlayers ?? TT_MIN_PLAYERS) && e.date.slice(0, 10) >= since && e.date.slice(0, 10) <= today)
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const outEvents: TournamentEvent[] = [];
  const teams: TournamentTeam[] = [];
  for (const ev of picked) {
    const rows = ev.standings
      .filter((s) => s.placing <= topN && (!o.legal || o.legal(s.team)))
      .sort((a, b) => a.placing - b.placing)
      .slice(0, topN);
    const room = cap - teams.length;
    if (room <= 0) break;
    const kept = rows.slice(0, room);
    if (!kept.length) continue;
    outEvents.push({ id: ev.id, name: ev.name.slice(0, 120), date: ev.date.slice(0, 10), players: ev.players, url: limitlessUrl(ev.id) });
    for (const s of kept) {
      teams.push({
        e: outEvents.length - 1,
        p: s.placing,
        n: s.player,
        m: s.team.slice(0, 6).map((m) => [m.speciesId, toId(m.itemId), toId(m.abilityId), m.moves.map(toId).filter(Boolean).slice(0, 4)] as TournamentSet),
      });
    }
  }
  return { events: outEvents, teams };
}

// ---- browsing ---------------------------------------------------------------------------------

export interface TeamFilter {
  /** Every one of these species is on the team. */
  species?: string[];
  archetype?: string;
  /** true: a Mega Stone holder; false: none. */
  mega?: boolean;
  /** ISO dates, inclusive. */
  from?: string;
  to?: string;
}

export interface FilterHelpers {
  isMega: (speciesId: string, itemId: string) => boolean;
  /** The archetype tag (preset id) of a team, or undefined. */
  archetypeOf?: (team: TournamentTeam) => string | undefined;
}

export function filterTournamentTeams(reg: TournamentRegulation, f: TeamFilter, h: FilterHelpers): TournamentTeam[] {
  return reg.teams.filter((t) => {
    const date = reg.events[t.e].date;
    if (f.from && date < f.from) return false;
    if (f.to && date > f.to) return false;
    if (f.species?.length && !f.species.every((s) => t.m.some((m) => m[0] === s))) return false;
    if (f.mega !== undefined && t.m.some((m) => h.isMega(m[0], m[1])) !== f.mega) return false;
    if (f.archetype && h.archetypeOf?.(t) !== f.archetype) return false;
    return true;
  });
}

export function sortTournamentTeams(reg: TournamentRegulation, teams: TournamentTeam[], by: 'date' | 'placing'): TournamentTeam[] {
  return teams.slice().sort((a, b) =>
    by === 'date'
      ? reg.events[b.e].date.localeCompare(reg.events[a.e].date) || a.p - b.p || a.n.localeCompare(b.n)
      : a.p - b.p || reg.events[b.e].date.localeCompare(reg.events[a.e].date) || a.n.localeCompare(b.n),
  );
}

export const placingLabel = (p: number) => (p === 1 ? '1st' : p === 2 ? '2nd' : p === 3 ? '3rd' : `${p}th`);

export const TOURNAMENT_CATEGORY = 'Tournament teams';
