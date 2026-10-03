import { describe, expect, it } from 'vitest';
import { compareDefense, compareOffense, speedSummary } from '../compare';
import type { DefenseRow, OffenseRow } from '../coverage';
import { sanitizeSet } from '../sanitize';
import type { SpeedRow } from '../speedTiers';
import { diffSets, diffTeams, familyOf, sameFamily, spreadText } from '../teamDiff';
import { cloneTeam, createTeam, emptySlots } from '../team';
import { getFormat } from '../formats';
import type { PokemonSet, Team, TeamSlots } from '../types';

const fmt = getFormat('champions-vgc-reg-mc');
const set = (speciesId: string, over: Partial<PokemonSet> = {}): PokemonSet => ({ ...sanitizeSet({ speciesId, moves: ['protect', 'tackle'] })!, ...over });
const team = (name: string, sets: (PokemonSet | null)[], over: Partial<Team> = {}): Team => {
  const slots = emptySlots();
  sets.forEach((s, i) => (slots[i] = s));
  return { ...createTeam(fmt, name), slots: slots as TeamSlots, ...over };
};

describe('diffSets', () => {
  it('reports nothing for identical sets, whatever the move order', () => {
    const a = set('garchomp', { moves: ['earthquake', 'protect', '', ''] });
    const b = { ...a, uid: 'other', moves: ['protect', 'earthquake', '', ''] as PokemonSet['moves'] };
    const d = diffSets(a, b);
    expect(d.changes).toEqual([]);
    expect(d.moves).toEqual({ onlyA: [], onlyB: [] });
  });

  it('lists each changed field with both values, and the moves only one side has', () => {
    const a = set('garchomp', { itemId: 'lifeorb', abilityId: 'roughskin', nature: 'Jolly', moves: ['earthquake', 'protect', 'rockslide', ''] });
    const b = set('garchomp', { itemId: 'yacheberry', abilityId: 'roughskin', nature: 'Adamant', moves: ['earthquake', 'protect', 'dragonclaw', ''] });
    const d = diffSets(a, b);
    expect(d.changes).toEqual([
      { field: 'item', a: 'lifeorb', b: 'yacheberry' },
      { field: 'nature', a: 'Jolly', b: 'Adamant' },
    ]);
    expect(d.moves).toEqual({ onlyA: ['rockslide'], onlyB: ['dragonclaw'] });
  });

  it('shows the Stat Point spread and which stats differ', () => {
    const a = set('garchomp', { sp: { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 } });
    const b = set('garchomp', { sp: { hp: 32, atk: 2, def: 0, spa: 0, spd: 0, spe: 32 } });
    const [c] = diffSets(a, b).changes;
    expect(c).toEqual({ field: 'sp', a: 'HP 2 · Atk 32 · Spe 32', b: 'HP 32 · Atk 2 · Spe 32', stats: ['hp', 'atk'] });
    expect(spreadText(set('x').sp)).toBe('none');
  });

  it('treats a missing item or ability as different from one that is set', () => {
    expect(diffSets(set('garchomp'), set('garchomp', { itemId: 'lifeorb' })).changes).toEqual([{ field: 'item', a: '', b: 'lifeorb' }]);
  });
});

