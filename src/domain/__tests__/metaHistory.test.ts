import { describe, expect, it } from 'vitest';
import { MetaSnapshotSchema } from '../meta';
import {
  appendHistory,
  computeTrends,
  ingameIndexDates,
  parseMetaHistory,
  risingThreats,
  snapshotToHistoryEntry,
  speciesSeries,
  thinHistory,
  trendRows,
  trendText,
  type HistoryEntry,
} from '../metaHistory';

const day = (n: number) => new Date(Date.UTC(2026, 8, 1 + n)).toISOString().slice(0, 10);
const ingame = (n: number, ranks: string[], s = 'M6'): HistoryEntry => ({ d: day(n), k: 'ingame', s, r: ranks.map((id, i) => [id, i + 1]) });
const smogon = (d: string, pcts: [string, number][]): HistoryEntry => ({ d, k: 'smogon', r: pcts });

describe('history entries', () => {
  it('turns in-game snapshots into rank pairs and Smogon into % pairs, and ignores other sources', () => {
    const entries = [
      { speciesId: 'a', usageRank: 1, abilities: [], items: [], moves: [], teammates: [], spreads: [] },
      { speciesId: 'b', usageRank: 2, abilities: [], items: [], moves: [], teammates: [], spreads: [] },
    ];
    const snap = MetaSnapshotSchema.parse({ regulationId: 'r', updatedAt: '2026-10-03', source: { kind: 'ingame', name: 'x', season: 'M6' }, entries });
    expect(snapshotToHistoryEntry(snap)).toEqual({ d: '2026-10-03', k: 'ingame', s: 'M6', r: [['a', 1], ['b', 2]] });
    const sm = MetaSnapshotSchema.parse({ regulationId: 'r', updatedAt: '2026-10-03', source: { kind: 'smogon', name: 'x', month: '2026-08' }, entries: [{ ...entries[0], usagePct: 40, usageRank: undefined }] });
    expect(snapshotToHistoryEntry(sm)).toEqual({ d: '2026-08-31', k: 'smogon', r: [['a', 40]] });
    expect(snapshotToHistoryEntry({ ...snap, source: { kind: 'replays', name: 'x' } })).toBeNull();
  });

  it('appends one entry per date (the newer replaces), sorted', () => {
    let list: HistoryEntry[] = [];
    list = appendHistory(list, ingame(2, ['a']));
    list = appendHistory(list, ingame(0, ['b']));
    list = appendHistory(list, ingame(2, ['c']));
    expect(list.map((e) => e.d)).toEqual([day(0), day(2)]);
    expect(list[1].r[0][0]).toBe('c');
  });

  it('keeps a Smogon month and an in-game day with the same date apart, and trends ignore the other source inside a run', () => {
    let list: HistoryEntry[] = [];
    for (let i = 0; i < 6; i++) list = appendHistory(list, ingame(i, ['a', 'b']));
    list = appendHistory(list, smogon(day(3), [['a', 50]]));
    expect(list).toHaveLength(7);
    const r = computeTrends(list, 30)!;
    expect(r.kind).toBe('ingame');
    expect(r.baseline).toBe(day(0));
    expect(r.breakAt).toBeUndefined();
  });

  it('thins old entries to weekly and never exceeds the cap', () => {
    const all = Array.from({ length: 200 }, (_, i) => ingame(i, ['a']));
    const thin = thinHistory(all, 120, 60);
    expect(thin.length).toBeLessThanOrEqual(120);
    expect(thin.at(-1)!.d).toBe(day(199));
    // the last 60 days stay daily
    expect(thin.filter((e) => e.d >= day(139)).length).toBe(61);
    // older ones are a week apart
    const old = thin.filter((e) => e.d < day(139));
    for (let i = 1; i < old.length; i++) expect(Date.parse(old[i].d) - Date.parse(old[i - 1].d)).toBe(7 * 86_400_000);
    expect(thinHistory(all.slice(0, 50), 120)).toHaveLength(50);
    expect(thinHistory(all, 30)).toHaveLength(30);
  });

  it('validates the file', () => {
    expect(() => parseMetaHistory({ version: 1, regulations: { r: { entries: [{ d: 'x', k: 'ingame', r: [] }] } } })).toThrow(/failed validation/);
    expect(parseMetaHistory({ version: 1, regulations: {} }).regulations).toEqual({});
  });
});

describe('backfill index parser', () => {
  const index = {
    seasons: [
      { season: 'M6', dates: ['02_10_2026', '01_10_2026', '30_09_2026'], formats: ['Doubles', 'Singles'] },
      { season: 'M5', dates: ['10_09_2026'], formats: ['Singles'] },
      { season: 'M4', dates: ['05_08_2026'], formats: ['Doubles'] },
    ],
  };
  it('lists every Doubles snapshot, oldest first, as ISO dates', () => {
    expect(ingameIndexDates(index)).toEqual([
      { season: 'M4', date: '05_08_2026', iso: '2026-08-05' },
      { season: 'M6', date: '30_09_2026', iso: '2026-09-30' },
      { season: 'M6', date: '01_10_2026', iso: '2026-10-01' },
      { season: 'M6', date: '02_10_2026', iso: '2026-10-02' },
    ]);
    expect(ingameIndexDates({ nope: 1 })).toEqual([]);
  });
});

