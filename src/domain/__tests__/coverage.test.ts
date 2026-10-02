import { describe, expect, it } from 'vitest';
import data from '@/data/generated/champions.json';
import { Dex } from '@/data/dex';
import { defensiveSuggestions, offensiveCoverage, offensiveSuggestions } from '@/domain/coverage';
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

describe('defensiveSuggestions', () => {
  const row = (atkType: string, weak: number, resist: number) => ({
    atkType: atkType as never,
    mults: [],
    weak,
    resist,
    danger: weak >= 3 || (weak >= 2 && resist === 0),
  });

  it('flags a type most of the team is weak to, worst first', () => {
    const rows = [row('Fairy', 3, 0), row('Ice', 2, 1), row('Water', 0, 2)];
    const s = defensiveSuggestions(rows, 3);
    expect(s.map((x) => x.id)).toEqual(['Fairy', 'Ice']);
    expect(s[0].severity).toBe('high');
    expect(s[0].text).toContain('Fairy is a big problem for your team: 3 of your 3 Pokémon are weak to it');
    expect(s[1].severity).toBe('medium');
  });

  it('flags 2 weak with no one resisting as high severity too', () => {
    const s = defensiveSuggestions([row('Ground', 2, 0)], 2);
    expect(s).toHaveLength(1);
    expect(s[0].severity).toBe('high');
    expect(s[0].text).toContain('none of them resist it either');
  });

  it('says nothing for a lone Pokémon (not enough of a team to judge)', () => {
    expect(defensiveSuggestions([row('Fire', 1, 0)], 1)).toEqual([]);
  });
});

describe('offensiveSuggestions', () => {
  const row = (defType: string, hitCount: number, superEffective: number, walled: number) => ({
    defType: defType as never,
    hits: Array.from({ length: hitCount }, () => ({ name: '', mult: 1, move: '' })),
    superEffective,
    walled,
  });

  it('flags a type nobody hits super-effectively, worst (mostly walled) first', () => {
    const rows = [row('Steel', 3, 0, 3), row('Ghost', 3, 0, 1), row('Water', 3, 1, 0)];
    const s = offensiveSuggestions(rows);
    expect(s.map((x) => x.id)).toEqual(['Steel', 'Ghost']);
    expect(s[0].severity).toBe('high');
    expect(s[0].text).toContain('no super-effective attacks against Steel');
    expect(s[1].severity).toBe('medium');
    expect(s[1].text).toContain('still land neutral damage');
  });

  it('says nothing with fewer than 3 attackers (a coverage gap is still expected)', () => {
    expect(offensiveSuggestions([row('Steel', 2, 0, 2)])).toEqual([]);
  });
});
