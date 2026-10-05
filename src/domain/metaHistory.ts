/**
 * Meta history: what the Meta tab's numbers were on earlier days, so it can show what's moving.
 *
 * `src/data/generated/meta-history.json` keeps, per regulation, dated snapshots reduced to
 * [species id, number] pairs: the usage rank for the game's own ranked Battle Data (a new snapshot
 * every day), the usage % for Smogon's monthly statistics (dated the last day of the month).
 * `npm run meta` appends the day's snapshot (appendHistory), thins old entries to weekly
 * (thinHistory) and backfills the mirror's older days (ingameIndexDates). Ranks and percentages are
 * never compared with each other: a change of source (or of ranked season) is a break, and
 * computeTrends measures only within the newest unbroken run.
 *
 * Pure and light (zod + meta types only): the app loads the data lazily (src/data/useMetaHistory.ts).
 */
import { z } from 'zod';
import { ingameDate } from './metaSources.ts';
import { metaDataDate, metaSourceKind, type MetaSnapshot } from './meta.ts';

const id = z.string().regex(/^[a-z0-9]{1,64}$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const HISTORY_KINDS = ['ingame', 'smogon'] as const;
export type HistoryKind = (typeof HISTORY_KINDS)[number];

export const HistoryEntrySchema = z.object({
  /** The day the numbers describe (YYYY-MM-DD; the last day of the month for Smogon). */
  d: date,
  /** ingame: the number is a usage rank (1 = most used); smogon: a usage %. */
  k: z.enum(HISTORY_KINDS),
  /** In-game ranked season ("M6"): a new season is a break too. */
  s: z.string().max(16).optional(),
  /** [species id, rank or %], best first. */
  r: z.array(z.tuple([id, z.number().min(0)])).min(1),
});
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;

export const MetaHistorySchema = z.object({
  version: z.literal(1),
  regulations: z.record(z.string(), z.object({ entries: z.array(HistoryEntrySchema) })),
});
export type MetaHistory = z.infer<typeof MetaHistorySchema>;

export const EMPTY_HISTORY: MetaHistory = { version: 1, regulations: {} };

/** Validates untrusted history JSON; throws an Error naming the first problem. */
export function parseMetaHistory(json: unknown): MetaHistory {
  const r = MetaHistorySchema.safeParse(json);
  if (!r.success) {
    const first = r.error.issues[0];
    throw new Error(`Meta history failed validation at ${first.path.join('.') || '(root)'}: ${first.message}`);
  }
  return r.data;
}

/** Entries kept per regulation (see thinHistory). */
export const HISTORY_MAX_ENTRIES = 120;
/** Entries newer than this many days (before the newest) are kept daily; older ones thin to weekly. */
export const HISTORY_DAILY_DAYS = 60;
/** Species kept per entry. */
export const HISTORY_MAX_SPECIES = 60;

const DAY = 86_400_000;
const dayNumber = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / DAY);

/** A snapshot as a history entry; null for sources that aren't a stable ladder (tournaments, replays, carry-over, matches, manual). */
export function snapshotToHistoryEntry(snap: MetaSnapshot): HistoryEntry | null {
  const kind = metaSourceKind(snap);
  if (kind !== 'ingame' && kind !== 'smogon') return null;
  const rows = snap.entries
    .map((e) => [e.speciesId, kind === 'ingame' ? e.usageRank : e.usagePct] as const)
    .filter((x): x is readonly [string, number] => x[1] !== undefined)
    .slice(0, HISTORY_MAX_SPECIES);
  if (!rows.length) return null;
  return { d: metaDataDate(snap), k: kind, ...(snap.source.season ? { s: snap.source.season } : {}), r: rows.map(([s, n]) => [s, n] as [string, number]) };
}

/** ISO week key (year + Monday's day number / 7), for thinning. */
const weekOf = (d: string) => Math.floor((dayNumber(d) + 3) / 7);

