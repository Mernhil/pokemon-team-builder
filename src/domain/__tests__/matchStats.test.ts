import { describe, expect, it } from 'vitest';
import { createMatch, type Match } from '@/domain/matches';
import {
  MIN_GAMES,
  archetypeGrid,
  filterMatches,
  formatRate,
  nemeses,
  opponentStats,
  toRate,
  weekStart,
  weeklyTrend,
  wilson,
  winRateByBrought,
  winRateByLead,
  winRateByVariation,
  type TeamLookup,
} from '@/domain/matchStats';

let n = 0;
const mk = (over: Partial<Match>): Match => ({ ...createMatch('2026-09-14'), id: `m${n++}`, opponentTeam: [], ...over });
const games = (count: number, wins: number, over: Partial<Match>) => Array.from({ length: count }, (_, i) => mk({ ...over, result: i < wins ? 'win' : 'loss' }));

describe('Wilson interval', () => {
  it('matches known values', () => {
    const [lo, hi] = wilson(8, 10);
    expect(lo).toBeCloseTo(0.4902, 3);
    expect(hi).toBeCloseTo(0.9433, 3);
    const [l0, h0] = wilson(0, 10);
    expect(l0).toBe(0);
    expect(h0).toBeCloseTo(0.2775, 3);
  });
  it('is wide for tiny samples and never outside 0–1', () => {
    const [lo, hi] = wilson(1, 1);
    expect(hi).toBe(1);
    expect(lo).toBeLessThan(0.3);
    expect(wilson(0, 0)).toEqual([0, 1]);
    for (const [w, t] of [[0, 3], [3, 3], [5, 9], [50, 100]]) {
      const [a, b] = wilson(w, t);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
      expect(a).toBeLessThanOrEqual(w / t);
      expect(b).toBeGreaterThanOrEqual(w / t);
    }
  });
});

describe('rates and thin samples', () => {
  it('flags fewer than 5 games and never prints a percentage for them', () => {
    expect(MIN_GAMES).toBe(5);
    const one = toRate([{ result: 'win' }]);
    expect(one.thin).toBe(true);
    expect(formatRate(one)).toBe('1-0 · too few games');
    expect(formatRate(one)).not.toContain('100');
    const five = toRate(games(5, 4, {}));
    expect(five.thin).toBe(false);
    expect(formatRate(five)).toMatch(/^4-1 · 80% \(\d+–\d+%\)$/);
    expect(formatRate(toRate([]))).toBe('—');
  });
});

describe('filters', () => {
  const teams: Record<string, { name: string; groupId: string; variationLabel?: string }> = {
    main: { name: 'Rain', groupId: 'main' },
    var: { name: 'Rain vs TR', groupId: 'main', variationLabel: 'vs TR' },
    other: { name: 'Sand', groupId: 'other' },
  };
  const teamOf: TeamLookup = (id) => teams[id];
  const ms = [
    mk({ regulationId: 'champions-reg-mb', date: '2026-08-01', category: 'Ranked Ladder', myTeamId: 'main' }),
    mk({ regulationId: 'champions-reg-mc', date: '2026-09-10', category: 'Tournament', myTeamId: 'var' }),
    mk({ regulationId: 'champions-reg-mc', date: '2026-09-20', category: 'Ranked Ladder', myTeamId: 'other' }),
    mk({ regulationId: 'champions-reg-mc', date: '2026-10-02' }),
  ];
  it('combines regulation, category, date range, team and folder', () => {
    expect(filterMatches(ms, {}).length).toBe(4);
    expect(filterMatches(ms, { regulationId: 'champions-reg-mc' }).length).toBe(3);
    expect(filterMatches(ms, { category: 'Ranked Ladder' }).length).toBe(2);
    expect(filterMatches(ms, { from: '2026-09-10', to: '2026-09-20' }).length).toBe(2);
    expect(filterMatches(ms, { teamId: 'var' }).length).toBe(1);
    expect(filterMatches(ms, { groupId: 'main' }, teamOf).map((m) => m.myTeamId)).toEqual(['main', 'var']);
    expect(filterMatches(ms, { regulationId: 'champions-reg-mc', category: 'Ranked Ladder' }).length).toBe(1);
  });
});

