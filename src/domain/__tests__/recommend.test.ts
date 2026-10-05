import { describe, expect, it } from 'vitest';
import data from '@/data/generated/champions.json';
import { Dex } from '@/data/dex';
import { getFormat } from '@/domain/formats';
import type { MetaSnapshot } from '@/domain/meta';
import { recommendFor } from '@/domain/recommend';
import type { Dataset } from '@/domain/types';

const dex = new Dex(data as unknown as Dataset);
const fmt = getFormat('champions-vgc-reg-mc');
const snapshot = {
  entries: [
    {
      speciesId: 'garchomp',
      usagePct: 30,
      abilities: [{ id: 'roughskin', pct: 90 }, { id: 'notanability', pct: 5 }],
      items: [{ id: 'notanitem', pct: 50 }, { id: 'sitrusberry', pct: 40 }, { id: 'garchompite', pct: 30 }],
      moves: [{ id: 'earthquake', pct: 95 }, { id: 'notamove', pct: 90 }, { id: 'dragonclaw', pct: 80 }],
      teammates: [],
      spreads: [{ nature: 'Jolly', values: [2, 32, 0, 0, 0, 32], pct: 60 }],
    },
  ],
} as unknown as MetaSnapshot;

describe('recommendFor', () => {
  const rec = recommendFor(snapshot, 'garchomp', dex, fmt)!;

  it('lists the most-used items, abilities and moves the format allows, in usage order', () => {
    expect(rec.items.map((i) => i.id)).not.toContain('notanitem');
    expect(rec.items[0]).toMatchObject({ id: 'sitrusberry', pct: 40 });
    expect(rec.abilities.map((a) => a.id)).toEqual(['roughskin']);
    expect(rec.moves.map((m) => m.id)).toEqual(['earthquake', 'dragonclaw']);
  });

  it('keeps the spreads and builds the whole recommended set', () => {
    expect(rec.spreads[0]).toMatchObject({ nature: 'Jolly', pct: 60 });
    expect(rec.set?.set.nature).toBe('Jolly');
    expect(rec.set?.set.moves[0]).toBe('earthquake');
  });

  it('has nothing for a species with no entry', () => {
    expect(recommendFor(snapshot, 'incineroar', dex, fmt)).toBeUndefined();
  });
});