/**
 * At most `max` entries, oldest thinned first: everything within `dailyDays` of the newest entry is
 * kept; older entries keep one per week (the last of it); if that's still too many, the oldest go.
 */
export function thinHistory(entries: HistoryEntry[], max = HISTORY_MAX_ENTRIES, dailyDays = HISTORY_DAILY_DAYS): HistoryEntry[] {
  const sorted = entries.slice().sort((a, b) => a.d.localeCompare(b.d));
  if (sorted.length <= max) return sorted;
  const newest = dayNumber(sorted.at(-1)!.d);
  const recent = sorted.filter((e) => newest - dayNumber(e.d) <= dailyDays);
  const old = sorted.filter((e) => newest - dayNumber(e.d) > dailyDays);
  const weekly = old.filter((e, i) => old[i + 1] === undefined || weekOf(old[i + 1].d) !== weekOf(e.d) || old[i + 1].k !== e.k);
  return [...weekly, ...recent].slice(-max);
}

/** Adds `entry` to a regulation's entries: one per date (the newer data replaces the same date), sorted, thinned. */
export function appendHistory(entries: HistoryEntry[], entry: HistoryEntry, max = HISTORY_MAX_ENTRIES): HistoryEntry[] {
  return thinHistory([...entries.filter((e) => e.d !== entry.d), entry], max);
}

/** Does a regulation's history already have this date? */
export const hasDate = (entries: HistoryEntry[], d: string) => entries.some((e) => e.d === d);

// ---------------------------------------------------------------------------
// Backfill: the in-game data mirror's index lists every daily snapshot
// ---------------------------------------------------------------------------

const MirrorIndex = z.object({
  seasons: z.array(z.object({ season: z.string().regex(/^[A-Za-z0-9_-]{1,16}$/), dates: z.array(z.string().regex(/^\d{2}_\d{2}_\d{4}$/)), formats: z.array(z.string()).default([]) })),
});

export interface IndexedSnapshot {
  season: string;
  /** dd_mm_yyyy, as the mirror's file paths spell it */
  date: string;
  iso: string;
}

/** Every dated snapshot of `format` the mirror's index.json lists, oldest first (empty for an unexpected index). */
export function ingameIndexDates(index: unknown, format = 'Doubles'): IndexedSnapshot[] {
  const parsed = MirrorIndex.safeParse(index);
  if (!parsed.success) return [];
  return parsed.data.seasons
    .filter((s) => s.formats.includes(format))
    .flatMap((s) => s.dates.map((date) => ({ season: s.season, date, iso: ingameDate(date) })))
    .sort((a, b) => a.iso.localeCompare(b.iso) || a.season.localeCompare(b.season));
}

// ---------------------------------------------------------------------------
// Trends
// ---------------------------------------------------------------------------

export const TREND_PERIODS = [7, 30, 'season'] as const;
export type TrendPeriod = (typeof TREND_PERIODS)[number];
export const TREND_PERIOD_LABEL: Record<string, string> = { '7': '7 days', '30': '30 days', season: 'the season' };

/** A species counts as "new" / "dropped" relative to the top this many. */
export const TREND_TOP_N = 20;
/** Smallest move that counts as rising or falling: places for ranks, percentage points for %. */
export const MIN_RANK_MOVE = 3;
export const MIN_PCT_MOVE = 1;

export type TrendStatus = 'rising' | 'falling' | 'new' | 'dropped' | 'steady';

export interface SpeciesTrend {
  speciesId: string;
  status: TrendStatus;
  /** Rank (ingame) or % (smogon) at the newest entry; undefined when not listed (outside the kept list). */
  now?: number;
  before?: number;
  /** Positive = better: places gained (rank) or points gained (%). Undefined when either side isn't listed. */
  delta?: number;
}

export interface TrendReport {
  kind: HistoryKind;
  /** Date of the newest entry, and of the entry it's measured against. */
  latest: string;
  baseline: string;
  /** Days between the two. */
  days: number;
  /** The period asked for was longer than the unbroken data reaches, so `days` is what exists. */
  shortened: boolean;
  /** A source or season change inside the asked period: the earlier numbers aren't comparable. */
  breakAt?: { date: string; from: string; to: string };
  rows: SpeciesTrend[];
}

