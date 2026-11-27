import { describe, expect, it } from 'vitest';
import { getFormat } from '../formats';
import { cloneTeam, createTeam, isDirty } from '../team';
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
const team = (sets: (PokemonSet | null)[]): Team => {
  const t = createTeam(fmt, 'Rain');
  return { ...t, slots: [...sets, ...Array(6).fill(null)].slice(0, 6) as Team['slots'] };
};

describe('isDirty', () => {
  const saved = team([set('pelipper'), set('basculegion'), set('kingambit')]);

  it('a fresh copy (new ids) is not dirty', () => {
    expect(isDirty(cloneTeam(saved, 'Untitled Team'), saved)).toBe(false);
  });

  it('a changed set, a reorder, a removed Pokémon and a new one are dirty', () => {
    const copy = () => cloneTeam(saved, 'Untitled Team');
    const edited = copy();
    edited.slots[0] = { ...edited.slots[0]!, itemId: 'focussash' };
    expect(isDirty(edited, saved)).toBe(true);
    const moved = copy();
    [moved.slots[0], moved.slots[1]] = [moved.slots[1], moved.slots[0]];
    expect(isDirty(moved, saved)).toBe(true);
    const removed = copy();
    removed.slots[2] = null;
    expect(isDirty(removed, saved)).toBe(true);
    const added = copy();
    added.slots[3] = set('incineroar');
    expect(isDirty(added, saved)).toBe(true);
  });

  it('notes and the format count; the name and timestamps do not', () => {
    const copy = cloneTeam(saved, 'Untitled Team');
    expect(isDirty({ ...copy, notes: 'Lead rain.' }, saved)).toBe(true);
    expect(isDirty({ ...copy, formatId: 'champions-vgc-reg-ma' }, saved)).toBe(true);
    expect(isDirty({ ...copy, name: 'Something else', updatedAt: 1, category: 'x' }, saved)).toBe(false);
  });

  it('key order and empty values do not matter', () => {
    const copy = cloneTeam(saved, 'Untitled Team');
    const first = copy.slots[0]!;
    copy.slots[0] = { uid: first.uid, moves: first.moves, speciesId: first.speciesId, nature: first.nature, level: first.level, sp: first.sp, evs: first.evs, ivs: first.ivs, itemId: undefined, nickname: undefined };
    expect(isDirty({ ...copy, notes: '' }, saved)).toBe(false);
  });

  it('matchup note leads compare by slot, not by id', () => {
    const a = team([set('pelipper'), set('basculegion')]);
    a.matchupNotes = [{ id: 'n1', title: 'Rain', text: 'x', leads: [a.slots[0]!.uid, a.slots[1]!.uid] }];
    const b = cloneTeam(a, 'Untitled Team');
    expect(isDirty(b, a)).toBe(false);
    b.matchupNotes = [{ ...b.matchupNotes![0], leads: [b.slots[1]!.uid] }];
    expect(isDirty(b, a)).toBe(true);
  });
});
