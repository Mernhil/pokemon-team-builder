import { describe, expect, it } from 'vitest';
import data from '@/data/generated/champions.json';
import { Dex } from '@/data/dex';
import { calcMoves, hitRange } from '@/domain/battle/damage';
import { defaultField, defaultSide } from '@/domain/battle/conditions';
import { hitsFor } from '@/domain/battle/multihit';
import { getFormat } from '@/domain/formats';
import { createSet } from '@/domain/team';
import type { Dataset, PokemonSet } from '@/domain/types';

describe('hitsFor', () => {
  const popBomb = { accuracy: 90, multihit: 10, multiaccuracy: true } as const;
  it('leaves fixed-hit and 2–5 hit moves to the calculator', () => {
    expect(hitsFor({ accuracy: 90, multihit: 2 })).toBeUndefined();
    expect(hitsFor({ accuracy: 100, multihit: [2, 5] })).toBeUndefined();
    expect(hitsFor({ accuracy: 100 })).toBeUndefined();
  });
  it('Skill Link and Loaded Dice on 2–5 hit moves', () => {
    expect(hitsFor({ accuracy: 100, multihit: [2, 5], item: 'Loaded Dice' })).toBe(4);
    expect(hitsFor({ accuracy: 100, multihit: [2, 5], item: 'Loaded Dice', ability: 'Skill Link' })).toBeUndefined();
  });
  it('per-hit accuracy: expected hits, up with Wide Lens, all with Skill Link', () => {
    expect(hitsFor(popBomb)).toBe(6);
    expect(hitsFor({ ...popBomb, item: 'Wide Lens' })).toBe(9);
    expect(hitsFor({ ...popBomb, ability: 'Skill Link' })).toBe(10);
    expect(hitsFor({ ...popBomb, ability: 'No Guard' })).toBe(10);
    expect(hitsFor({ accuracy: 90, multihit: 3, multiaccuracy: true })).toBe(2);
    expect(hitsFor({ accuracy: 90, multihit: 3, multiaccuracy: true, item: 'Wide Lens' })).toBe(3);
  });
});

describe('calcMoves with multi-hit moves', () => {
  const dex = new Dex(data as unknown as Dataset);
  const fmt = getFormat('champions-vgc-reg-mc');
  const run = (item: string) => {
    const atk = { ...createSet(dex, 'incineroar', fmt), itemId: item, moves: ['populationbomb', '', '', ''] as PokemonSet['moves'] };
    const def = createSet(dex, 'garchomp', fmt);
    return calcMoves(dex, { set: atk, cond: defaultSide() }, { set: def, cond: defaultSide() }, defaultField())[0]?.forms[0]?.percent[1] ?? 0;
  };
  it('reports the hit count it used', () => {
    const atk = { ...createSet(dex, 'incineroar', fmt), moves: ['populationbomb', 'flareblitz', '', ''] as PokemonSet['moves'] };
    const [pop, flare] = calcMoves(dex, { set: atk, cond: defaultSide() }, { set: createSet(dex, 'garchomp', fmt), cond: defaultSide() }, defaultField());
    expect(pop.forms[0].hits).toBe(6);
    expect(flare.forms[0].hits).toBeUndefined();
  });
  it('a chosen hit count overrides the default and is clamped to the move\'s range', () => {
    const atk = { ...createSet(dex, 'incineroar', fmt), moves: ['populationbomb', 'bulletseed', '', ''] as PokemonSet['moves'] };
    const go = (hits: Record<string, number>) =>
      calcMoves(dex, { set: atk, cond: defaultSide() }, { set: createSet(dex, 'garchomp', fmt), cond: defaultSide() }, defaultField(), [], hits);
    expect(go({ populationbomb: 10 })[0].forms[0].hits).toBe(10);
    expect(go({ populationbomb: 99 })[0].forms[0].hits).toBe(10);
    expect(go({ bulletseed: 5 })[1].forms[0].hits).toBe(5);
    expect(go({})[1].forms[0].hits).toBe(3);
    expect(hitRange(dex, 'populationbomb')).toEqual([1, 10]);
    expect(hitRange(dex, 'bulletseed')).toEqual([2, 5]);
    expect(hitRange(dex, 'dualwingbeat')).toBeNull();
  });
  it('Wide Lens raises Population Bomb damage', () => {
    const itemId = (n: string) => dex.item(n)?.id ?? '';
    if (!itemId('widelens')) return;
    expect(run('widelens')).toBeGreaterThan(run(''));
  });
});