const sourceLabel = (e: Pick<HistoryEntry, 'k' | 's'>) => (e.k === 'ingame' ? `in-game ranking${e.s ? ` ${e.s}` : ''}` : 'Smogon usage');

/** The newest run of entries measured the same way (same source and season), oldest first. */
export function currentRun(entries: HistoryEntry[]): { run: HistoryEntry[]; before?: HistoryEntry } {
  const sorted = entries.slice().sort((a, b) => a.d.localeCompare(b.d));
  const last = sorted.at(-1);
  if (!last) return { run: [] };
  let i = sorted.length - 1;
  while (i > 0 && sorted[i - 1].k === last.k && sorted[i - 1].s === last.s) i--;
  return { run: sorted.slice(i), before: sorted[i - 1] };
}

/**
 * Who moved over `period` (7 or 30 days, or the whole run), by comparing the newest entry with the
 * newest one at least that old inside the same unbroken run: if the run is shorter, with its first
 * entry (`shortened`), and a source change before it is reported as `breakAt`, never bridged.
 * Null with fewer than two comparable entries.
 */
export function computeTrends(entries: HistoryEntry[], period: TrendPeriod, topN = TREND_TOP_N): TrendReport | null {
  const { run, before } = currentRun(entries);
  if (run.length < 2) return null;
  const latest = run.at(-1)!;
  const target = period === 'season' ? -Infinity : dayNumber(latest.d) - period;
  const older = run.slice(0, -1);
  const found = older.filter((e) => dayNumber(e.d) <= target).at(-1);
  const base = found ?? older[0];
  const shortened = period !== 'season' && !found;
  const breakAt = before && (period === 'season' || shortened) ? { date: run[0].d, from: sourceLabel(before), to: sourceLabel(run[0]) } : undefined;

  const ranked = latest.k === 'ingame';
  const was = new Map(base.r);
  const now = new Map(latest.r);
  const topNow = (sp: string) => {
    const v = now.get(sp);
    return v !== undefined && (ranked ? v <= topN : [...now.keys()].indexOf(sp) < topN);
  };
  const topWas = (sp: string) => {
    const v = was.get(sp);
    return v !== undefined && (ranked ? v <= topN : [...was.keys()].indexOf(sp) < topN);
  };
  const minMove = ranked ? MIN_RANK_MOVE : MIN_PCT_MOVE;
  const rows: SpeciesTrend[] = [];
  for (const sp of new Set([...now.keys(), ...was.keys()])) {
    const n = now.get(sp);
    const b = was.get(sp);
    const delta = n !== undefined && b !== undefined ? (ranked ? b - n : Math.round((n - b) * 10) / 10) : undefined;
    let status: TrendStatus = 'steady';
    if (topNow(sp) && !topWas(sp)) status = 'new';
    else if (topWas(sp) && !topNow(sp)) status = 'dropped';
    else if (delta !== undefined && delta >= minMove) status = 'rising';
    else if (delta !== undefined && delta <= -minMove) status = 'falling';
    rows.push({ speciesId: sp, status, now: n, before: b, delta });
  }
  const size = (r: SpeciesTrend) => Math.abs(r.delta ?? 0);
  rows.sort((a, b) => size(b) - size(a) || (a.now ?? 999) - (b.now ?? 999) || a.speciesId.localeCompare(b.speciesId));
  return { kind: latest.k, latest: latest.d, baseline: base.d, days: dayNumber(latest.d) - dayNumber(base.d), shortened, breakAt, rows };
}

/** The rows of a report with one status, in report order (rising: biggest gain first; falling: biggest loss first). */
export const trendRows = (report: TrendReport, status: TrendStatus) => report.rows.filter((r) => r.status === status);

