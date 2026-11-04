import { describe, expect, it } from 'vitest';
import data from '@/data/generated/champions.json';
import metaJson from '@/data/generated/meta.json';
import { Dex } from '@/data/dex';
import { getFormat } from '@/domain/formats';
import { parseMetaFile } from '@/domain/meta';
import { speedDependence } from '@/domain/speedDependence';
import { metaVariants } from '@/domain/speedTiers';
import { createSet } from '@/domain/team';
import type { Dataset, PokemonSet } from '@/domain/types';

const dex = new Dex(data as unknown as Dataset);
const fmt = getFormat('champions-vgc-reg-mc');
const snap = parseMetaFile(metaJson).regulations['champions-reg-mc'];
const variants = metaVariants(snap, dex, fmt, 30);

const mon = (speciesId: string, spe: number, nature: PokemonSet['nature'], moves: string[] = []): PokemonSet => ({
  ...createSet(dex, speciesId, fmt),
  nature,
  sp: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe },
  moves: [...moves, '', '', '', ''].slice(0, 4) as PokemonSet['moves'],
});
const team = (sets: PokemonSet[]) => sets.map((set, slot) => ({ slot, set }));

describe('speedDependence', () => {
  it('flags a slow team that only works under Trick Room, with a single setter', () => {
    const t = team([mon('hatterene', 0, 'Brave', ['trickroom']), mon('torkoal', 0, 'Brave'), mon('snorlax', 0, 'Brave'), mon('conkeldurr', 0, 'Brave')]);
    const r = speedDependence(dex, variants, t);
    const tr = r.plans.find((p) => p.plan === 'Trick Room')!;
    expect(tr.withPlan).toBeGreaterThan(tr.free);
    expect(tr.verdict).toBe('dependent');
    expect(tr.singleSetter).toBe(true);
    expect(r.notable).toBe(true);
    expect(tr.lines.join(' ')).toMatch(/Only Hatterene sets Trick Room/);
  });
  it('a second setter is not a single point of failure', () => {
    const t = team([mon('hatterene', 0, 'Brave', ['trickroom']), mon('torkoal', 0, 'Brave'), mon('snorlax', 0, 'Brave', ['trickroom']), mon('conkeldurr', 0, 'Brave')]);
    expect(speedDependence(dex, variants, t).plans.find((p) => p.plan === 'Trick Room')!.singleSetter).toBe(false);
  });
  it('a team with no control that is mostly outsped is warned, and a room it cannot set is named', () => {
    const t = team([mon('torkoal', 0, 'Brave'), mon('snorlax', 0, 'Brave'), mon('conkeldurr', 0, 'Brave'), mon('hatterene', 0, 'Brave')]);
    const r = speedDependence(dex, variants, t);
    expect(r.noControl?.line).toMatch(/nothing on the team controls speed/);
    expect(r.noControl?.line).toMatch(/Trick Room/);
  });
  it('a naturally fast team does not depend on Tailwind', () => {
    const t = team([mon('talonflame', 32, 'Jolly', ['tailwind']), mon('dragapult', 32, 'Jolly'), mon('weavile', 32, 'Jolly'), mon('garchomp', 32, 'Jolly')]);
    const tw = speedDependence(dex, variants, t).plans.find((p) => p.plan === 'Tailwind')!;
    expect(tw.verdict).not.toBe('dependent');
  });
  it('is empty without a team or foes', () => {
    expect(speedDependence(dex, variants, []).notable).toBe(false);
    expect(speedDependence(dex, [], team([mon('torkoal', 0, 'Brave')])).notable).toBe(false);
  });
});
