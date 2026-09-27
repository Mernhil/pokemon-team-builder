import { describe, expect, it } from 'vitest';
import data from '@/data/generated/champions.json';
import { Dex } from '@/data/dex';
import { offensiveCoverage } from '@/domain/coverage';
import { getFormat } from '@/domain/formats';
import { createSet, createTeam } from '@/domain/team';
import type { Dataset, PokemonSet } from '@/domain/types';

const dex = new Dex(data as unknown as Dataset);
const fmt = getFormat('champions-vgc-reg-mc');
const mk = (species: string, moves: string[]): PokemonSet => ({
  ...createSet(dex, species, fmt),
  moves: [moves[0] ?? '', moves[1] ?? '', moves[2] ?? '', moves[3] ?? ''],
});
const row = (rows: ReturnType<typeof offensiveCoverage>, t: string) => rows.find((r) => r.defType === t)!;

describe('offensiveCoverage', () => {
  const team = createTeam(fmt);
  team.slots[0] = mk('garchomp', ['earthquake', 'dragonclaw', 'protect']);
  team.slots[1] = mk('charizard', ['heatwave']);
  const rows = offensiveCoverage(team, dex);

  it('covers every defending type', () => {
    expect(rows).toHaveLength(18);
  });

  it("takes each member's best damaging move and ignores status moves", () => {
    const steel = row(rows, 'Steel');
    expect(steel.hits).toEqual([
      { name: 'Garchomp', mult: 2, move: 'Earthquake' },
      { name: 'Charizard', mult: 2, move: 'Heat Wave' },
    ]);
    expect(steel.superEffective).toBe(2);
    expect(steel.walled).toBe(0);
  });

  it('counts resisted and immune hits as walled', () => {
    const flying = row(rows, 'Flying'); // Earthquake immune, Dragon Claw neutral → Garchomp not walled
    expect(flying.hits[0]).toMatchObject({ mult: 1, move: 'Dragon Claw' });
    const water = row(rows, 'Water'); // Heat Wave resisted
    expect(water.hits[1]).toMatchObject({ name: 'Charizard', mult: 0.5 });
    expect(water.walled).toBe(1);
  });

  it('skips members with no damaging moves', () => {
    const t = createTeam(fmt);
    t.slots[0] = mk('garchomp', ['protect']);
    expect(offensiveCoverage(t, dex)[0].hits).toEqual([]);
  });
});