describe('lead, brought and variation win rates', () => {
  const ms = [
    ...games(6, 4, { myLeads: ['a', 'b'], myBrought: ['a', 'b', 'c', 'd'] }),
    ...games(2, 0, { myLeads: ['b', 'a'], myBrought: ['d', 'c', 'b', 'a'] }),
    ...games(5, 1, { myLeads: ['a', 'c'], myBrought: ['a', 'c', 'e', 'f'] }),
    mk({}),
  ];
  it('groups by the unordered pair / four, and leaves matches without them out', () => {
    const leads = winRateByLead(ms);
    expect(leads.map((r) => [r.key, r.total, r.wins])).toEqual([
      ['a+b', 8, 4],
      ['a+c', 5, 1],
    ]);
    expect(leads[0].thin).toBe(false);
    const brought = winRateByBrought(ms);
    expect(brought[0]).toMatchObject({ key: 'a+b+c+d', total: 8, wins: 4 });
    expect(brought).toHaveLength(2);
  });
  it('merges saved-team Pokémon by species, whichever variation they came from', () => {
    const byUid = ms.map((m) => ({ ...m, myTeamId: 't' }));
    const uidToSpecies = (_m: Match, id: string) => ({ a: 'incineroar', b: 'garchomp', c: 'urshifu', d: 'rillaboom', e: 'x', f: 'y' })[id];
    expect(winRateByLead(byUid, uidToSpecies)[0].species).toEqual(['garchomp', 'incineroar']);
  });
  it('groups by saved team or variation with a readable label', () => {
    const teamOf: TeamLookup = (id) => ({ t1: { name: 'Rain', groupId: 't1' }, t2: { name: 'Rain', groupId: 't1', variationLabel: 'vs Sand' } })[id];
    const rows = winRateByVariation([...games(5, 5, { myTeamId: 't1' }), ...games(2, 1, { myTeamId: 't2' }), mk({}), mk({ myTeamId: 'gone' })], teamOf);
    expect(rows.map((r) => [r.label, r.total, r.thin])).toEqual([
      ['Rain', 5, false],
      ['Rain · vs Sand', 2, true],
    ]);
  });
});

describe('opponent species, nemeses', () => {
  const foes = (...ids: string[]) => ids.map((speciesId) => ({ speciesId }));
  const ms = [
    ...games(6, 1, { opponentTeam: foes('kingambit', 'sneasler'), oppBrought: ['kingambit'], oppLeads: ['kingambit'] }),
    ...games(5, 5, { opponentTeam: foes('whimsicott', 'sneasler'), oppBrought: ['sneasler', 'whimsicott'], oppLeads: ['sneasler'] }),
    ...games(2, 0, { opponentTeam: foes('dragapult') }),
  ];
  it('counts faced, brought and led separately', () => {
    const rows = Object.fromEntries(opponentStats(ms).map((r) => [r.speciesId, r]));
    expect(rows.sneasler.faced).toMatchObject({ total: 11, wins: 6 });
    expect(rows.sneasler.brought).toMatchObject({ total: 5, wins: 5 });
    expect(rows.sneasler.led).toMatchObject({ total: 5, wins: 5 });
    expect(rows.kingambit.led).toMatchObject({ total: 6, wins: 1 });
    expect(rows.whimsicott.led.total).toBe(0);
    expect(opponentStats(ms)[0].speciesId).toBe('sneasler');
  });
  it('lists the worst opponents among those faced enough times, worst first', () => {
    const list = nemeses(opponentStats(ms));
    expect(list.map((r) => r.speciesId)).toEqual(['kingambit', 'sneasler', 'whimsicott']);
    // Dragapult is 0–2: not enough games to call it a nemesis.
    expect(list.some((r) => r.speciesId === 'dragapult')).toBe(false);
    expect(nemeses(opponentStats(ms), 1)).toHaveLength(1);
    expect(nemeses(opponentStats(ms), 5, 6).map((r) => r.speciesId)).toEqual(['kingambit', 'sneasler']);
  });
});

describe('trend and archetype grid', () => {
  it('finds the Monday of a date', () => {
    expect(weekStart('2026-09-14')).toBe('2026-09-14');
    expect(weekStart('2026-09-20')).toBe('2026-09-14');
    expect(weekStart('2026-09-21')).toBe('2026-09-21');
  });
  it('buckets matches by regulation and week, oldest first', () => {
    const ms = [
      ...games(2, 2, { regulationId: 'champions-reg-mc', date: '2026-09-14' }),
      mk({ regulationId: 'champions-reg-mc', date: '2026-09-18', result: 'loss' }),
      mk({ regulationId: 'champions-reg-mc', date: '2026-09-22', result: 'win' }),
      mk({ regulationId: 'champions-reg-mb', date: '2026-08-03', result: 'loss' }),
    ];
    const t = weeklyTrend(ms);
    expect(t.map((p) => [p.regulationId, p.week, p.rate.total, p.rate.wins])).toEqual([
      ['champions-reg-mb', '2026-08-03', 1, 0],
      ['champions-reg-mc', '2026-09-14', 3, 2],
      ['champions-reg-mc', '2026-09-21', 1, 1],
    ]);
  });
  it('grids my archetype against theirs, only where both were tagged', () => {
    const ms = [
      ...games(5, 4, { myArchetype: 'Rain', opponentArchetype: 'Trick Room' }),
      ...games(2, 0, { myArchetype: 'Rain', opponentArchetype: 'Sun' }),
      mk({ myArchetype: 'Sand' }),
      mk({ opponentArchetype: 'Sun' }),
    ];
    const g = archetypeGrid(ms);
    expect(g.mine).toEqual(['Rain']);
    expect(g.theirs).toEqual(['Sun', 'Trick Room']);
    expect(g.cells.get('Rain|Trick Room')!.rate).toMatchObject({ total: 5, wins: 4, thin: false });
    expect(g.cells.get('Rain|Sun')!.rate.thin).toBe(true);
  });
});
