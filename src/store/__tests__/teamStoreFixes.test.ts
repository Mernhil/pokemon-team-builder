import { describe, expect, it } from 'vitest';
import { DEFAULT_FORMAT_ID, getFormat } from '@/domain/formats';
import { DEFAULT_TEAM_NAME, createTeam } from '@/domain/team';
import type { Team } from '@/domain/types';
import { editingTeam, mergeTeamState, useTeamStore } from '../teamStore';

const fmt = getFormat(DEFAULT_FORMAT_ID);
const named = (name: string, over: Partial<Team> = {}): Team => ({ ...createTeam(fmt, name), ...over });

function setup(teams: Team[], activeTeamId = teams[0].id) {
  useTeamStore.setState({
    teams: Object.fromEntries(teams.map((t) => [t.id, t])),
    order: teams.filter((t) => !t.groupId).map((t) => t.id),
    activeTeamId,
    activeSlot: 0,
    editingFrom: null,
    editingDraft: null,
    battle: {},
  });
}

describe('Edit team link survives a reload', () => {
  it('persists editingDraft next to editingFrom', () => {
    const saved = named('Rain');
    setup([saved]);
    const draftId = useTeamStore.getState().editTeam(saved.id);
    const state = useTeamStore.getState();
    const persisted = useTeamStore.persist.getOptions().partialize!(state) as Record<string, unknown>;
    expect(persisted.editingFrom).toBe(saved.id);
    expect(persisted.editingDraft).toBe(draftId);

    const reloaded = mergeTeamState(JSON.parse(JSON.stringify(persisted)), state);
    expect(reloaded.activeTeamId).toBe(draftId);
    expect(editingTeam(reloaded)?.id).toBe(saved.id);
  });

  it('drops a link whose draft is gone', () => {
    const saved = named('Rain');
    const draft = named(DEFAULT_TEAM_NAME);
    const loaded = mergeTeamState({ teams: { [saved.id]: saved, [draft.id]: draft }, order: [saved.id, draft.id], activeTeamId: draft.id, editingFrom: saved.id, editingDraft: 'gone' }, useTeamStore.getState());
    expect(editingTeam(loaded)).toBeUndefined();
  });
});

describe('variation labels', () => {
  it('never repeats a label after one was deleted', () => {
    const root = named('Folder');
    setup([root]);
    const s = () => useTeamStore.getState();
    const v2 = s().addVariation(root.id);
    const v3 = s().addVariation(root.id);
    expect([s().teams[v2].variationLabel, s().teams[v3].variationLabel]).toEqual(['Variation 2', 'Variation 3']);
    s().deleteTeam(v2);
    const v4 = s().addVariation(root.id);
    expect(s().teams[v4].variationLabel).toBe('Variation 4');
  });
});

describe('variation parents are always top-level', () => {
  const chain = () => {
    const root = named('Root');
    const mid = named('Mid', { groupId: root.id, variationLabel: 'Variation 2' });
    const leaf = named('Leaf', { groupId: mid.id, variationLabel: 'Variation 3' });
    return { root, mid, leaf };
  };

  it('on load', () => {
    const { root, mid, leaf } = chain();
    const out = mergeTeamState({ teams: { [root.id]: root, [mid.id]: mid, [leaf.id]: leaf }, order: [root.id], activeTeamId: root.id }, useTeamStore.getState());
    expect(out.teams[leaf.id].groupId).toBe(root.id);
    expect(out.order).toEqual(expect.arrayContaining([root.id]));
    expect(out.order).not.toContain(leaf.id);
  });

  it('on sync', () => {
    const { root, mid, leaf } = chain();
    setup([named('Local')]);
    useTeamStore.getState().applySynced([root, mid, leaf], []);
    expect(useTeamStore.getState().teams[leaf.id].groupId).toBe(root.id);
  });

  it('on import, and a loop becomes top-level', () => {
    const { root, mid, leaf } = chain();
    setup([named('Local')]);
    useTeamStore.getState().addTeams([root, mid, leaf], false);
    expect(useTeamStore.getState().teams[leaf.id].groupId).toBe(root.id);
    const a = named('A');
    const b = named('B', { groupId: a.id });
    a.groupId = b.id;
    useTeamStore.getState().applySynced([a, b], []);
    const t = useTeamStore.getState().teams;
    expect(t[a.id].groupId === undefined || t[b.id].groupId === undefined).toBe(true);
  });
});

describe('no-op edits', () => {
  it('editing an empty slot does not stamp the team', () => {
    const t = named('Mine');
    setup([t]);
    const before = useTeamStore.getState().teams[t.id];
    useTeamStore.getState().updateSet(t.id, 2, { nickname: 'x' });
    expect(useTeamStore.getState().teams[t.id]).toBe(before);
  });
});

describe('fresh fallback team', () => {
  it('is an unnamed, stamped scratch draft after the last team is deleted', () => {
    const t = named('Only');
    setup([t]);
    useTeamStore.getState().deleteTeam(t.id);
    const s = useTeamStore.getState();
    const open = s.teams[s.activeTeamId];
    expect(open.name).toBe(DEFAULT_TEAM_NAME);
    expect(open.groupId).toBeUndefined();
  });

  it('after deleting the open team the builder opens a draft copy of the next saved one', () => {
    const a = named('A');
    const b = named('B');
    setup([a, b], a.id);
    useTeamStore.getState().deleteTeam(a.id);
    const s = useTeamStore.getState();
    expect(s.teams[s.activeTeamId].name).toBe(DEFAULT_TEAM_NAME);
    expect(s.editingFrom).toBe(b.id);
    expect(s.editingDraft).toBe(s.activeTeamId);
  });

  it('applySynced emptying everything leaves a scratch draft', () => {
    const t = named('Only');
    setup([t]);
    useTeamStore.getState().applySynced([], [t.id]);
    const s = useTeamStore.getState();
    expect(s.teams[s.activeTeamId].name).toBe(DEFAULT_TEAM_NAME);
  });
});
