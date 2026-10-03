import { describe, expect, it } from 'vitest';
import { getFormat } from '../formats';
import { compareTeams, diffSets, folderOf, teamChoices } from '../teamCompare';
import { cloneTeam, createTeam } from '../team';
import type { PokemonSet, Team } from '../types';
import { emptyStats } from '../types';

const fmt = getFormat('champions-vgc-reg-mc');
const set = (speciesId: string, over: Partial<PokemonSet> = {}): PokemonSet => ({
  uid: `u-${speciesId}-${Math.random()}`,
  speciesId,
  nature: 'Adamant',
  moves: ['tackle', '', '', ''],
  level: 50,
  sp: emptyStats(0),
  evs: emptyStats(0),
  ivs: emptyStats(31),
  ...over,
});
const team = (name: string, sets: (PokemonSet | null)[]): Team => {
  const t = createTeam(fmt, name);
  return { ...t, slots: [...sets, ...Array(6).fill(null)].slice(0, 6) as Team['slots'] };
};

describe('diffSets', () => {
  it('reports each field that differs, and nothing for equal sets', () => {
    const a = set('garchomp', { itemId: 'lifeorb', abilityId: 'roughskin', moves: ['earthquake', 'dragonclaw', 'protect', ''], sp: { ...emptyStats(0), atk: 32, spe: 32 } });
    expect(diffSets(a, { ...a })).toEqual([]);
    const b = { ...a, itemId: 'choicescarf', nature: 'Jolly', moves: ['earthquake', 'rockslide', 'protect', ''] as PokemonSet['moves'], sp: { ...emptyStats(0), atk: 30, spe: 32, hp: 4 } };
    const changes = diffSets(a, b);
    expect(changes.map((c) => c.field)).toEqual(['item', 'nature', 'moves', 'spread']);
    expect(changes.find((c) => c.field === 'item')).toMatchObject({ a: 'lifeorb', b: 'choicescarf' });
    expect(changes.find((c) => c.field === 'moves')).toMatchObject({ movesOnlyA: ['dragonclaw'], movesOnlyB: ['rockslide'] });
    expect(changes.find((c) => c.field === 'spread')).toMatchObject({ a: '32 Atk / 32 Spe', b: '4 HP / 30 Atk / 32 Spe' });
  });

  it('ignores move order', () => {
    const a = set('garchomp', { moves: ['earthquake', 'protect', '', ''] });
    expect(diffSets(a, { ...a, moves: ['protect', 'earthquake', '', ''] })).toEqual([]);
  });

  it('compares EVs and IVs in EV formats, not Stat Points', () => {
    const a = set('garchomp', { sp: emptyStats(0), evs: { ...emptyStats(0), atk: 252 } });
    const b = { ...a, sp: { ...emptyStats(0), atk: 32 }, evs: { ...emptyStats(0), atk: 252 }, ivs: { ...emptyStats(31), spe: 0 } };
    expect(diffSets(a, b, 'other').map((c) => c.field)).toEqual(['ivs']);
    expect(diffSets(a, b, 'champions-sp').map((c) => c.field)).toEqual(['spread']);
  });
});

describe('compareTeams', () => {
  it('pairs by species, keeps A’s order, and lists the unpaired of B last', () => {
    const a = team('A', [set('garchomp'), set('incineroar'), set('kingambit')]);
    const b = team('B', [set('flutter-mane'), set('incineroar', { itemId: 'sitrusberry' }), set('garchomp')]);
    const d = compareTeams(a, b);
    expect(d.sets.map((s) => [s.speciesId, s.status])).toEqual([
      ['garchomp', 'same'],
      ['incineroar', 'changed'],
      ['kingambit', 'only-a'],
      ['flutter-mane', 'only-b'],
    ]);
    expect(d.counts).toEqual({ same: 1, changed: 1, onlyA: 1, onlyB: 1 });
    expect(d.identical).toBe(false);
    expect(d.sameFolder).toBe(false);
  });

  it('two copies of a species on one team pair one to one', () => {
    const a = team('A', [set('pikachu'), set('pikachu', { itemId: 'lightball' })]);
    const b = team('B', [set('pikachu')]);
    expect(compareTeams(a, b).counts).toMatchObject({ onlyA: 1 });
  });

  it('is identical for the same sets, and flags variations of one folder', () => {
    const root = team('Rain', [set('pelipper')]);
    const v = cloneTeam(root, 'Rain', { groupId: root.id, variationLabel: 'vs Sun' });
    v.slots[0] = { ...v.slots[0]!, itemId: 'dampock' };
    const d = compareTeams(root, v);
    expect(d.sameFolder).toBe(true);
    expect(d.identical).toBe(false);
    const w = cloneTeam(root, 'Rain', { groupId: root.id, variationLabel: 'other' });
    expect(compareTeams(v, w).sameFolder).toBe(true); // two variations
    expect(compareTeams(root, { ...root }).sameFolder).toBe(false); // a team is not a variation of itself
    expect(folderOf(v)).toBe(root.id);
  });

  it('an empty comparison is not "identical"', () => {
    expect(compareTeams(team('A', []), team('B', [])).identical).toBe(false);
  });
});

describe('teamChoices', () => {
  it('lists mine first (variations under their team), then those shared with me', () => {
    const rain = team('Rain', [set('pelipper')]);
    const sun = { ...cloneTeam(rain, 'Rain', { groupId: rain.id, variationLabel: 'vs Sun' }) };
    const theirs: Team = { ...team('Theirs', [set('garchomp')]), shared: { owner: 'a@b.c', role: 'view' } };
    const teams = { [rain.id]: rain, [sun.id]: sun, [theirs.id]: theirs };
    const c = teamChoices(teams, [theirs.id, rain.id]);
    expect(c.map((x) => x.label)).toEqual(['Rain', 'Rain · vs Sun', 'Theirs (shared)']);
    expect(c.map((x) => x.group)).toEqual(['mine', 'mine', 'shared']);
  });
});
