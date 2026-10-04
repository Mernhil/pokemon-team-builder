import { describe, expect, it } from 'vitest';
import { DEFAULT_FORMAT_ID, getFormat } from '@/domain/formats';
import data from '@/data/generated/champions.json';
import { Dex } from '@/data/dex';
import { DEFAULT_TEAM_NAME, createSet, createTeam, isSavedTeam } from '@/domain/team';
import type { Dataset, Team } from '@/domain/types';
import { defaultSlotBattle, findTeamByName, mergeTeamState, migrateTeamState, useTeamStore } from '../teamStore';

const fmt = getFormat(DEFAULT_FORMAT_ID);
const dex = new Dex(data as unknown as Dataset);

/** Reset the store to a single, known top-level team before each test. */
function resetStore() {
  const t = createTeam(fmt, 'Base Team');
  useTeamStore.setState({
    teams: { [t.id]: t },
    order: [t.id],
    activeTeamId: t.id,
    activeSlot: 0,
    battle: {},
  });
  return t.id;
}

describe('teamStore: saveAsNew', () => {
  it('commits a copy of the build as a new, distinct top-level entry and leaves the build open', () => {
    const baseId = resetStore();
    const newId = useTeamStore.getState().saveAsNew('My Rain Team');

    expect(newId).not.toBe(baseId);
    const state = useTeamStore.getState();
    expect(state.teams[newId].name).toBe('My Rain Team');
    expect(state.teams[newId].groupId).toBeUndefined();
    expect(state.order).toContain(newId);
    expect(state.activeTeamId).toBe(baseId);
    expect(state.editingFrom).toBe(newId);
    // The original entry is left untouched, not overwritten.
    expect(state.teams[baseId].name).toBe('Base Team');
  });

  it('falls back to the source name when given a blank name', () => {
    resetStore();
    const newId = useTeamStore.getState().saveAsNew('   ');
    expect(useTeamStore.getState().teams[newId].name).toBe('Base Team');
  });
});

describe('isSavedTeam', () => {
  it('is false only for the unnamed scratch draft', () => {
    const base = { name: DEFAULT_TEAM_NAME, groupId: undefined, shared: undefined };
    expect(isSavedTeam(base)).toBe(false);
    expect(isSavedTeam({ ...base, name: 'Rain' })).toBe(true);
    expect(isSavedTeam({ ...base, groupId: 'g' })).toBe(true);
  });
});

describe('teamStore: clearTeam', () => {
  it('empties a team\'s slots but keeps its format, name and id', () => {
    const id = resetStore();
    const set = createSet(dex, 'charizard', fmt);
    useTeamStore.getState().setSlot(id, 0, set);

    useTeamStore.getState().clearTeam(id);

    const state = useTeamStore.getState();
    expect(state.teams[id].slots).toEqual([null, null, null, null, null, null]);
    expect(state.teams[id].formatId).toBe(fmt.id);
    expect(state.teams[id].name).toBe('Base Team');
    expect(state.activeTeamId).toBe(id);
  });

  it('does not touch other saved teams, order, or battle state', () => {
    const id = resetStore();
    const set = createSet(dex, 'charizard', fmt);
    useTeamStore.getState().setSlot(id, 0, set);
    const otherId = useTeamStore.getState().saveAsNew('Other Team');
    // Reactivate the original team as the one being built.
    useTeamStore.getState().selectTeam(id);
    const before = useTeamStore.getState().teams[otherId];

    useTeamStore.getState().clearTeam(id);

    const state = useTeamStore.getState();
    expect(state.teams[otherId]).toBe(before);
    expect(state.order).toContain(otherId);
    expect(state.order).toContain(id);
  });

  it('is a no-op on an already-empty team', () => {
    const id = resetStore();
    const before = useTeamStore.getState().teams[id];

    useTeamStore.getState().clearTeam(id);

    expect(useTeamStore.getState().teams[id]).toBe(before);
  });
});

