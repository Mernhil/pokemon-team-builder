/**
 * Match-log analytics: win rates with honest uncertainty, by what was led or brought, by team
 * variation, against each opponent Pokémon, plus a weekly trend and an archetype grid.
 * Pure and React-free; the UI (components/matches/MatchStats) only formats these.
 *
 * Small samples never read as certainties: every rate carries a Wilson interval, and anything
 * with fewer than MIN_GAMES games is flagged `thin` so the UI can grey it out instead of showing
 * "100%" for a 1–0.
 */
import type { Match } from './matches';

/** Fewer games than this and a rate is too noisy to show as a percentage. */
export const MIN_GAMES = 5;

export interface Rate {
  wins: number;
  losses: number;
  total: number;
  /** 0–1 (0 when there are no games). */
  rate: number;
  /** Wilson 95% interval, 0–1. */
  low: number;
  high: number;
  /** Fewer than MIN_GAMES games: shown greyed, without a percentage. */
  thin: boolean;
}

/** Wilson score interval for `wins` out of `n` (95% by default). */
export function wilson(wins: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const p = wins / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

export function toRate(matches: Pick<Match, 'result'>[]): Rate {
  const wins = matches.filter((m) => m.result === 'win').length;
  const total = matches.length;
  const [low, high] = wilson(wins, total);
  return { wins, losses: total - wins, total, rate: total ? wins / total : 0, low, high, thin: total < MIN_GAMES };
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/** What a team id means for grouping: its folder (`groupId` or itself) and its variation label. */
export interface TeamInfo {
  name: string;
  groupId: string;
  variationLabel?: string;
}
export type TeamLookup = (teamId: string) => TeamInfo | undefined;

export interface MatchFilter {
  regulationId?: string;
  category?: string;
  /** Inclusive ISO dates (yyyy-mm-dd). */
  from?: string;
  to?: string;
  /** One saved team or variation. */
  teamId?: string;
  /** A team folder: the team and all of its variations. */
  groupId?: string;
}

export function filterMatches(matches: Match[], f: MatchFilter, teamOf?: TeamLookup): Match[] {
  return matches.filter(
    (m) =>
      (!f.regulationId || m.regulationId === f.regulationId) &&
      (!f.category || m.category === f.category) &&
      (!f.from || m.date >= f.from) &&
      (!f.to || m.date <= f.to) &&
      (!f.teamId || m.myTeamId === f.teamId) &&
      (!f.groupId || (!!m.myTeamId && (m.myTeamId === f.groupId || teamOf?.(m.myTeamId)?.groupId === f.groupId))),
  );
}

// ---------------------------------------------------------------------------
// Grouped win rates
// ---------------------------------------------------------------------------

/** Resolves one of my brought/led ids (a uid for saved teams) to a species id; the default is the id itself. */
export type MySpecies = (m: Match, id: string) => string | undefined;
const identity: MySpecies = (_m, id) => id;

export interface GroupRow extends Rate {
  key: string;
  /** Species ids in the group (sorted), or a single label for non-species groups. */
  species: string[];
  label?: string;
}

function group(matches: Match[], keyOf: (m: Match) => { key: string; species: string[]; label?: string } | undefined): GroupRow[] {
  const buckets = new Map<string, { head: { key: string; species: string[]; label?: string }; ms: Match[] }>();
  for (const m of matches) {
    const k = keyOf(m);
    if (!k) continue;
    const b = buckets.get(k.key) ?? { head: k, ms: [] };
    b.ms.push(m);
    buckets.set(k.key, b);
  }
  return [...buckets.values()]
    .map(({ head, ms }) => ({ ...head, ...toRate(ms) }))
    .sort((a, b) => b.total - a.total || b.rate - a.rate || a.key.localeCompare(b.key));
}

const speciesOf = (m: Match, ids: string[] | undefined, mine: MySpecies) =>
  ids ? [...new Set(ids.map((id) => mine(m, id)).filter((x): x is string => !!x))].sort() : [];

/** Win rate by my lead (a pair in doubles, one Pokémon in singles), by species so team variations merge. */
export function winRateByLead(matches: Match[], mine: MySpecies = identity): GroupRow[] {
  return group(matches, (m) => {
    const species = speciesOf(m, m.myLeads, mine);
    return species.length ? { key: species.join('+'), species } : undefined;
  });
}

/** Win rate by the Pokémon I brought. */
export function winRateByBrought(matches: Match[], mine: MySpecies = identity): GroupRow[] {
  return group(matches, (m) => {
    const species = speciesOf(m, m.myBrought, mine);
    return species.length ? { key: species.join('+'), species } : undefined;
  });
}

/** Win rate per saved team or variation, grouped under its folder. Matches without a saved team are left out. */
export function winRateByVariation(matches: Match[], teamOf: TeamLookup): GroupRow[] {
  return group(matches, (m) => {
    const t = m.myTeamId ? teamOf(m.myTeamId) : undefined;
    return t && m.myTeamId ? { key: m.myTeamId, species: [], label: t.variationLabel ? `${t.name} · ${t.variationLabel}` : t.name } : undefined;
  });
}

// ---------------------------------------------------------------------------
// Opponent species
// ---------------------------------------------------------------------------

export interface OpponentRow {
  speciesId: string;
  /** Games with it on their team (Team Preview). */
  faced: Rate;
  /** Games where they brought it / led with it (needs oppBrought / oppLeads to be logged). */
  brought: Rate;
  led: Rate;
}

export function opponentStats(matches: Match[]): OpponentRow[] {
  const by = new Map<string, { faced: Match[]; brought: Match[]; led: Match[] }>();
  const bucket = (id: string) => {
    let b = by.get(id);
    if (!b) by.set(id, (b = { faced: [], brought: [], led: [] }));
    return b;
  };
  for (const m of matches) {
    for (const id of new Set(m.opponentTeam.map((x) => x.speciesId).filter(Boolean))) bucket(id).faced.push(m);
    for (const id of new Set(m.oppBrought ?? [])) bucket(id).brought.push(m);
    for (const id of new Set(m.oppLeads ?? [])) bucket(id).led.push(m);
  }
  return [...by.entries()]
    .map(([speciesId, b]) => ({ speciesId, faced: toRate(b.faced), brought: toRate(b.brought), led: toRate(b.led) }))
    .sort((a, b) => b.faced.total - a.faced.total || a.speciesId.localeCompare(b.speciesId));
}

/** The opponent species I do worst against, among those faced at least `minGames` times (worst first). */
export function nemeses(rows: OpponentRow[], n = 5, minGames = MIN_GAMES): OpponentRow[] {
  return rows
    .filter((r) => r.faced.total >= minGames)
    .sort((a, b) => a.faced.rate - b.faced.rate || b.faced.total - a.faced.total || a.speciesId.localeCompare(b.speciesId))
    .slice(0, n);
}

// ---------------------------------------------------------------------------
// Trend and archetypes
// ---------------------------------------------------------------------------

export interface TrendPoint {
  regulationId: string;
  /** Monday of the ISO week, yyyy-mm-dd. */
  week: string;
  rate: Rate;
}

/** The Monday on or before an ISO date. */
export function weekStart(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/** Weekly win rate per regulation, oldest first. */
export function weeklyTrend(matches: Match[]): TrendPoint[] {
  const by = new Map<string, Match[]>();
  for (const m of matches) {
    const key = `${m.regulationId ?? '—'}|${weekStart(m.date)}`;
    by.set(key, [...(by.get(key) ?? []), m]);
  }
  return [...by.entries()]
    .map(([key, ms]) => {
      const [regulationId, week] = key.split('|');
      return { regulationId, week, rate: toRate(ms) };
    })
    .sort((a, b) => a.regulationId.localeCompare(b.regulationId) || a.week.localeCompare(b.week));
}

export interface ArchetypeCell {
  mine: string;
  theirs: string;
  rate: Rate;
}

/** My archetype against theirs, over matches where both were tagged. */
export function archetypeGrid(matches: Match[]): { mine: string[]; theirs: string[]; cells: Map<string, ArchetypeCell> } {
  const cells = new Map<string, Match[]>();
  for (const m of matches) {
    if (!m.myArchetype || !m.opponentArchetype) continue;
    const key = `${m.myArchetype}|${m.opponentArchetype}`;
    cells.set(key, [...(cells.get(key) ?? []), m]);
  }
  const mine = [...new Set([...cells.keys()].map((k) => k.split('|')[0]))].sort();
  const theirs = [...new Set([...cells.keys()].map((k) => k.split('|')[1]))].sort();
  return { mine, theirs, cells: new Map([...cells.entries()].map(([k, ms]) => [k, { mine: k.split('|')[0], theirs: k.split('|')[1], rate: toRate(ms) }])) };
}

/** "3-1 · 75% (35–96%)", or "1-0 · too few games" under the minimum, so a 1–0 never reads as 100%. */
export function formatRate(r: Rate): string {
  const record = `${r.wins}-${r.losses}`;
  if (r.total === 0) return '—';
  if (r.thin) return `${record} · too few games`;
  return `${record} · ${Math.round(r.rate * 100)}% (${Math.round(r.low * 100)}–${Math.round(r.high * 100)}%)`;
}
