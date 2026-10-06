import { afterEach, describe, expect, it, vi } from 'vitest';
import { PICKER_ORDER } from '@/domain/pickerOrder';
import { usePrefsStore } from '../prefsStore';

describe('prefsStore', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('records recents per picker, capped, and toggles favorites', () => {
    const { addRecent, toggleFavorite } = usePrefsStore.getState();
    for (let i = 0; i < 12; i++) addRecent('items', `item${i}`);
    addRecent('natures', 'Adamant');
    const s = usePrefsStore.getState();
    expect(s.recent.items).toHaveLength(PICKER_ORDER.recentsCap);
    expect(s.recent.items![0]).toBe('item11');
    expect(s.recent.natures).toEqual(['Adamant']);
    toggleFavorite('moves', 'protect');
    expect(usePrefsStore.getState().favorites.moves).toEqual(['protect']);
    toggleFavorite('moves', 'protect');
    expect(usePrefsStore.getState().favorites.moves).toEqual([]);
  });

  it('sanitises a corrupted save instead of crashing', async () => {
    const saved = { version: 1, state: { recent: { items: ['ok', 42, '__proto__', 'ok'], species: 'nope' }, favorites: null, listMode: { items: 'weird', moves: 'az' }, showUnavailableSpecies: 'yes' } };
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(saved), setItem: () => {}, removeItem: () => {} });
    await usePrefsStore.persist.rehydrate();
    const s = usePrefsStore.getState();
    expect(s.recent.items).toEqual(['ok']);
    expect(s.recent.species).toEqual([]);
    expect(s.favorites.moves).toEqual([]);
    expect(s.listMode).toEqual({ items: undefined, moves: 'az' });
    expect(s.showUnavailableSpecies).toBe(PICKER_ORDER.species.showUnavailableByDefault);
  });
});

describe('statCalcOpen (the phone builder keeps the stat calculator open unless folded)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is open by default, remembers a fold, and ignores junk in a save', async () => {
    expect(usePrefsStore.getState().statCalcOpen).toBe(true);
    usePrefsStore.getState().setStatCalcOpen(false);
    expect(usePrefsStore.getState().statCalcOpen).toBe(false);
    const rehydrate = async (state: unknown) => {
      vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ version: 1, state }), setItem: () => {}, removeItem: () => {} });
      await usePrefsStore.persist.rehydrate();
      return usePrefsStore.getState().statCalcOpen;
    };
    expect(await rehydrate({ statCalcOpen: false })).toBe(false);
    expect(await rehydrate({})).toBe(true);
    expect(await rehydrate({ statCalcOpen: 'no' })).toBe(true);
  });
});
