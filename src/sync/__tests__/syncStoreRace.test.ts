import { beforeEach, describe, expect, it } from 'vitest';
import { useSyncStore } from '../syncStore';

beforeEach(() => useSyncStore.setState({ cursor: 0, known: {}, forced: [], epoch: 0 }));

describe('a run saving while the store changed under it', () => {
  it('keeps a team queued by force() during the run, and drops the ones the run answered', () => {
    useSyncStore.setState({ forced: ['team:a'] });
    const base = { epoch: useSyncStore.getState().epoch, forced: ['team:a'] };
    useSyncStore.getState().force(['team:b']); // labels made while the run is going
    useSyncStore.getState().saveState({ cursor: 5, known: { 'team:a': { updatedAt: 1 } }, forced: [] }, base);
    const s = useSyncStore.getState();
    expect(s.forced).toEqual(['team:b']);
    expect(s.cursor).toBe(5);
  });
  it('a force() on top of a save of the same state still survives a later save', () => {
    const base = { epoch: 0, forced: [] as string[] };
    useSyncStore.getState().force(['team:x']);
    useSyncStore.getState().saveState({ cursor: 1, known: {}, forced: [] }, base);
    useSyncStore.getState().saveState({ cursor: 2, known: {}, forced: [] }, base);
    expect(useSyncStore.getState().forced).toEqual(['team:x']);
  });
  it('forget() during a run is not undone by the run’s old cursor and known', () => {
    useSyncStore.setState({ cursor: 40, known: { 'team:a': { updatedAt: 1 } } });
    const base = { epoch: useSyncStore.getState().epoch, forced: [] as string[] };
    useSyncStore.getState().forget();
    useSyncStore.getState().saveState({ cursor: 41, known: { 'team:a': { updatedAt: 1 } }, forced: [] }, base);
    const s = useSyncStore.getState();
    expect(s.cursor).toBe(0);
    expect(s.known).toEqual({});
  });
  it('without a base the save replaces the state as before', () => {
    useSyncStore.getState().saveState({ cursor: 3, known: {}, forced: ['team:z'] });
    expect(useSyncStore.getState().forced).toEqual(['team:z']);
  });
});