/** "▲ 9 places in 7 days", "▼ 1.4 points in 30 days", "new in the top 20", "left the top 20". */
export function trendText(t: SpeciesTrend, report: Pick<TrendReport, 'kind' | 'days'>, topN = TREND_TOP_N): string {
  const span = `in ${report.days} ${report.days === 1 ? 'day' : 'days'}`;
  if (t.status === 'new') return `new in the top ${topN}${t.before === undefined ? '' : ` (was ${report.kind === 'ingame' ? `#${t.before}` : `${t.before.toFixed(1)}%`})`}`;
  if (t.status === 'dropped') return `left the top ${topN}${t.now === undefined ? '' : ` (now ${report.kind === 'ingame' ? `#${t.now}` : `${t.now.toFixed(1)}%`})`}`;
  if (t.delta === undefined || t.delta === 0) return `unchanged ${span}`;
  const mag = Math.abs(t.delta);
  const unit = report.kind === 'ingame' ? (mag === 1 ? 'place' : 'places') : mag === 1 ? 'point' : 'points';
  return `${t.delta > 0 ? '▲' : '▼'} ${report.kind === 'ingame' ? mag : mag.toFixed(1)} ${unit} ${span}`;
}

export interface TrendPoint {
  date: string;
  /** Rank or %; undefined when the species wasn't listed that day. */
  value?: number;
}

/** One species' numbers over the newest unbroken run, limited to the last `days` (or all of it for the season). */
export function speciesSeries(entries: HistoryEntry[], speciesId: string, period: TrendPeriod): { kind: HistoryKind; points: TrendPoint[] } | null {
  const { run } = currentRun(entries);
  if (run.length < 2) return null;
  const latest = run.at(-1)!;
  const from = period === 'season' ? -Infinity : dayNumber(latest.d) - period;
  const inWindow = run.filter((e, i) => dayNumber(e.d) >= from || i === run.length - 1);
  // include the entry just before the window so the line starts at the baseline
  const idx = run.indexOf(inWindow[0]);
  const used = idx > 0 && period !== 'season' ? [run[idx - 1], ...inWindow] : inWindow;
  const points = used.map((e) => ({ date: e.d, value: e.r.find(([s]) => s === speciesId)?.[1] }));
  if (!points.some((p) => p.value !== undefined)) return null;
  return { kind: latest.k, points };
}

/** The species currently rising (or new in the top N) in a report, most gained first: the "rising threats" input. */
export const risingSpecies = (report: TrendReport | null, limit = 8): string[] =>
  report ? report.rows.filter((r) => r.status === 'rising' || r.status === 'new').slice(0, limit).map((r) => r.speciesId) : [];

/** A rising Pokémon that beats several of the team's members, from the Threat report's rows. */
export interface RisingThreat {
  speciesId: string;
  /** How many of the team's Pokémon come off worse against it (verdict "bad for you"). */
  beats: number;
  /** Its trend text, e.g. "▲ 9 places in 7 days". */
  text: string;
}

/**
 * Rising (or newly top-N) species among the threats the report checked that come off better against
 * at least `minBeats` of the team's members. `rows[i]` are the verdicts (negative = bad for me) of
 * `threatIds[i]` against each member; unfinished rows are skipped. Biggest rise first.
 */
export function risingThreats(report: TrendReport | null, threatIds: string[], rows: (number[] | undefined)[], minBeats = 2): RisingThreat[] {
  if (!report) return [];
  const out: RisingThreat[] = [];
  for (const t of report.rows) {
    if (t.status !== 'rising' && t.status !== 'new') continue;
    const i = threatIds.indexOf(t.speciesId);
    const verdicts = i >= 0 ? rows[i] : undefined;
    if (!verdicts) continue;
    const beats = verdicts.filter((v) => v <= -1.5).length;
    if (beats >= minBeats) out.push({ speciesId: t.speciesId, beats, text: trendText(t, report) });
  }
  return out.sort((a, b) => b.beats - a.beats);
}
