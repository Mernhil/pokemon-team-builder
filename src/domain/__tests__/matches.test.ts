import { describe, expect, it } from 'vitest';
import {
  bringLimits,
  type BringSelection,
  bringState,
  cycleBring,
  normalizeBring,
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

  it('quotes a CSV cell containing a bare carriage return', () => {
    const csv = matchesToCSV([mkMatch({ notes: 'a\rb' })], (id) => id, (id) => id);
    expect(csv.split('\n')[1]).toContain('"a\rb"');
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

describe('brought and led', () => {
  const limits = { bring: 4, lead: 2 };
  const empty: BringSelection = { brought: [], leads: [] };

  it('uses doubles 4/2 (and singles 3/1) from the regulation', () => {
    expect(bringLimits('champions-reg-mc')).toEqual({ bring: 4, lead: 2 });
    expect(bringLimits(undefined)).toEqual({ bring: 4, lead: 2 });
    expect(bringLimits('gen9')).toEqual({ bring: 3, lead: 1 });
  });

  it('cycles not brought → brought → lead → not brought', () => {
    let s = cycleBring(empty, 'a', limits);
    expect(bringState(s, 'a')).toBe('brought');
    s = cycleBring(s, 'a', limits);
    expect(bringState(s, 'a')).toBe('lead');
    expect(s).toEqual({ brought: ['a'], leads: ['a'] });
    s = cycleBring(s, 'a', limits);
    expect(s).toEqual(empty);
  });

  it('respects the limits: no fifth Pokémon, no third lead', () => {
    let s = empty;
    for (const id of ['a', 'b', 'c', 'd']) s = cycleBring(s, id, limits);
    expect(s.brought).toEqual(['a', 'b', 'c', 'd']);
    expect(cycleBring(s, 'e', limits)).toBe(s);
    for (const id of ['a', 'b']) s = cycleBring(s, id, limits);
    expect(s.leads).toEqual(['a', 'b']);
    // With both lead slots taken, a third tap sends a merely brought Pokémon back to the bench.
    s = cycleBring(s, 'c', limits);
    expect(s.brought).not.toContain('c');
    expect(s.leads).toEqual(['a', 'b']);
  });

  it('singles lead with one', () => {
    const singles = { bring: 3, lead: 1 };
    let s = cycleBring(cycleBring(cycleBring(empty, 'a', singles), 'a', singles), 'b', singles);
    s = cycleBring(s, 'b', singles);
    expect(s.leads).toEqual(['a']);
    expect(s.brought).toEqual(['a']);
  });

  it('normalises: drops strangers, duplicates and leads that were not brought', () => {
    expect(normalizeBring({ brought: ['a', 'a', 'x', 'b', 'c', 'd', 'e'], leads: ['b', 'z', 'a', 'c'] }, ['a', 'b', 'c', 'd', 'e'], limits)).toEqual({ brought: ['a', 'b', 'c', 'd'], leads: ['b', 'a'] });
  });

  it('a match with only a result is still valid, and the new fields are sanitised', () => {
    const bare = sanitizeMatch({ date: '2026-01-01', result: 'win' })!;
    expect(bare.myBrought).toBeUndefined();
    expect(bare.oppLeads).toBeUndefined();
    const m = sanitizeMatch({
      date: '2026-01-01',
      result: 'loss',
      myBrought: ['u1', 'u2', 'u2', 3, 'u3', 'u4', 'u5', 'u6', 'u7'],
      myLeads: ['u2', 'zzz', 'u1', 'u3'],
      oppBrought: ['garchomp'],
      oppLeads: ['kingambit'],
    })!;
    expect(m.myBrought).toEqual(['u1', 'u2', 'u3', 'u4', 'u5', 'u6']);
    expect(m.myLeads).toEqual(['u2', 'u1']);
    expect(m.oppBrought).toEqual(['garchomp']);
    // A lead that was never brought is dropped rather than invented.
    expect(m.oppLeads).toBeUndefined();
  });

  it('adds the brought and led columns to the CSV, naming my saved-team Pokémon through the callback', () => {
    const m = mkMatch({ myTeamId: 't1', myBrought: ['u1', 'u2'], myLeads: ['u1'], oppBrought: ['garchomp', 'kingambit'], oppLeads: ['garchomp'], opponentTeam: [{ speciesId: 'garchomp' }, { speciesId: 'kingambit' }] });
    const csv = matchesToCSV([m], (id) => id.toUpperCase(), () => 'Team', (_m, id) => ({ u1: 'Incineroar', u2: 'Urshifu' })[id]!);
    const [header, row] = csv.split('\n');
    expect(header.split(',').slice(-5, -1)).toEqual(['My Brought', 'My Leads', 'Opponent Brought', 'Opponent Leads']);
    expect(row).toContain('Incineroar / Urshifu,Incineroar,GARCHOMP / KINGAMBIT,GARCHOMP');
    // Without the callback it falls back to the species name.
    expect(matchesToCSV([{ ...m, myBrought: ['x'] }], (id) => id.toUpperCase(), () => 'T').split('\n')[1]).toContain(',X,');
  });
});
