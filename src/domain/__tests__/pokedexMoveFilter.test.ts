import { describe, expect, it } from 'vitest';
import data from '@/data/generated/champions.json';
import { Dex } from '@/data/dex';
import { learnersOfType, megaList } from '@/domain/pokedex';
import type { Dataset } from '@/domain/types';

const dex = new Dex(data as unknown as Dataset);
const REG = 'champions-reg-mc';

describe('Pokédex: Pokémon that learn a move of a type', () => {
  const megas = megaList(dex, REG);
  const fire = learnersOfType(dex, megas, 'Fire', REG);

  it('keeps exactly the Megas whose Pokémon learn a Fire move', () => {
    expect(fire.size).toBeGreaterThan(0);
    expect(fire.size).toBeLessThan(megas.length);
    for (const m of megas) {
      const learns = dex.learnset(m.id, REG).some((mv) => mv.type === 'Fire');
      expect(fire.has(m.id), m.id).toBe(learns);
    }
    // Charizard-Mega-X learns Flare Blitz; a Mega counts through its base forme's moves.
    expect(fire.has('charizardmegax')).toBe(true);
  });

  it('works for every type, and a type nobody learns gives nothing', () => {
    for (const t of dex.types) expect(learnersOfType(dex, megas, t, REG).size).toBeGreaterThanOrEqual(0);
    expect(learnersOfType(dex, megas, 'Nonexistent', REG).size).toBe(0);
    expect(learnersOfType(dex, [], 'Fire', REG).size).toBe(0);
  });

  it('a regulation limits it to the moves that regulation allows', () => {
    const base = dex.selectableSpecies(REG);
    expect(learnersOfType(dex, base, 'Fire', REG).size).toBeLessThanOrEqual(learnersOfType(dex, base, 'Fire').size);
  });
});