describe('teamStore: variations', () => {
  it('addVariation nests a copy under the same group instead of creating a top-level entry', () => {
    const groupId = resetStore();
    const varId = useTeamStore.getState().addVariation(groupId);

    const state = useTeamStore.getState();
    expect(state.teams[varId].groupId).toBe(groupId);
    expect(state.teams[varId].variationLabel).toBeTruthy();
    // Variations never appear in the top-level `order` list.
    expect(state.order).not.toContain(varId);
    expect(state.order).toContain(groupId);
    // Clicking "Add variation" also loads the new copy into the builder's draft; the variation itself stays as saved.
    expect(state.editingFrom).toBe(varId);
    expect(state.activeTeamId).not.toBe(varId);
    expect(isSavedTeam(state.teams[state.activeTeamId])).toBe(false);
  });

  it('adding a variation from an existing variation nests under the shared parent group', () => {
    const groupId = resetStore();
    const var1 = useTeamStore.getState().addVariation(groupId);
    const var2 = useTeamStore.getState().addVariation(var1);

    const state = useTeamStore.getState();
    expect(state.teams[var2].groupId).toBe(groupId);
    expect(state.teams[var1].groupId).toBe(groupId);
  });

  it('gives each variation its own label and updatedAt', async () => {
    const groupId = resetStore();
    const var1 = useTeamStore.getState().addVariation(groupId);
    await new Promise((r) => setTimeout(r, 2));
    const var2 = useTeamStore.getState().addVariation(groupId);

    const state = useTeamStore.getState();
    expect(state.teams[var1].variationLabel).not.toBe(state.teams[var2].variationLabel);
    expect(state.teams[var2].updatedAt).toBeGreaterThanOrEqual(state.teams[var1].updatedAt);
  });

  it('deleting a single variation leaves the group and its other variations intact', () => {
    const groupId = resetStore();
    const var1 = useTeamStore.getState().addVariation(groupId);
    const var2 = useTeamStore.getState().addVariation(groupId);

    useTeamStore.getState().deleteTeam(var1);

    const state = useTeamStore.getState();
    expect(state.teams[var1]).toBeUndefined();
    expect(state.teams[var2]).toBeDefined();
    expect(state.teams[groupId]).toBeDefined();
    expect(state.order).toContain(groupId);
  });

  it('deleting a group removes all of its variations', () => {
    const groupId = resetStore();
    const var1 = useTeamStore.getState().addVariation(groupId);
    const var2 = useTeamStore.getState().addVariation(groupId);

    useTeamStore.getState().deleteTeam(groupId);

    const state = useTeamStore.getState();
    expect(state.teams[groupId]).toBeUndefined();
    expect(state.teams[var1]).toBeUndefined();
    expect(state.teams[var2]).toBeUndefined();
    expect(state.order).not.toContain(groupId);
  });

  it('duplicateTeam always produces a new top-level group, even from a variation', () => {
    const groupId = resetStore();
    const varId = useTeamStore.getState().addVariation(groupId);

    const dupId = useTeamStore.getState().duplicateTeam(varId);

    const state = useTeamStore.getState();
    expect(state.teams[dupId].groupId).toBeUndefined();
    expect(state.order).toContain(dupId);
  });
});

describe('teamStore: addTeams (JSON backup restore)', () => {
  it('remaps groupId references when an id collides with an existing team', () => {
    const groupId = resetStore();
    const group = useTeamStore.getState().teams[groupId];
    const variation: Team = { ...createTeam(fmt, 'Imported Variation'), id: `${groupId}-var`, groupId };

    // Re-import the exact same group id (as a JSON backup restore would if re-importing a
    // previously-exported file) alongside its variation.
    useTeamStore.getState().addTeams([{ ...group }, variation], false);

    const state = useTeamStore.getState();
    const newGroupIds = state.order.filter((id) => id !== groupId);
    expect(newGroupIds).toHaveLength(1);
    const newGroupId = newGroupIds[0];
    const newVariation = Object.values(state.teams).find((t) => t.groupId === newGroupId);
    expect(newVariation).toBeDefined();
    expect(newVariation!.name).toBe('Imported Variation');
  });

  it('promotes a variation with a missing parent to a top-level group', () => {
    resetStore();
    const orphan: Team = { ...createTeam(fmt, 'Orphan Variation'), groupId: 'does-not-exist' };

    useTeamStore.getState().addTeams([orphan], false);

    const state = useTeamStore.getState();
    expect(state.teams[orphan.id].groupId).toBeUndefined();
    expect(state.order).toContain(orphan.id);
  });

  it('keeps intra-batch group + variation relationships intact', () => {
    resetStore();
    const group = createTeam(fmt, 'Imported Group');
    const variation: Team = { ...createTeam(fmt, 'Imported Variation'), groupId: group.id };

    useTeamStore.getState().addTeams([group, variation], false);

    const state = useTeamStore.getState();
    expect(state.teams[variation.id].groupId).toBe(group.id);
    expect(state.order).toContain(group.id);
    expect(state.order).not.toContain(variation.id);
  });
});