describe('trends', () => {
  const list = Array.from({ length: 31 }, (_, i) => {
    // x climbs from 15 to 6 over 31 days; y falls from 2 to 11; n enters at the end; g leaves
    const ranks = new Array(30).fill('').map((_, j) => `f${j}`);
    ranks[Math.max(0, 15 - Math.round((i / 30) * 9)) - 1] = 'x';
    return ingame(i, ranks);
  });

  it('measures rank deltas over 7 and 30 days and the season', () => {
    const r7 = computeTrends(list, 7)!;
    expect(r7.days).toBe(7);
    expect(r7.shortened).toBe(false);
    const r30 = computeTrends(list, 30)!;
    expect(r30.days).toBe(30);
    const x = r30.rows.find((r) => r.speciesId === 'x')!;
    expect(x.delta).toBe(9);
    expect(x.status).toBe('rising');
    expect(trendText(x, r30)).toBe('▲ 9 places in 30 days');
    expect(computeTrends(list, 'season')!.baseline).toBe(day(0));
  });

  it('flags new and dropped species relative to the top N and falling ones', () => {
    const a = ingame(0, ['a', 'b', 'c', 'd'], 'M6');
    const b = ingame(7, ['b', 'c', 'e', 'a'], 'M6');
    const rep = computeTrends([a, b], 7, 3)!;
    const by = (id: string) => rep.rows.find((r) => r.speciesId === id)!;
    expect(by('e').status).toBe('new');
    expect(by('a').status).toBe('dropped');
    expect(trendText(by('e'), rep, 3)).toBe('new in the top 3');
    expect(trendText(by('a'), rep, 3)).toBe('left the top 3 (now #4)');
    expect(trendRows(rep, 'new').map((r) => r.speciesId)).toEqual(['e']);
    const fall = computeTrends([ingame(0, ['a', 'b', 'c', 'd', 'e', 'f', 'g']), ingame(7, ['b', 'c', 'd', 'e', 'f', 'g', 'a'])], 7, 20)!;
    expect(fall.rows.find((r) => r.speciesId === 'a')).toMatchObject({ status: 'falling', delta: -6 });
    expect(trendText(fall.rows.find((r) => r.speciesId === 'a')!, fall)).toBe('▼ 6 places in 7 days');
  });

  it('needs two entries, and says when the data is shorter than the period', () => {
    expect(computeTrends([ingame(0, ['a'])], 7)).toBeNull();
    const short = computeTrends([ingame(0, ['a', 'b']), ingame(2, ['b', 'a'])], 30)!;
    expect(short.shortened).toBe(true);
    expect(short.days).toBe(2);
  });

  it('never compares across a source or season change: it marks the break', () => {
    const entries = [smogon('2026-08-31', [['a', 40], ['b', 30]]), ingame(0, ['b', 'a']), ingame(5, ['a', 'b'])];
    const r = computeTrends(entries, 30)!;
    expect(r.kind).toBe('ingame');
    expect(r.baseline).toBe(day(0));
    expect(r.breakAt).toMatchObject({ date: day(0), from: 'Smogon usage', to: 'in-game ranking M6' });
    // a new ranked season breaks too
    const seasons = computeTrends([ingame(0, ['a', 'b'], 'M5'), ingame(3, ['b', 'a'], 'M6'), ingame(6, ['a', 'b'], 'M6')], 30)!;
    expect(seasons.baseline).toBe(day(3));
    expect(seasons.breakAt?.to).toBe('in-game ranking M6');
    // no break reported when the period fits inside the run
    expect(computeTrends([smogon('2026-07-31', [['a', 1]]), ...Array.from({ length: 10 }, (_, i) => ingame(i, ['a', 'b']))], 7)!.breakAt).toBeUndefined();
  });

  it('measures Smogon usage in percentage points', () => {
    const rep = computeTrends([smogon('2026-06-30', [['a', 30], ['b', 20]]), smogon('2026-07-31', [['a', 25.5], ['b', 24]])], 30)!;
    expect(rep.kind).toBe('smogon');
    const a = rep.rows.find((r) => r.speciesId === 'a')!;
    expect(a.delta).toBe(-4.5);
    expect(trendText(a, rep)).toBe('▼ 4.5 points in 31 days');
    expect(rep.rows.find((r) => r.speciesId === 'b')!.delta).toBe(4);
  });

  it('draws one species over the window', () => {
    const s = speciesSeries(list, 'x', 7)!;
    expect(s.kind).toBe('ingame');
    expect(s.points.at(-1)!.date).toBe(day(30));
    expect(s.points.length).toBe(9);
    expect(speciesSeries(list, 'nobody', 7)).toBeNull();
  });
});

describe('rising threats', () => {
  it('lists rising Pokémon that beat at least two of the team', () => {
    const rep = computeTrends([ingame(0, ['a', 'b', 'c', 'd', 'e']), ingame(7, ['e', 'b', 'c', 'd', 'a'])], 7)!;
    const hits = risingThreats(rep, ['e', 'a', 'b'], [[-3, -2, 1], [-3, -3, -3], [-3, -3, -3]]);
    expect(hits.map((h) => h.speciesId)).toEqual(['e']);
    expect(hits[0]).toMatchObject({ beats: 2, text: '▲ 4 places in 7 days' });
    expect(risingThreats(rep, ['e'], [[-3, 1, 1]])).toEqual([]);
    expect(risingThreats(null, ['e'], [[-3, -3]])).toEqual([]);
  });
});
