import { beforeEach, describe, expect, it } from 'vitest';
import type { PokemonSet } from '@/domain/types';
import { sanitizeReverseBuilds, useReverseBuilds } from '../reverseBuildStore';

const build = (speciesId: string, itemId?: string): PokemonSet =>
  ({ uid: `u-${speciesId}`, speciesId, itemId, nature: 'Adamant', moves: ['closecombat', '', '', ''], level: 50, sp: { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 }, evs: {}, ivs: {} }) as unknown as PokemonSet;

beforeEach(() => useReverseBuilds.setState({ overrides: {}, tryStones: false }));

describe('Reverse search builds', () => {
  it('keeps a build per species, resets one or all, and undoes with restore', () => {
    const s = useReverseBuilds.getState();
    s.setBuild('medicham', build('medicham', 'medichamite'));
    s.setBuild('garchomp', build('garchomp'));
    s.setBuild('medicham', build('medicham', 'sitrusberry'));
    expect(Object.keys(useReverseBuilds.getState().overrides)).toEqual(['medicham', 'garchomp']);
    expect(useReverseBuilds.getState().overrides.medicham.itemId).toBe('sitrusberry');

    const was = useReverseBuilds.getState().overrides;
    useReverseBuilds.getState().resetBuild('medicham');
    expect(Object.keys(useReverseBuilds.getState().overrides)).toEqual(['garchomp']);
    useReverseBuilds.getState().resetBuild('nobody'); // nothing to reset: no-op
    useReverseBuilds.getState().resetAll();
    expect(useReverseBuilds.getState().overrides).toEqual({});
    useReverseBuilds.getState().restore(was);
    expect(Object.keys(useReverseBuilds.getState().overrides).sort()).toEqual(['garchomp', 'medicham']);
  });

  it('the stone toggle is off by default', () => {
    expect(useReverseBuilds.getState().tryStones).toBe(false);
    useReverseBuilds.getState().setTryStones(true);
    expect(useReverseBuilds.getState().tryStones).toBe(true);
  });

  it('loads only valid builds, each under its own species', () => {
    const loaded = sanitizeReverseBuilds({ overrides: { medicham: build('medicham'), garchomp: build('medicham'), junk: 5, nothing: null }, tryStones: 'yes' });
    expect(Object.keys(loaded.overrides)).toEqual(['medicham']);
    expect(loaded.tryStones).toBe(false);
    expect(sanitizeReverseBuilds(undefined)).toEqual({ overrides: {}, tryStones: false });
    expect(sanitizeReverseBuilds({ overrides: [build('medicham')] }).overrides).toEqual({});
  });
});
