import { beforeEach, describe, expect, it } from 'vitest';
import type { PokemonSet } from '@/domain/types';
import { sanitizeOhkoBuilds, useOhkoBuilds } from '../ohkoBuildStore';

const build = (speciesId: string): PokemonSet =>
  ({ uid: `u-${speciesId}`, speciesId, nature: 'Adamant', moves: ['closecombat', '', '', ''], level: 50, sp: { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 }, evs: {}, ivs: {} }) as unknown as PokemonSet;

beforeEach(() => useOhkoBuilds.setState({ builds: {} }));

describe('OHKO report builds', () => {
  it('keeps a build per species, resets one or all, and undoes with restore', () => {
    const s = useOhkoBuilds.getState();
    s.setBuild('garchomp', build('garchomp'));
    s.setBuild('medicham', build('medicham'));
    const was = useOhkoBuilds.getState().builds;
    useOhkoBuilds.getState().resetBuild('garchomp');
    useOhkoBuilds.getState().resetBuild('nobody'); // nothing to reset: no-op
    expect(Object.keys(useOhkoBuilds.getState().builds)).toEqual(['medicham']);
    useOhkoBuilds.getState().resetAll();
    expect(useOhkoBuilds.getState().builds).toEqual({});
    useOhkoBuilds.getState().restore(was);
    expect(Object.keys(useOhkoBuilds.getState().builds).sort()).toEqual(['garchomp', 'medicham']);
  });

  it('loads only valid builds, each under its own species', () => {
    const loaded = sanitizeOhkoBuilds({ builds: { medicham: build('medicham'), garchomp: build('medicham'), junk: 5 } });
    expect(Object.keys(loaded.builds)).toEqual(['medicham']);
    expect(sanitizeOhkoBuilds(undefined)).toEqual({ builds: {} });
  });
});
