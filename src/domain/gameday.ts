/**
 * Game day: one phone screen from Team Preview to a logged match. This is its pure half: the state of
 * the game in progress (their six, what they showed, the plan I chose), who to offer as their six,
 * the speed order of all twelve, and the match that gets logged. No React, no store.
 */
import { normalizeBring, type BringLimits, type LoggedMon, type Match, type MatchResult } from './matches';
import type { MetaSnapshot } from './meta';
import { byUsage } from './usage';
import { isSavedTeam } from './team';
import type { Team } from './types';

export const MAX_OPPONENTS = 6;
export const MAX_PLANS = 3;

/** What an opponent's Pokémon showed during the game. */
export interface Reveal {
  itemId?: string;
  abilityId?: string;
  moves?: string[];
}
export interface Bring {
  brought: string[];
  leads: string[];
}

/** The game in progress. Everything is ids; it is rebuilt from them, so a reload loses nothing. */
export interface GameDayState {
  /** My saved team. */
  myTeamId?: string;
  /** Their species, in the order they were tapped (at most six). */
  opponents: string[];
  /** By species id. */
  reveals: Record<string, Reveal>;
  /** Which of the suggested plans is chosen (0 = the best). */
  planIndex: number;
  /** What I brought and led (Pokémon uids), when I changed the plan's; else the plan's. */
  bring?: Bring;
  /** What they brought and led (species ids), when I marked it. */
  oppBring: Bring;
  notes: string;
}

export const emptyGame = (myTeamId?: string): GameDayState => ({ myTeamId, opponents: [], reveals: {}, planIndex: 0, oppBring: { brought: [], leads: [] }, notes: '' });

// ---- sanitising ---------------------------------------------------------------------------

const ID = /^[a-z0-9]{1,64}$/;
const UID = /^[A-Za-z0-9_-]{1,64}$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const ids = (v: unknown, re: RegExp, max: number): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && re.test(x)))].slice(0, max) : []);
const one = (v: unknown, re: RegExp): string | undefined => (typeof v === 'string' && re.test(v) ? v : undefined);

/** A saved game of any shape as a valid one: bad fields drop out, nothing throws. */
export function sanitizeGameDay(raw: unknown): GameDayState {
  const v = isObj(raw) ? raw : {};
  const opponents = ids(v.opponents, ID, MAX_OPPONENTS);
  const reveals: Record<string, Reveal> = {};
  if (isObj(v.reveals)) {
    for (const id of opponents) {
      const r = (v.reveals as Record<string, unknown>)[id];
      if (!isObj(r)) continue;
      const moves = ids(r.moves, ID, 4);
      const clean: Reveal = { itemId: one(r.itemId, ID), abilityId: one(r.abilityId, ID), ...(moves.length ? { moves } : {}) };
      if (clean.itemId || clean.abilityId || clean.moves) reveals[id] = clean;
    }
  }
  const bringOf = (b: unknown, re: RegExp, roster?: string[]): Bring => {
    const o = isObj(b) ? b : {};
    const brought = ids(o.brought, re, MAX_OPPONENTS).filter((x) => !roster || roster.includes(x));
    return { brought, leads: ids(o.leads, re, MAX_OPPONENTS).filter((x) => brought.includes(x)) };
  };
  const mine = isObj(v.bring) ? bringOf(v.bring, UID) : undefined;
  return {
    myTeamId: one(v.myTeamId, UID),
    opponents,
    reveals,
    planIndex: typeof v.planIndex === 'number' && Number.isInteger(v.planIndex) && v.planIndex >= 0 && v.planIndex < MAX_PLANS ? v.planIndex : 0,
    ...(mine && mine.brought.length ? { bring: mine } : {}),
    oppBring: bringOf(v.oppBring, ID, opponents),
    notes: typeof v.notes === 'string' ? v.notes.slice(0, 500) : '',
  };
}

// ---- their six ----------------------------------------------------------------------------

/** Adds a species (ignored when already there, empty or past six). Changing their six resets the plan choice. */
export function addOpponent(g: GameDayState, id: string): GameDayState {
  if (!ID.test(id) || g.opponents.includes(id) || g.opponents.length >= MAX_OPPONENTS) return g;
  return { ...g, opponents: [...g.opponents, id], planIndex: 0, bring: undefined };
}

export function removeOpponent(g: GameDayState, id: string): GameDayState {
  if (!g.opponents.includes(id)) return g;
  const opponents = g.opponents.filter((x) => x !== id);
  const { [id]: _gone, ...reveals } = g.reveals;
  void _gone;
  return { ...g, opponents, reveals, planIndex: 0, bring: undefined, oppBring: normalizeBring(g.oppBring, opponents, { bring: MAX_OPPONENTS, lead: MAX_OPPONENTS }) };
}

/** Takes back the last one tapped. */
export const undoOpponent = (g: GameDayState): GameDayState => (g.opponents.length ? removeOpponent(g, g.opponents[g.opponents.length - 1]) : g);