describe('persist migration (v1 flat teams -> v2 grouped teams)', () => {
  it('migrate from the current version is an identity pass — normalisation happens in merge', () => {
    const flat = { teams: { a: { id: 'a' } }, order: ['a'] };
    expect(migrateTeamState(flat, 3)).toBe(flat);
  });

  it('migrate leaves teams it cannot recognise for merge to handle', () => {
    const flat = { teams: { a: { id: 'a' } }, order: ['a'] };
    expect(migrateTeamState(flat, 1).teams).toEqual(flat.teams);
  });

  it('merge treats a flat v1 team (no groupId) as a top-level group with no variations', () => {
    const t = createTeam(fmt, 'Legacy Team');
    const current = useTeamStore.getState();
    const merged = mergeTeamState({ teams: { [t.id]: t }, order: [t.id], activeTeamId: t.id }, current);

    expect(merged.teams[t.id].groupId).toBeUndefined();
    // A saved team left open by an older version is kept as it is; the builder gets a draft copy of it.
    expect(merged.order).toContain(t.id);
    expect(merged.activeTeamId).not.toBe(t.id);
    expect(merged.editingFrom).toBe(t.id);
    expect(merged.teams[merged.activeTeamId].name).toBe(DEFAULT_TEAM_NAME);
  });

  it('merge drops a variation whose parent group did not survive sanitising, promoting it to top-level', () => {
    const orphan: Team = { ...createTeam(fmt, 'Dangling'), groupId: 'ghost-parent' };
    const current = useTeamStore.getState();
    const merged = mergeTeamState({ teams: { [orphan.id]: orphan }, order: [] }, current);

    expect(merged.teams[orphan.id].groupId).toBeUndefined();
    expect(merged.order).toContain(orphan.id);
  });

  it('merge keeps battle state only for sets that still exist', () => {
    const t = createTeam(fmt, 'With Battle');
    const set = createSet(dex, 'garchomp', fmt);
    t.slots[0] = set;
    const live = defaultSlotBattle(false);
    const current = useTeamStore.getState();
    const merged = mergeTeamState(
      { teams: { [t.id]: t }, order: [t.id], battle: { [set.uid]: live, 'deleted-set': live, [t.id]: 'junk' } },
      current,
    );

    expect(Object.keys(merged.battle)).toEqual([set.uid]);
  });

  it('merge keeps a valid group/variation pair and excludes the variation from order', () => {
    const group = createTeam(fmt, 'Group');
    const variation: Team = { ...createTeam(fmt, 'Variation'), groupId: group.id };
    const current = useTeamStore.getState();
    const merged = mergeTeamState({ teams: { [group.id]: group, [variation.id]: variation }, order: [group.id, variation.id] }, current);

    expect(merged.order.filter((id) => id !== merged.activeTeamId)).toEqual([group.id]); // plus the builder's draft
    expect(merged.teams[variation.id].groupId).toBe(group.id);
  });

  it('merge falls back to `current` when nothing valid was persisted', () => {
    const current = useTeamStore.getState();
    expect(mergeTeamState({}, current)).toBe(current);
    expect(mergeTeamState(null, current)).toBe(current);
  });
});

describe('teamStore: updateTeam', () => {
  it('renames a variation via its variationLabel independently of the group name', () => {
    const groupId = resetStore();
    const varId = useTeamStore.getState().addVariation(groupId);

    useTeamStore.getState().updateTeam(varId, { variationLabel: 'vs Rain teams' });

    const state = useTeamStore.getState();
    expect(state.teams[varId].variationLabel).toBe('vs Rain teams');
    expect(state.teams[groupId].name).toBe('Base Team');
  });
});

