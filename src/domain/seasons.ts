/** What these helpers need of a `RankedSeason` (kept structural so scripts can import this file without types.ts). */
export interface SeasonDates {
  id: string;
  start: string;
  end: string;
}

const DAY_MS = 86_400_000;

/** The season running at `now` (start <= now <= end); the newest start wins if two overlap. */
export function currentSeason<T extends SeasonDates>(seasons: T[] = [], now: number = Date.now()): T | undefined {
  return [...seasons]
    .sort((a, b) => Date.parse(b.start) - Date.parse(a.start))
    .find((s) => Date.parse(s.start) <= now && now <= Date.parse(s.end));
}

/** The earliest season that starts after `now`. */
export function nextSeason<T extends SeasonDates>(seasons: T[] = [], now: number = Date.now()): T | undefined {
  return [...seasons]
    .filter((s) => Date.parse(s.start) > now)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];
}

/** Whole days until the ladder resets, rounded up, never below 0. */
export function seasonDaysLeft(season: SeasonDates, now: number = Date.now()): number {
  return Math.max(0, Math.ceil((Date.parse(season.end) - now) / DAY_MS));
}

/** When the ladder resets, as "4 Nov, 02:59" (24 h), in the viewer's timezone unless one is given. */
export function formatSeasonReset(season: SeasonDates, locale?: string, timeZone?: string): string {
  return new Date(season.end).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone });
}
