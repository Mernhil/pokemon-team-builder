import { beforeEach, describe, expect, it } from 'vitest';
import { useMatchStore } from '../matchStore';
import { toast, useToastStore } from '../toastStore';

describe('restoreMatch (the Undo of deleting a match)', () => {
  beforeEach(() => useMatchStore.setState({ matches: {}, order: [] }));

  it('puts the match back at its old place', () => {
    const { addMatch, deleteMatch, restoreMatch } = useMatchStore.getState();
    const a = addMatch('2026-01-01');
    const b = addMatch('2026-01-02');
    const c = addMatch('2026-01-03');
    expect(useMatchStore.getState().order).toEqual([c, b, a]);
    const match = useMatchStore.getState().matches[b];
    const index = useMatchStore.getState().order.indexOf(b);
    deleteMatch(b);
    expect(useMatchStore.getState().order).toEqual([c, a]);
    restoreMatch(match, index);
    expect(useMatchStore.getState().order).toEqual([c, b, a]);
    expect(useMatchStore.getState().matches[b].updatedAt).toBeGreaterThanOrEqual(match.updatedAt);
  });

  it('does nothing when the match is already there', () => {
    const id = useMatchStore.getState().addMatch('2026-01-01');
    const match = useMatchStore.getState().matches[id];
    useMatchStore.getState().restoreMatch(match, 0);
    expect(useMatchStore.getState().order).toEqual([id]);
  });
});

describe('toast queue', () => {
  beforeEach(() => useToastStore.setState({ toasts: [] }));

  it('keeps an Undo toast when more notices arrive', () => {
    toast('Deleted.', { label: 'Undo', run: () => undefined });
    toast('one');
    toast('two');
    toast('three');
    const list = useToastStore.getState().toasts;
    expect(list).toHaveLength(3);
    expect(list.some((t) => t.action)).toBe(true);
    expect(list.map((t) => t.message)).toEqual(['Deleted.', 'two', 'three']);
  });

  it('drops the oldest when every toast has an action', () => {
    for (const n of ['a', 'b', 'c', 'd']) toast(n, { label: 'Undo', run: () => undefined });
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual(['b', 'c', 'd']);
  });
});
