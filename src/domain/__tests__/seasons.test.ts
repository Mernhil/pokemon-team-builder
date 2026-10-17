import { describe, expect, it } from 'vitest';
import manifest from '@/data/generated/regulations.json';
import { currentSeason, formatSeasonReset, nextSeason, seasonDaysLeft } from '@/domain/seasons';
import type { RankedSeason } from '@/domain/types';

const seasons = manifest.seasons as RankedSeason[];
const at = (iso: string) => Date.parse(iso);
const m6 = seasons.find((s) => s.id === 'M-6')!;
const m7 = seasons.find((s) => s.id === 'M-7')!;

describe('ranked seasons', () => {
  it('ships M-6 and M-7, each in a regulation that exists', () => {
    expect(m6).toBeDefined();
    expect(m7).toBeDefined();
    for (const s of [m6, m7]) expect(manifest.regulations.some((r) => r.id === s.regulation)).toBe(true);
  });

  it('currentSeason picks the running one', () => {
    expect(currentSeason(seasons, at('2026-10-17T10:00:00Z'))?.id).toBe('M-7');
    expect(currentSeason(seasons, at('2026-11-04T02:00:00Z'))).toBeUndefined();
    expect(currentSeason(undefined, at('2026-10-17T10:00:00Z'))).toBeUndefined();
  });

  it('switches over at 02:00 UTC', () => {
    expect(currentSeason(seasons, at('2026-10-07T01:59:00Z'))?.id).toBe('M-6');
    expect(currentSeason(seasons, at('2026-10-07T02:00:00Z'))?.id).toBe('M-7');
  });

  it('counts the days left, rounded up, never below 0', () => {
    expect(seasonDaysLeft(m7, at('2026-10-17T10:00:00Z'))).toBe(18);
    expect(seasonDaysLeft(m7, at('2026-11-03T12:00:00Z'))).toBe(1);
    expect(seasonDaysLeft(m7, at('2026-11-05T00:00:00Z'))).toBe(0);
  });

  it('nextSeason finds the earliest one that has not started', () => {
    expect(nextSeason(seasons, at('2026-09-20T00:00:00Z'))?.id).toBe('M-7');
    expect(nextSeason(seasons, at('2026-10-07T02:00:00Z'))).toBeUndefined();
  });

  it('formats the reset in the viewer timezone, across the 25 Oct DST change', () => {
    expect(formatSeasonReset(m7, 'en-GB', 'Europe/Rome')).toBe('4 Nov, 02:59');
    expect(formatSeasonReset(m7, 'en-GB', 'UTC')).toBe('4 Nov, 01:59');
    expect(formatSeasonReset(m6, 'en-GB', 'Europe/Rome')).toBe('7 Oct, 03:59');
  });
});
