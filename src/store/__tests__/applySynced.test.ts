import { beforeEach, describe, expect, it } from 'vitest';
import { getFormat } from '@/domain/formats';
import { createMatch } from '@/domain/matches';
import { createTeam } from '@/domain/team';
import { useMatchStore } from '../matchStore';
import { useTeamStore } from '../teamStore';

const fmt = getFormat('champions-vgc-reg-mc');
const team = (name: string, over: object = {}) => ({ ...createTeam(fmt, name), ...over });

describe('teamStore.applySynced', () => {
  beforeEach(() => {
    const t = team('Local');
    useTeamStore.setState({ teams: { [t.id]: t }, order: [t.id], activeTeamId: t.id, activeSlot: 3 });
  });

  it('adds synced teams without touching their updatedAt, and keeps the active team and slot', () => {
    const before = useTeamStore.getState();
    const remote = team('Remote', { updatedAt: 12345 });
    useTeamStore.getState().applySynced([remote], []);
    const s = useTeamStore.getState();
    expect(s.teams[remote.id].updatedAt).toBe(12345);
    expect(s.order).toEqual([...before.order, remote.id]);
    expect(s.activeTeamId).toBe(before.activeTeamId);
    expect(s.activeSlot).toBe(3);
  });

  it('keeps variations out of the folder order and promotes one whose folder is gone', () => {
    const folder = team('Folder');
    const variation = team('Variation', { groupId: folder.id });
    useTeamStore.getState().applySynced([folder, variation], []);
    expect(useTeamStore.getState().order).toContain(folder.id);
    expect(useTeamStore.getState().order).not.toContain(variation.id);
    useTeamStore.getState().applySynced([], [folder.id]);
    const s = useTeamStore.getState();
    expect(s.teams[variation.id].groupId).toBeUndefined();
    expect(s.order).toContain(variation.id);
  });

  it('removes deleted teams, moves the active team if it was deleted, and never ends up with none', () => {
    const [id] = useTeamStore.getState().order;
    const other = team('Other');
    useTeamStore.getState().applySynced([other], [id]);
    expect(useTeamStore.getState().activeTeamId).toBe(other.id);
    expect(useTeamStore.getState().activeSlot).toBe(0);
    useTeamStore.getState().applySynced([], [other.id]);
    const s = useTeamStore.getState();
    expect(Object.keys(s.teams)).toHaveLength(1);
    expect(s.activeTeamId).toBe(s.order[0]);
  });
});

describe('matchStore.applySynced', () => {
  beforeEach(() => useMatchStore.setState({ matches: {}, order: [] }));

  it('adds new matches at the front, updates in place, and removes deleted ones', () => {
    const a = { ...createMatch('2026-10-01'), updatedAt: 111 };
    const b = { ...createMatch('2026-10-02'), updatedAt: 222 };
    useMatchStore.getState().applySynced([a], []);
    useMatchStore.getState().applySynced([b], []);
    expect(useMatchStore.getState().order).toEqual([b.id, a.id]);
    expect(useMatchStore.getState().matches[b.id].updatedAt).toBe(222);
    useMatchStore.getState().applySynced([{ ...a, notes: 'edited', updatedAt: 333 }], [b.id]);
    const s = useMatchStore.getState();
    expect(s.order).toEqual([a.id]);
    expect(s.matches[a.id]).toMatchObject({ notes: 'edited', updatedAt: 333 });
    expect(s.matches[b.id]).toBeUndefined();
  });
});
