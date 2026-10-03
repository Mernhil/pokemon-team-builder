import { beforeEach, describe, expect, it } from 'vitest';
import { getFormat } from '@/domain/formats';
import { sanitizeSet, sanitizeTeam } from '@/domain/sanitize';
import { cloneTeam, createTeam } from '@/domain/team';
import type { SharedMark } from '@/domain/types';
import { storeAdapter } from '@/sync/runner';
import { isReadOnly, mergeTeamState, useTeamStore } from '../teamStore';

const fmt = getFormat('champions-vgc-reg-mc');
const mark = (role: 'view' | 'edit', folderId: string): SharedMark => ({ owner: 'ash@example.com', ownerName: 'Ash', folderId, role });

function world(role: 'view' | 'edit') {
  const mine = createTeam(fmt, 'Mine');
  const root = { ...createTeam(fmt, 'Ash Rain'), shared: undefined as SharedMark | undefined };
  root.slots = [sanitizeSet({ speciesId: 'garchomp', moves: ['earthquake'] }), sanitizeSet({ speciesId: 'rotom' }), null, null, null, null];
  root.shared = mark(role, root.id);
  const variation = { ...cloneTeam(root, 'Ash Rain', { groupId: root.id, variationLabel: 'vs Sun', shared: root.shared }) };
  useTeamStore.setState({
    teams: { [mine.id]: mine, [root.id]: root, [variation.id]: variation },
    order: [mine.id, root.id],
    activeTeamId: root.id,
    activeSlot: 0,
    battle: {},
  });
  return { mine, root, variation };
}
const snapshot = () => JSON.stringify(useTeamStore.getState().teams);

describe('a view-only shared team is read-only in the store itself', () => {
  beforeEach(() => void 0);

  it('refuses every edit: slots, sets, moves, spreads, name, format, delete, variations', () => {
    const { root, variation } = world('view');
    const s = useTeamStore.getState();
    const before = snapshot();
    expect(isReadOnly(s.teams[root.id])).toBe(true);

    s.setSlot(root.id, 0, null);
    s.setSlot(root.id, 2, sanitizeSet({ speciesId: 'pikachu' }));
    s.updateSet(root.id, 0, { nature: 'Jolly' });
    s.setMove(root.id, 0, 0, 'protect');
    s.setSpread(root.id, 0, 'sp', 'spe', 32);
    s.resetSpread(root.id, 0, 'sp');
    s.moveSlot(root.id, 0, 1);
    s.clearTeam(root.id);
    s.restoreSlots(root.id, s.teams[root.id].slots);
    s.updateTeam(root.id, { name: 'Hacked', notes: 'x' });
    s.updateTeam(variation.id, { variationLabel: 'Hacked' });
    s.switchFormat(root.id, 'champions-vgc-reg-mb');
    s.deleteTeam(root.id);
    s.deleteTeam(variation.id);
    expect(s.addVariation(root.id)).toBe(root.id);
    expect(snapshot()).toBe(before);
    expect(Object.keys(useTeamStore.getState().teams)).toHaveLength(3);
  });

  it('still lets me look: select, active slot, and my own teams edit normally', () => {
    const { mine, root } = world('view');
    useTeamStore.getState().selectTeam(root.id);
    expect(useTeamStore.getState().activeTeamId).toBe(root.id);
    useTeamStore.getState().setActiveSlot(2);
    expect(useTeamStore.getState().activeSlot).toBe(2);
    useTeamStore.getState().updateTeam(mine.id, { name: 'Renamed' });
    expect(useTeamStore.getState().teams[mine.id].name).toBe('Renamed');
  });

  it('"Make my own copy" gives me an editable, unlinked copy of the whole folder', () => {
    const { root, variation } = world('view');
    const id = useTeamStore.getState().makeOwnCopy(variation.id);
    const s = useTeamStore.getState();
    const copy = s.teams[id];
    expect(copy.shared).toBeUndefined();
    expect(copy.name).toBe('Ash Rain');
    const copyRoot = s.teams[copy.groupId!];
    expect(copyRoot.shared).toBeUndefined();
    expect(copyRoot.id).not.toBe(root.id);
    expect(s.activeTeamId).toBe(id);
    expect(s.order).toContain(copyRoot.id);
    // The original is untouched and the copy can be edited.
    expect(s.teams[root.id].shared?.role).toBe('view');
    useTeamStore.getState().updateTeam(id, { name: 'Mine now' });
    expect(useTeamStore.getState().teams[id].name).toBe('Mine now');
    // …and it is a different set of ids, so editing it can't touch the shared team.
    expect(Object.values(s.teams).filter((t) => t.shared).map((t) => t.id).sort()).toEqual([root.id, variation.id].sort());
  });

  it('copying something that is not shared does nothing', () => {
    const { mine } = world('view');
    expect(useTeamStore.getState().makeOwnCopy(mine.id)).toBe(mine.id);
    expect(Object.keys(useTeamStore.getState().teams)).toHaveLength(3);
  });
});

describe('an editable shared team', () => {
  it('can be edited, and a new variation of it stays in its folder', () => {
    const { root } = world('edit');
    useTeamStore.getState().updateTeam(root.id, { notes: 'edited' });
    expect(useTeamStore.getState().teams[root.id].notes).toBe('edited');
    const id = useTeamStore.getState().addVariation(root.id);
    const v = useTeamStore.getState().teams[id];
    expect(v.groupId).toBe(root.id);
    expect(v.shared).toEqual(root.shared);
  });

  it('cannot delete the shared team itself, but can delete a variation', () => {
    const { root, variation } = world('edit');
    useTeamStore.getState().deleteTeam(root.id);
    expect(useTeamStore.getState().teams[root.id]).toBeDefined();
    useTeamStore.getState().deleteTeam(variation.id);
    expect(useTeamStore.getState().teams[variation.id]).toBeUndefined();
  });

  it('a duplicate or "save as" is mine, never part of the folder', () => {
    const { root } = world('edit');
    const id = useTeamStore.getState().duplicateTeam(root.id);
    expect(useTeamStore.getState().teams[id].shared).toBeUndefined();
    expect(useTeamStore.getState().teams[id].groupId).toBeUndefined();
  });
});

describe('where the shared mark lives', () => {
  it('survives a reload (the persisted state), but is not part of the team the server or a backup sees', () => {
    const { root } = world('view');
    const persisted = { teams: useTeamStore.getState().teams, order: useTeamStore.getState().order, activeTeamId: root.id };
    const merged = mergeTeamState(JSON.parse(JSON.stringify(persisted)), useTeamStore.getState());
    expect(merged.teams[root.id].shared).toEqual(root.shared);
    // The sync sanitiser (shared by the Worker) drops it.
    expect(sanitizeTeam(JSON.parse(JSON.stringify(root)))!.shared).toBeUndefined();
  });

  it('a malformed mark is dropped on load rather than trusted', () => {
    const { root } = world('view');
    const bad = JSON.parse(JSON.stringify({ teams: { [root.id]: { ...root, shared: { owner: 'x', folderId: '../../etc', role: 'admin' } } }, order: [root.id], activeTeamId: root.id }));
    expect(mergeTeamState(bad, useTeamStore.getState()).teams[root.id].shared).toBeUndefined();
  });

  it("is never sent as one of my own documents (the sync adapter leaves shared teams out)", () => {
    const { mine, root, variation } = world('edit');
    const ids = storeAdapter.list().filter((d) => d.kind === 'team').map((d) => d.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(root.id);
    expect(ids).not.toContain(variation.id);
  });
});
