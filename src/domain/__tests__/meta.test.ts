import { describe, expect, it } from 'vitest';
import { coreOverlapScore, loadMetaSnapshot, localMetaFromMatches, MetaDataError, type MetaEntry } from '@/domain/meta';

describe('checked-in usage snapshot', () => {
  it('loads and normalises the bundled champions-reg-mc snapshot, sorted by usage', () => {
    const snap = loadMetaSnapshot('champions-reg-mc');
    expect(snap.regulationId).toBe('champions-reg-mc');
    expect(snap.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(snap.entries.length).toBeGreaterThan(0);
    const usages = snap.entries.map((e) => e.usagePct);
    expect(usages).toEqual([...usages].sort((a, b) => b - a));
  });

  it('throws MetaDataError for a regulation with no checked-in snapshot', () => {
    expect(() => loadMetaSnapshot('champions-reg-nonexistent')).toThrow(MetaDataError);
  });
});

describe('opponent-vs-meta core overlap', () => {
  const entry: MetaEntry = { speciesId: 'incineroar', usagePct: 20, items: [], moves: [], spreads: [], teammates: [{ speciesId: 'rillaboom', pct: 40 }] };

  it('scores full overlap as 1 and no overlap as 0', () => {
    expect(coreOverlapScore(['incineroar', 'rillaboom'], entry)).toBe(1);
    expect(coreOverlapScore(['landorustherian'], entry)).toBe(0);
    expect(coreOverlapScore(['incineroar'], entry)).toBe(0.5);
  });

  it('returns 0 when the entry has no known teammates to compare against', () => {
    expect(coreOverlapScore(['incineroar'], { ...entry, teammates: undefined })).toBe(0);
  });
});

describe('local meta fallback from logged matches', () => {
  it('builds usage/items/moves from matches in the given regulation only', () => {
    const snap = localMetaFromMatches(
      [
        {
          regulationId: 'reg-a',
          opponentTeam: [
            { speciesId: 'incineroar', itemId: 'safetygoggles', moves: ['fakeout', 'knockoff'] },
            { speciesId: 'rillaboom', itemId: 'assaultvest' },
          ],
        },
        { regulationId: 'reg-a', opponentTeam: [{ speciesId: 'incineroar', itemId: 'safetygoggles' }] },
        { regulationId: 'reg-b', opponentTeam: [{ speciesId: 'landorustherian' }] },
      ],
      'reg-a',
    );
    expect(snap).not.toBeNull();
    expect(snap!.source).toContain('2 of your logged matches');
    expect(snap!.entries[0].speciesId).toBe('incineroar');
    expect(snap!.entries[0].usagePct).toBe(100);
    expect(snap!.entries[0].items[0]).toEqual({ itemId: 'safetygoggles', pct: 100 });
    expect(snap!.entries.find((e) => e.speciesId === 'rillaboom')?.usagePct).toBe(50);
  });

  it('returns null when there are no matches for that regulation', () => {
    expect(localMetaFromMatches([{ regulationId: 'reg-a', opponentTeam: [{ speciesId: 'x' }] }], 'reg-b')).toBeNull();
    expect(localMetaFromMatches([], 'reg-a')).toBeNull();
  });
});
