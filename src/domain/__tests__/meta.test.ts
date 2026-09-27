import { afterEach, describe, expect, it, vi } from 'vitest';
import { coreOverlapScore, fetchChampionsMeta, MetaFetchError, type MetaEntry } from '@/domain/meta';

afterEach(() => {
  vi.unstubAllGlobals();
});

const jsonResponse = (body: unknown, ok = true, status = 200) =>
  ({ ok, status, json: async () => body }) as Response;

describe('championsbattledata usage fetch', () => {
  it('normalises a well-formed response, sorted by usage', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          data: [
            { species: 'Incineroar', usage: 20, items: ['Safety Goggles'], moves: [{ move: 'Fake Out', pct: 90 }] },
            { pokemon: 'Rillaboom', usage_pct: 55.5, spreads: [{ nature: 'Adamant', sp: { atk: 32, hp: 20 }, pct: 70 }] },
          ],
        }),
      ),
    );
    const snap = await fetchChampionsMeta('champions-reg-mc');
    expect(snap.entries.map((e) => e.speciesId)).toEqual(['rillaboom', 'incineroar']);
    expect(snap.entries[1].items[0].itemId).toBe('safetygoggles');
    expect(snap.entries[0].spreads[0].nature).toBe('Adamant');
    expect(snap.fetchedAt).toBeGreaterThan(0);
  });

  it('throws MetaFetchError on network failure, non-OK status, bad JSON or an unrecognised shape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(fetchChampionsMeta('x')).rejects.toBeInstanceOf(MetaFetchError);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, false, 500)));
    await expect(fetchChampionsMeta('x')).rejects.toThrow('HTTP 500');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('bad'); } } as unknown as Response));
    await expect(fetchChampionsMeta('x')).rejects.toThrow("wasn't valid JSON");

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ weird: true })));
    await expect(fetchChampionsMeta('x')).rejects.toThrow('Unrecognised response shape');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [{ nope: 1 }] })));
    await expect(fetchChampionsMeta('x')).rejects.toThrow('No usage entries');
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
