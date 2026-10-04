import { describe, expect, it } from 'vitest';
import data from '@/data/generated/champions.json';
import { Dex } from '@/data/dex';
import { typeMultiplier } from '@/domain/abilityTypes';
import { moveCoverage, defensiveCoverage, defensiveFixSuggestion, defensiveSuggestions, offensiveCoverage, offensiveFixSuggestion, offensiveSuggestions } from '@/domain/coverage';
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

  it('counts a move with no effect separately from a resisted one', () => {
    const flying = row(rows, 'Flying');
    expect(flying.noEffect).toBe(0); // Garchomp falls back to Dragon Claw
    const t = createTeam(fmt);
    t.slots[0] = mk('garchomp', ['earthquake']);
    t.slots[1] = mk('charizard', ['heatwave']);
    const r = row(offensiveCoverage(t, dex), 'Flying');
    expect(r.walled).toBe(1);
    expect(r.noEffect).toBe(1); // Earthquake can't hit a Flying type at all
    expect(row(offensiveCoverage(t, dex), 'Water').noEffect).toBe(0); // Heat Wave is only resisted
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
    immune: 0,
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

  it('orders its chip stats the same as the matrix cell: weak (bad) then resist (good)', () => {
    const s = defensiveSuggestions([row('Fairy', 3, 1)], 3)[0];
    expect(s.stats).toEqual([{ value: 3, tone: 'bad' }, { value: 1, tone: 'good' }]);
  });
});

describe('defensiveFixSuggestion', () => {
  const row = (atkType: string, weak: number, resist: number) => ({
    atkType: atkType as never,
    mults: [],
    weak,
    resist,
    immune: 0,
    danger: weak >= 3 || (weak >= 2 && resist === 0),
  });

  it('picks the type that resists the most current weaknesses at once', () => {
    const rows = [row('Ground', 2, 0), row('Rock', 2, 0), row('Ice', 2, 1)];
    const s = defensiveFixSuggestion(dex, defensiveSuggestions(rows, 3));
    expect(s?.text).toContain('A Steel-type Pokémon would resist 2 of your weak types: Rock and Ice.');
  });

  it('says nothing when no single type resists 2+ of the problems', () => {
    expect(defensiveFixSuggestion(dex, defensiveSuggestions([row('Ground', 2, 0)], 2))).toBeNull();
  });
});