describe('teamStore: saveTeam with a name that is taken', () => {
  const setup = () => {
    const draft = resetStore();
    const s = () => useTeamStore.getState();
    s().setSlot(draft, 0, createSet(dex, 'charizard', fmt));
    const rainId = s().saveAsNew('Rain');
    s().selectTeam(draft);
    s().setSlot(draft, 0, createSet(dex, 'blastoise', fmt));
    return { draft, rainId, s };
  };

  it('finds the clash by name, ignoring case and the open team itself', () => {
    const { draft, rainId, s } = setup();
    expect(findTeamByName(s(), ' rain ')?.id).toBe(rainId);
    expect(findTeamByName(s(), 'Sun')).toBeUndefined();
    s().updateTeam(draft, { name: 'Sun' });
    expect(findTeamByName(s(), 'sun')).toBeUndefined(); // the open team is not a clash with itself
  });

  it('overwrite replaces the roster of the existing team, keeping its id, name and folder', () => {
    const { draft, rainId, s } = setup();
    const id = s().saveTeam('Rain', 'overwrite', rainId);
    expect(id).toBe(rainId);
    const rain = s().teams[rainId];
    expect(rain.name).toBe('Rain');
    expect(rain.slots[0]?.speciesId).toBe('blastoise');
    expect(s().activeTeamId).toBe(draft);
    expect(s().editingFrom).toBe(rainId);
    expect(Object.values(s().teams).filter((t) => t.name === 'Rain')).toHaveLength(1);
    expect(s().teams[draft].slots[0]?.speciesId).toBe('blastoise'); // the scratch draft is untouched
  });

  it('variation adds the build to the existing team\'s folder and leaves the original alone', () => {
    const { rainId, s } = setup();
    const id = s().saveTeam('Rain', 'variation', rainId);
    const v = s().teams[id];
    expect(v.groupId).toBe(rainId);
    expect(v.variationLabel).toBeTruthy();
    expect(v.slots[0]?.speciesId).toBe('blastoise');
    expect(s().teams[rainId].slots[0]?.speciesId).toBe('charizard');
    expect(s().order).not.toContain(id);
    expect(s().activeTeamId).not.toBe(id);
    expect(s().editingFrom).toBe(id);
  });

  it('saving the open, already-saved team under its own name does not duplicate it', () => {
    const { rainId, s } = setup();
    s().selectTeam(rainId);
    const before = Object.keys(s().teams).length;
    expect(s().saveTeam('Rain', 'new')).toBe(rainId);
    expect(Object.keys(s().teams)).toHaveLength(before);
  });

  it('with no clash it saves a new team', () => {
    const { s } = setup();
    const id = s().saveTeam('Sun', 'new');
    expect(s().teams[id].name).toBe('Sun');
    expect(s().order).toContain(id);
  });
});

describe('teamStore: editing a saved team', () => {
  const s = () => useTeamStore.getState();

  it('Edit team loads a copy into the scratch draft; changing it leaves the saved team alone', () => {
    const draft = resetStore();
    s().updateTeam(draft, { name: DEFAULT_TEAM_NAME });
    s().setSlot(draft, 0, createSet(dex, 'charizard', fmt));
    const rainId = s().saveAsNew('Rain');

    s().setSlot(draft, 0, createSet(dex, 'blastoise', fmt)); // keep building after saving
    expect(s().teams[rainId].slots[0]?.speciesId).toBe('charizard');

    const open = s().editTeam(rainId);
    expect(open).toBe(draft); // the scratch draft is reused
    expect(s().editingFrom).toBe(rainId);
    expect(s().teams[draft].slots[0]?.speciesId).toBe('charizard');
    expect(s().teams[draft].slots[0]?.uid).not.toBe(s().teams[rainId].slots[0]?.uid);

    s().setSlot(draft, 0, createSet(dex, 'venusaur', fmt));
    expect(s().teams[rainId].slots[0]?.speciesId).toBe('charizard');

    s().saveTeam('Rain', 'overwrite', rainId);
    expect(s().teams[rainId].slots[0]?.speciesId).toBe('venusaur');
  });

  it('starts a new draft when the open team is itself saved', () => {
    const base = resetStore(); // "Base Team" is a saved team
    const other = s().saveAsNew('Other');
    const open = s().editTeam(other);
    expect(open).not.toBe(base);
    expect(s().activeTeamId).toBe(open);
    expect(isSavedTeam(s().teams[open])).toBe(false);
    expect(s().teams[base].name).toBe('Base Team');
  });
});