/** What a species showed, replacing what was noted (an empty note removes it). */
export function setReveal(g: GameDayState, id: string, reveal: Reveal): GameDayState {
  if (!g.opponents.includes(id)) return g;
  const clean: Reveal = { itemId: reveal.itemId || undefined, abilityId: reveal.abilityId || undefined, ...(reveal.moves?.filter(Boolean).length ? { moves: reveal.moves.filter(Boolean).slice(0, 4) } : {}) };
  const { [id]: _old, ...rest } = g.reveals;
  void _old;
  return { ...g, reveals: clean.itemId || clean.abilityId || clean.moves ? { ...rest, [id]: clean } : rest };
}

/** Their six as a match log would hold them: species plus what was shown. */
export const opponentLog = (g: GameDayState): LoggedMon[] =>
  g.opponents.map((speciesId) => {
    const r = g.reveals[speciesId];
    return { speciesId, ...(r?.itemId ? { itemId: r.itemId } : {}), ...(r?.abilityId ? { abilityId: r.abilityId } : {}), ...(r?.moves?.length ? { moves: [...r.moves] } : {}) };
  });

/** The most-used species of a snapshot, most used first: the grid to tap their six from. */
export const topOpponents = (snapshot: MetaSnapshot | undefined, n = 30): string[] => (snapshot ? [...snapshot.entries].sort(byUsage).slice(0, n).map((e) => e.speciesId) : []);

/** Species from the latest logged matches' opponents (newest first), skipping `exclude`. */
export function recentOpponents(matches: readonly Pick<Match, 'date' | 'createdAt' | 'opponentTeam'>[], exclude: readonly string[] = [], n = 8): string[] {
  const out: string[] = [];
  for (const m of [...matches].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)) {
    for (const mon of m.opponentTeam) if (mon.speciesId && !out.includes(mon.speciesId) && !exclude.includes(mon.speciesId)) out.push(mon.speciesId);
    if (out.length >= n) break;
  }
  return out.slice(0, n);
}

// ---- my team ------------------------------------------------------------------------------

/** My saved teams a game can be played with (their Pokémon uids are what the match log stores). */
export const playableTeams = (teams: Record<string, Team>, order: readonly string[], isChampions: (t: Team) => boolean): Team[] =>
  order.map((id) => teams[id]).filter((t): t is Team => !!t && isSavedTeam(t) && !t.shared && isChampions(t) && t.slots.some(Boolean));

/** The team to start on: the one of the latest match logged with a saved team that can still be played, else the first. */
export function defaultTeam(playable: readonly Team[], matches: readonly Pick<Match, 'date' | 'createdAt' | 'myTeamId'>[]): Team | undefined {
  const byId = new Map(playable.map((t) => [t.id, t]));
  for (const m of [...matches].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)) {
    const t = m.myTeamId ? byId.get(m.myTeamId) : undefined;
    if (t) return t;
  }
  return playable[0];
}

// ---- speed order --------------------------------------------------------------------------

export interface SpeedEntry {
  id: string;
  name: string;
  side: 'mine' | 'theirs';
  /** The final Speed stat as the calc gives it. */
  speed: number;
}
export interface SpeedOptions {
  myTailwind?: boolean;
  theirTailwind?: boolean;
  trickRoom?: boolean;
}
export interface SpeedRow extends SpeedEntry {
  /** After Tailwind. */
  effective: number;
  /** Shares its speed with someone on the other side. */
  tie: boolean;
}

/** All twelve, fastest first (slowest first under Trick Room). Tailwind doubles a side's Speed. */
export function speedOrder(entries: readonly SpeedEntry[], o: SpeedOptions = {}): SpeedRow[] {
  const rows = entries.map((e) => ({ ...e, effective: e.speed * ((e.side === 'mine' ? o.myTailwind : o.theirTailwind) ? 2 : 1), tie: false }));
  for (const r of rows) r.tie = rows.some((x) => x !== r && x.side !== r.side && x.effective === r.effective);
  return rows.sort((a, b) => (o.trickRoom ? a.effective - b.effective : b.effective - a.effective) || a.name.localeCompare(b.name));
}

// ---- the logged match ---------------------------------------------------------------------

/** The fields of the match to log: who played, what each side brought and led, what they showed, the result. */
export function matchFromGame(
  g: GameDayState,
  o: { team: Team; plan?: Bring; regulationId?: string; result: MatchResult; limits: BringLimits },
): Pick<Match, 'result' | 'regulationId' | 'category' | 'myTeamId' | 'myBrought' | 'myLeads' | 'opponentTeam' | 'oppBrought' | 'oppLeads' | 'notes'> {
  const mineRoster = o.team.slots.flatMap((s) => (s ? [s.uid] : []));
  const mine = normalizeBring(g.bring ?? o.plan ?? { brought: [], leads: [] }, mineRoster, o.limits);
  const theirs = normalizeBring(g.oppBring, g.opponents, o.limits);
  return {
    result: o.result,
    regulationId: o.regulationId,
    category: 'Ranked Ladder',
    myTeamId: o.team.id,
    myBrought: mine.brought.length ? mine.brought : undefined,
    myLeads: mine.leads.length ? mine.leads : undefined,
    opponentTeam: opponentLog(g),
    oppBrought: theirs.brought.length ? theirs.brought : undefined,
    oppLeads: theirs.leads.length ? theirs.leads : undefined,
    notes: g.notes.trim() || undefined,
  };
}
