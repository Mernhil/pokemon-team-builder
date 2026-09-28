import { describe, expect, it } from 'vitest';
import { DEFAULT_FORMAT_ID, getFormat } from '@/domain/formats';
import data from '@/data/generated/champions.json';
import { Dex } from '@/data/dex';
import { createSet, createTeam } from '@/domain/team';
import type { Dataset, Team } from '@/domain/types';
import { defaultSlotBattle, mergeTeamState, migrateTeamState, useTeamStore } from '../teamStore';

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
  it('commits the active build as a new, distinct top-level entry and activates it', () => {
    const baseId = resetStore();
    const newId = useTeamStore.getState().saveAsNew('My Rain Team');

    expect(newId).not.toBe(baseId);
    const state = useTeamStore.getState();
    expect(state.teams[newId].name).toBe('My Rain Team');
    expect(state.teams[newId].groupId).toBeUndefined();
    expect(state.order).toContain(newId);
    expect(state.activeTeamId).toBe(newId);
    // The original entry is left untouched, not overwritten.
    expect(state.teams[baseId].name).toBe('Base Team');
  });

  it('falls back to the source name when given a blank name', () => {
    resetStore();
    const newId = useTeamStore.getState().saveAsNew('   ');
    expect(useTeamStore.getState().teams[newId].name).toBe('Base Team');
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
    // Clicking "Add variation" also loads the new copy into the builder.
    expect(state.activeTeamId).toBe(varId);
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
  it('migrate is an identity pass — normalisation happens in merge', () => {
    const flat = { teams: { a: { id: 'a' } }, order: ['a'] };
    expect(migrateTeamState(flat, 1)).toBe(flat);
  });

  it('merge treats a flat v1 team (no groupId) as a top-level group with no variations', () => {
    const t = createTeam(fmt, 'Legacy Team');
    const current = useTeamStore.getState();
    const merged = mergeTeamState({ teams: { [t.id]: t }, order: [t.id], activeTeamId: t.id }, current);

    expect(merged.teams[t.id].groupId).toBeUndefined();
    expect(merged.order).toEqual([t.id]);
    expect(merged.activeTeamId).toBe(t.id);
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

    expect(merged.order).toEqual([group.id]);
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
