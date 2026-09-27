import { describe, expect, it } from 'vitest';
import {
  cloneOpponentTeam,
  createMatch,
  matchesToCSV,
  opponentCoreFrequency,
  opponentSpeciesFrequency,
  overallWinRate,
  suggestRegulationForDate,
  winRateByRegulation,
  winRateByTeam,
  type Match,
} from '@/domain/matches';
import { sanitizeMatch } from '@/domain/sanitize';

const mkMatch = (over: Partial<Match>): Match => ({ ...createMatch('2026-01-01'), opponentTeam: [], ...over });

describe('match tracker domain', () => {
  it('creates a match with only date + result required, auto-suggesting a regulation', () => {
    const m = createMatch('2026-01-01');
    expect(m.result).toBe('win');
    expect(m.opponentTeam).toEqual([]);
    expect(m.category).toBeUndefined();
    expect(m.myTeamId).toBeUndefined();
  });

  it('suggests the regulation live on a given date, or none for an invalid date', () => {
    expect(suggestRegulationForDate('not-a-date')).toBeUndefined();
    // Some regulation should always resolve for dates within the app's known calendar.
    expect(suggestRegulationForDate('2026-09-15')).toBe('champions-reg-mc');
  });

  it('clones an opponent core independently of the source (for "clone last opponent")', () => {
    const src = [{ speciesId: 'incineroar', moves: ['fakeout'] }];
    const clone = cloneOpponentTeam(src);
    clone[0].moves!.push('flareblitz');
    expect(src[0].moves).toEqual(['fakeout']);
  });

  it('computes overall and grouped win rates', () => {
    const matches = [
      mkMatch({ result: 'win', regulationId: 'a', myTeamId: 't1' }),
      mkMatch({ result: 'loss', regulationId: 'a', myTeamId: 't1' }),
      mkMatch({ result: 'win', regulationId: 'b', myTeamId: 't2' }),
    ];
    expect(overallWinRate(matches)).toEqual({ wins: 2, losses: 1, total: 3, rate: 2 / 3 });
    const byReg = winRateByRegulation(matches);
    expect(byReg.get('a')).toEqual({ wins: 1, losses: 1, total: 2, rate: 0.5 });
    expect(byReg.get('b')).toEqual({ wins: 1, losses: 0, total: 1, rate: 1 });
    const byTeam = winRateByTeam(matches);
    expect(byTeam.get('t1')!.rate).toBe(0.5);
    expect(overallWinRate([])).toEqual({ wins: 0, losses: 0, total: 0, rate: 0 });
  });

  it('builds a personal-meta frequency snapshot of opponent species and cores', () => {
    const matches = [
      mkMatch({ opponentTeam: [{ speciesId: 'incineroar' }, { speciesId: 'rillaboom' }] }),
      mkMatch({ opponentTeam: [{ speciesId: 'incineroar' }, { speciesId: 'rillaboom' }] }),
      mkMatch({ opponentTeam: [{ speciesId: 'incineroar' }] }),
    ];
    expect(opponentSpeciesFrequency(matches).get('incineroar')).toBe(3);
    expect(opponentSpeciesFrequency(matches).get('rillaboom')).toBe(2);
    expect(opponentCoreFrequency(matches).get('incineroar+rillaboom')).toBe(2);
  });

  it('exports a CSV with a header row and one row per match', () => {
    const matches = [mkMatch({ result: 'loss', opponentTeam: [{ speciesId: 'incineroar' }], eventName: 'Locals, "Round 1"' })];
    const csv = matchesToCSV(matches, (id) => id, (id) => id);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('Result');
    expect(lines[1]).toContain('"Locals, ""Round 1"""');
  });
});

describe('match sanitising', () => {
  it('coerces malformed input into a well-formed match, or null when unrecognisable', () => {
    expect(sanitizeMatch(undefined)).toBeNull();
    expect(sanitizeMatch({ date: 'not-a-date', result: 'win' })).toBeNull();
    const m = sanitizeMatch({
      id: '__proto__',
      date: '2026-01-01',
      result: 'loss',
      opponentTeam: [{ speciesId: 'incineroar', moves: ['fakeout', 1, null] }, {}],
      myTeam: [{ speciesId: 'urshifu' }],
    })!;
    expect(m.id).not.toBe('__proto__');
    expect(m.result).toBe('loss');
    expect(m.opponentTeam).toEqual([{ speciesId: 'incineroar', moves: ['fakeout'] }]);
    expect(m.myTeam).toEqual([{ speciesId: 'urshifu' }]);
  });

  it('defaults an unrecognised result to a win rather than dropping the match', () => {
    expect(sanitizeMatch({ date: '2026-01-01', result: 'draw' })!.result).toBe('win');
  });
});
