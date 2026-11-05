import { describe, expect, it } from 'vitest';
import data from '@/data/generated/champions.json';
import { Dex } from '@/data/dex';
import { DEFAULT_FORMAT_ID, getFormat } from '@/domain/formats';
import { DEFAULT_TEAM_NAME, createSet, createTeam, isHiddenDraft, suggestTeamNames } from '@/domain/team';
import type { Dataset, Team } from '@/domain/types';

const fmt = getFormat(DEFAULT_FORMAT_ID);
const dex = new Dex(data as unknown as Dataset);
const named = (id: string, name: string, extra: Partial<Team> = {}): Team => ({ ...createTeam(fmt, name), id, ...extra });

describe('isHiddenDraft', () => {
  it('hides the open unnamed scratch draft, even with Pokémon in it', () => {
    const slots = createTeam(fmt).slots;
    slots[0] = createSet(dex, 'charizard', fmt);
    const draft = named('d', DEFAULT_TEAM_NAME, { slots });
    expect(isHiddenDraft(draft, 'd')).toBe(true);
    expect(isHiddenDraft(draft, 'other')).toBe(false); // a build left behind is still reachable
  });
  it('hides an empty unnamed team anywhere, never a named one', () => {
    expect(isHiddenDraft(named('e', DEFAULT_TEAM_NAME), 'x')).toBe(true);
    expect(isHiddenDraft(named('n', 'Rain'), 'n')).toBe(false);
    expect(isHiddenDraft(named('v', DEFAULT_TEAM_NAME, { groupId: 'g' }), 'v')).toBe(false);
  });
});

describe('suggestTeamNames (the save dialog\'s suggestions)', () => {
  const teams = {
    a: named('a', 'Rain Offense'),
    b: named('b', 'Trick Room'),
    c: named('c', 'rain offense'),
    v: named('v', 'Rain Offense', { groupId: 'a' }),
    s: named('s', 'Shared', { shared: { owner: 'x', role: 'view' } as Team['shared'] }),
    d: named('d', DEFAULT_TEAM_NAME),
  };
  const order = ['d', 'a', 'b', 'c', 'v', 's'];
  it('lists every other saved team while the name is empty or still the default', () => {
    expect(suggestTeamNames(teams, order, 'd', '')).toEqual(['Rain Offense', 'Trick Room']);
    expect(suggestTeamNames(teams, order, 'd', DEFAULT_TEAM_NAME)).toEqual(['Rain Offense', 'Trick Room']);
  });
  it('narrows to names containing what was typed, and leaves out an exact match', () => {
    expect(suggestTeamNames(teams, order, 'd', 'rain')).toEqual(['Rain Offense']);
    expect(suggestTeamNames(teams, order, 'd', 'Rain Offense')).toEqual([]);
    expect(suggestTeamNames(teams, order, 'd', 'zzz')).toEqual([]);
  });
});