describe('diffTeams', () => {
  it('pairs the same species even when the order differs, and counts same / changed', () => {
    const a = team('A', [set('garchomp'), set('rotom', { itemId: 'leftovers' }), set('pikachu')]);
    const b = team('B', [set('pikachu'), set('garchomp'), set('rotom', { itemId: 'sitrusberry' })]);
    const d = diffTeams(a, b);
    expect(d.counts).toEqual({ same: 2, changed: 1, 'only-a': 0, 'only-b': 0 });
    expect(d.pairs.map((p) => p.a?.speciesId)).toEqual(['garchomp', 'rotom', 'pikachu']);
    expect(d.pairs.find((p) => p.status === 'changed')!.changes).toEqual([{ field: 'item', a: 'leftovers', b: 'sitrusberry' }]);
  });

  it('a swapped Pokémon is one species change, not a removal plus an addition', () => {
    const a = team('A', [set('garchomp'), set('rotom')]);
    const b = team('B', [set('garchomp'), set('pikachu')]);
    const d = diffTeams(a, b);
    expect(d.counts).toEqual({ same: 1, changed: 1, 'only-a': 0, 'only-b': 0 });
    expect(d.pairs[1].changes[0]).toEqual({ field: 'species', a: 'rotom', b: 'pikachu' });
  });

  it('extra Pokémon on one side are only-a / only-b', () => {
    const d = diffTeams(team('A', [set('garchomp'), set('rotom'), set('pikachu')]), team('B', [set('garchomp')]));
    expect(d.counts).toEqual({ same: 1, changed: 0, 'only-a': 2, 'only-b': 0 });
    expect(d.pairs.filter((p) => p.status === 'only-a').map((p) => p.a?.speciesId)).toEqual(['rotom', 'pikachu']);
    const rev = diffTeams(team('B', [set('garchomp')]), team('A', [set('garchomp'), set('rotom')]));
    expect(rev.counts['only-b']).toBe(1);
  });

  it('two empty teams, and a team against itself', () => {
    expect(diffTeams(team('A', []), team('B', [])).pairs).toEqual([]);
    const t = team('A', [set('garchomp')]);
    expect(diffTeams(t, t).counts.changed).toBe(0);
  });

  it('pairs two copies of one species in order', () => {
    const a = team('A', [set('rotom', { nature: 'Timid' }), set('rotom', { nature: 'Modest' })]);
    const b = team('B', [set('rotom', { nature: 'Timid' }), set('rotom', { nature: 'Bold' })]);
    const d = diffTeams(a, b);
    expect(d.counts.same).toBe(1);
    expect(d.counts.changed).toBe(1);
  });

  it('knows variations of one folder (and that a team is not a variation of itself)', () => {
    const root = team('Rain', [set('garchomp')]);
    const v1 = cloneTeam(root, 'Rain', { groupId: root.id, variationLabel: 'vs Sun' });
    const v2 = cloneTeam(root, 'Rain', { groupId: root.id, variationLabel: 'vs Trick Room' });
    const other = team('Other', []);
    expect(familyOf(v1)).toBe(root.id);
    expect(diffTeams(root, v1).sameFamily).toBe(true);
    expect(diffTeams(v1, v2).sameFamily).toBe(true);
    expect(diffTeams(root, other).sameFamily).toBe(false);
    expect(sameFamily(root, root)).toBe(false);
  });

  it('flags teams of different formats', () => {
    const a = team('A', []);
    const b = team('B', [], { formatId: 'gen9vgc' });
    expect(diffTeams(a, b).differentFormat).toBe(true);
  });
});

describe('compare helpers', () => {
  const def = (atkType: string, weak: number, resist: number): DefenseRow => ({ atkType: atkType as never, mults: [], weak, resist, danger: false });
  const off = (defType: string, superEffective: number, walled: number): OffenseRow => ({ defType: defType as never, hits: [], superEffective, walled });

  it('lines the matrices up and marks the types where the teams differ', () => {
    const rows = compareDefense([def('Fire', 2, 0), def('Water', 1, 1)], [def('Fire', 2, 0), def('Water', 0, 3)]);
    expect(rows.map((r) => [r.type, r.differs])).toEqual([['Fire', false], ['Water', true]]);
    expect(rows[1]).toMatchObject({ a: { good: 1, bad: 1 }, b: { good: 3, bad: 0 } });
    const o = compareOffense([off('Fire', 3, 0)], [off('Fire', 1, 2)]);
    expect(o[0]).toMatchObject({ differs: true, a: { good: 3, bad: 0 }, b: { good: 1, bad: 2 } });
  });

  it('summarises Speed: fastest forme per member, how many meta Speeds it beats (ties do not count)', () => {
    const row = (key: string, speed: number, mine: boolean, slot?: number, forme: 'base' | 'mega' = 'base'): SpeedRow => ({ key, speciesId: key, formeId: key, name: key, forme, speed, mine, slot, label: '', scarf: false, tie: false });
    const ladder = [row('m1', 100, false), row('m2', 150, false), row('m3', 150, false), row('m4', 200, false), row('a', 150, true, 0), row('b', 120, true, 1), row('b', 180, true, 1, 'mega')];
    const lines = speedSummary(ladder);
    expect(lines.map((l) => [l.name, l.speed, l.outspeeds, l.total, l.mega])).toEqual([
      ['b', 180, 3, 4, true],
      ['a', 150, 1, 4, false],
    ]);
  });
});
