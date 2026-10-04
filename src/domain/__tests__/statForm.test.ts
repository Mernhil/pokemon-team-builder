import { describe, expect, it } from 'vitest';
import data from '@/data/generated/champions.json';
import { Dex } from '@/data/dex';
import { defaultField, defaultSide } from '@/domain/battle/conditions';
import { calcMoves, calcSpeed, toCalcPokemon } from '@/domain/battle/damage';
import { statFormOptions } from '@/domain/battle/statForm';
import { getFormat } from '@/domain/formats';
import { createSet } from '@/domain/team';
import type { Dataset, PokemonSet } from '@/domain/types';

const dex = new Dex(data as unknown as Dataset);
const fmt = getFormat('champions-vgc-reg-mc');
const field = defaultField();
const mk = (id: string, patch: Partial<PokemonSet> = {}): PokemonSet => ({ ...createSet(dex, id, fmt), ...patch });
const aegis = mk('aegislash', { abilityId: 'stancechange', nature: 'Modest', moves: ['shadowball', 'ironhead', 'kingsshield', ''] });
const target = mk('garchomp', { moves: ['earthquake', '', '', ''] });
const pct = (att: PokemonSet, attCond: object, def: PokemonSet, defCond: object, moveIdx = 0) =>
  calcMoves(dex, { set: att, cond: { ...defaultSide(), ...attCond } }, { set: def, cond: { ...defaultSide(), ...defCond } }, field)[moveIdx].forms[0].percent[1];

describe('stat-changing battle formes', () => {
  it('Aegislash attacks with Blade stats and defends with Shield stats by default', () => {
    const auto = toCalcPokemon(dex, aegis, defaultSide(), false, 'attacker');
    expect(auto.species.name).toBe('Aegislash-Blade');
    expect(auto.species.baseStats.atk).toBe(140);
    const def = toCalcPokemon(dex, aegis, defaultSide(), false, 'defender');
    expect(def.species.name).toBe('Aegislash-Shield');
    expect(def.species.baseStats.def).toBe(140);
  });

  it('hits much harder as Blade than as forced Shield, and the pick overrides the role', () => {
    const blade = pct(aegis, {}, target, {});
    const shield = pct(aegis, { statForm: 'base' }, target, {});
    expect(blade).toBeGreaterThan(shield * 2);
    expect(pct(aegis, { statForm: 'alt' }, target, {})).toBe(blade);
    // Defending: auto = Shield (much bulkier than a forced Blade).
    const earthquake = (cond: object) => pct(target, {}, aegis, cond);
    expect(earthquake({ statForm: 'alt' })).toBeGreaterThan(earthquake({}) * 2);
    expect(earthquake({ statForm: 'base' })).toBe(earthquake({}));
  });

  it('other users of a stat-changing forme (Palafin) stay base unless picked', () => {
    const palafin = mk('palafin', { abilityId: 'zerotohero' });
    expect(toCalcPokemon(dex, palafin, defaultSide(), false, 'attacker').species.name).toBe('Palafin');
    expect(toCalcPokemon(dex, palafin, { ...defaultSide(), statForm: 'alt' }, false, 'attacker').species.name).toBe('Palafin-Hero');
  });

  it('speed readouts never swap forme, and only these Pokémon get the selector', () => {
    expect(calcSpeed(dex, { set: aegis, cond: defaultSide() }, field)[0].speed).toBe(calcSpeed(dex, { set: aegis, cond: { ...defaultSide(), statForm: 'alt' } }, field)[0].speed);
    expect(statFormOptions(dex, aegis)?.alt).toBe('Blade');
    expect(statFormOptions(dex, mk('garchomp'))).toBeUndefined();
  });
});