describe('offensiveSuggestions', () => {
  const row = (defType: string, hitCount: number, superEffective: number, walled: number) => ({
    defType: defType as never,
    hits: Array.from({ length: hitCount }, () => ({ name: '', mult: 1, move: '' })),
    superEffective,
    walled,
    noEffect: 0,
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

  it('orders its chip stats the same as the matrix cell: super-effective (good) then walled (bad)', () => {
    const s = offensiveSuggestions([row('Steel', 3, 0, 3)])[0];
    expect(s.stats).toEqual([{ value: 0, tone: 'good' }, { value: 3, tone: 'bad' }]);
  });

  it('says nothing with fewer than 3 attackers (a coverage gap is still expected)', () => {
    expect(offensiveSuggestions([row('Steel', 2, 0, 2)])).toEqual([]);
  });
});

describe('offensiveFixSuggestion', () => {
  const row = (defType: string, hitCount: number, superEffective: number, walled: number) => ({
    defType: defType as never,
    hits: Array.from({ length: hitCount }, () => ({ name: '', mult: 1, move: '' })),
    superEffective,
    walled,
    noEffect: 0,
  });

  it('picks the move type that hits the most current gaps super-effectively at once', () => {
    const rows = [row('Ghost', 3, 0, 1), row('Psychic', 3, 0, 1), row('Water', 3, 1, 0)];
    const s = offensiveFixSuggestion(dex, offensiveSuggestions(rows));
    expect(s?.text).toContain('A Ghost-type move would hit 2 of your coverage gaps super-effectively: Ghost and Psychic.');
  });

  it('says nothing when no single type covers 2+ of the gaps', () => {
    expect(offensiveFixSuggestion(dex, offensiveSuggestions([row('Ghost', 3, 0, 1)]))).toBeNull();
  });
});

describe('defensiveCoverage: immunities', () => {
  it('counts a Pokémon that takes no damage as immune (and as resisting), not as weak', () => {
    const t = createTeam(fmt);
    t.slots[0] = mk('aegislash', ['shadowball']); // Steel/Ghost: Fighting 2 × 0
    t.slots[1] = mk('garchomp', ['earthquake']); // Dragon/Ground: weak to Ice, Dragon, Fairy
    const rows = defensiveCoverage(t, dex, false);
    const fighting = rows.find((r) => r.atkType === 'Fighting')!;
    expect(fighting.mults[0]).toEqual({ name: 'Aegislash', mult: 0 });
    expect(fighting).toMatchObject({ weak: 0, immune: 1 });
    expect(fighting.resist).toBeGreaterThanOrEqual(1);
    const normal = rows.find((r) => r.atkType === 'Normal')!;
    expect(normal.immune).toBe(1); // Ghost ignores Normal as well
    const ground = rows.find((r) => r.atkType === 'Ground')!;
    expect(ground).toMatchObject({ weak: 1, immune: 0 }); // Steel is weak to Ground; Garchomp is neutral
  });
});

describe('moveCoverage', () => {
  const at = (rows: ReturnType<typeof moveCoverage>, t: string) => rows.find((r) => r.defType === t)!;

  it('takes the best multiplier among the damaging moves and names the moves reaching it', () => {
    const rows = moveCoverage(dex, ['earthquake', 'dragonclaw', 'protect']);
    expect(rows).toHaveLength(18);
    expect(at(rows, 'Steel')).toMatchObject({ mult: 2, moves: ['Earthquake'] });
    expect(at(rows, 'Flying')).toMatchObject({ mult: 1, moves: ['Dragon Claw'] });
    expect(at(rows, 'Fairy')).toMatchObject({ mult: 1, moves: ['Earthquake'] });
  });

  it('reports a fully blocked type as ×0', () => {
    expect(at(moveCoverage(dex, ['earthquake']), 'Flying')).toMatchObject({ mult: 0 });
  });

  it('has no multiplier without a damaging move', () => {
    expect(moveCoverage(dex, ['protect', '']).every((r) => r.mult === undefined)).toBe(true);
  });
});

describe('abilities in the type matrices', () => {
  const withAbility = (species: string, abilityId: string, moves: string[] = []) => ({ ...mk(species, moves), abilityId });

  it('Levitate makes a Pokémon immune to Ground (Rotom-Wash is not weak to it)', () => {
    const team = createTeam(fmt);
    team.slots[0] = withAbility('rotomwash', 'levitate');
    const ground = defensiveCoverage(team, dex, false).find((r) => r.atkType === 'Ground')!;
    expect(ground.mults[0].mult).toBe(0);
    expect(ground.weak).toBe(0);
    expect(ground.immune).toBe(1);
  });

  it('without the ability the type chart alone decides', () => {
    const team = createTeam(fmt);
    team.slots[0] = withAbility('rotomwash', 'notlevitate');
    expect(defensiveCoverage(team, dex, false).find((r) => r.atkType === 'Ground')!.mults[0].mult).toBe(2);
  });

  it('Thick Fat halves Fire and Ice, and a Mega stone holder uses its Mega ability', () => {
    expect(typeMultiplier(dex, 'Fire', ['Normal'], { defender: 'thickfat' })).toBe(0.5);
    expect(typeMultiplier(dex, 'Ice', ['Grass'], { defender: 'thickfat' })).toBe(1);
    const team = createTeam(fmt);
    team.slots[0] = { ...withAbility('garchomp', 'sandveil'), itemId: 'garchompite' };
    const row = (mega: boolean) => defensiveCoverage(team, dex, mega).find((r) => r.atkType === 'Ice')!;
    expect(row(false).mults[0].mult).toBe(4);
  });

  it('Pixilate makes a Normal move Fairy, Scrappy hits Ghosts, and Mold Breaker ignores Levitate', () => {
    const team = createTeam(fmt);
    team.slots[0] = withAbility('sylveon', 'pixilate', ['hypervoice']);
    const dragon = offensiveCoverage(team, dex).find((r) => r.defType === 'Dragon')!;
    expect(dragon.hits[0]).toMatchObject({ mult: 2, move: 'Hyper Voice' });
    expect(typeMultiplier(dex, 'Normal', ['Ghost'], { attacker: 'scrappy' })).toBe(1);
    expect(typeMultiplier(dex, 'Normal', ['Ghost'])).toBe(0);
    expect(typeMultiplier(dex, 'Ground', ['Steel'], { defender: 'levitate' })).toBe(0);
    expect(typeMultiplier(dex, 'Ground', ['Steel'], { defender: 'levitate', attacker: 'moldbreaker' })).toBe(2);
  });
});
