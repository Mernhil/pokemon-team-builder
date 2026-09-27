import { describe, expect, it } from 'vitest';
import { Generations, Move, Pokemon, calculate, Field } from '@smogon/calc';
import data from '@/data/generated/champions.json';
import { Dex } from '@/data/dex';
import { getFormat } from '@/domain/formats';
import { calcStats } from '@/domain/stats';
import { createSet } from '@/domain/team';
import type { Dataset, PokemonSet } from '@/domain/types';
import { defaultField, defaultSide, type FieldConditions, type SideConditions } from '@/domain/battle/conditions';
import { effectiveStats, stageStat } from '@/domain/battle/effective';
import { calcMoves, calcSpeed } from '@/domain/battle/damage';

const dex = new Dex(data as unknown as Dataset);
const fmt = getFormat('champions-vgc-reg-mc');

function mk(species: string, patch: Partial<PokemonSet> = {}): PokemonSet {
  return { ...createSet(dex, species, fmt), ...patch };
}
function eff(set: PokemonSet, side: Partial<SideConditions> = {}, field: Partial<FieldConditions> = {}, crit = false) {
  const sp = dex.species(set.speciesId)!;
  const cond = { ...defaultSide(), ...side };
  const forme = cond.mega ? dex.megaFor(sp.id, set.itemId) ?? sp : sp;
  return effectiveStats({
    species: forme,
    stats: calcStats(forme.baseStats, set, fmt, dex.nature(set.nature)),
    ability: forme !== sp ? Object.values(forme.abilities)[0]! : dex.ability(set.abilityId)?.name ?? '',
    item: dex.item(set.itemId)?.name ?? '',
    teraType: set.teraType,
    moves: set.moves.map((m) => dex.move(m)!).filter(Boolean),
    side: cond,
    field: { ...defaultField(), ...field },
    crit,
  });
}

describe('stat stages', () => {
  it('follows the (2+n)/2 and 2/(2-n) table', () => {
    expect(stageStat(100, 2)).toBe(200);
    expect(stageStat(100, -1)).toBe(66);
    expect(stageStat(100, -2)).toBe(50);
    expect(stageStat(100, 6)).toBe(400);
  });
});

describe('effective stats', () => {
  const sp = { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 };
  it('applies Tailwind, Scarf, weather abilities and paralysis', () => {
    const venu = mk('venusaur', { abilityId: 'chlorophyll', nature: 'Modest', sp });
    const base = eff(venu).stats.spe.final;
    expect(eff(venu, {}, { weather: 'Sun' }).stats.spe.final).toBe(base * 2);
    expect(eff(venu, { tailwind: true }).stats.spe.final).toBe(base * 2);
    expect(eff(venu, { status: 'par' }).stats.spe.final).toBe(Math.floor(base / 2));
  });

  it('applies −2 Atk / +2 Def stages and Intimidate', () => {
    const inc = mk('incineroar', { sp: { hp: 32, atk: 0, def: 32, spa: 0, spd: 2, spe: 0 } });
    const e = eff(inc, { boosts: { atk: -2, def: 2, spa: 0, spd: 0, spe: 0 } });
    expect(e.stats.atk.final).toBe(Math.floor(e.stats.atk.raw / 2));
    expect(e.stats.def.final).toBe(e.stats.def.raw * 2);
  });

  it('shows Sharpness, STAB and crits in move power', () => {
    const gall = mk('gallade', { abilityId: 'sharpness', moves: ['sacredsword', 'leafblade', 'closecombat', ''] });
    const e = eff(gall);
    const ss = e.moves.find((m) => m.moveId === 'sacredsword')!;
    expect(ss.effectivePower).toBe(135); // 90 × 1.5
    expect(ss.mods.map((m) => m.label)).toEqual(['Sharpness', 'STAB']);
    const cc = e.moves.find((m) => m.moveId === 'closecombat')!;
    expect(cc.effectivePower).toBe(120); // not a slicing move
    expect(eff(gall, {}, {}, true).moves[0].mods.map((m) => m.label)).toContain('Critical hit');
  });

  it('halves damage taken under Aurora Veil in singles, ×2732/4096 in doubles', () => {
    const e = eff(mk('ninetalesalola'), { auroraVeil: true }, { gameType: 'Singles' });
    expect(e.physicalTaken[0].factor).toBe(0.5);
    const d = eff(mk('ninetalesalola'), { auroraVeil: true });
    expect(d.physicalTaken[0].factor).toBeCloseTo(0.667, 2);
  });

  it("matches the damage calculator's final Speed across conditions", () => {
    const cases: [string, Partial<PokemonSet>, Partial<SideConditions>, Partial<FieldConditions>][] = [
      ['venusaur', { abilityId: 'chlorophyll' }, {}, { weather: 'Sun' }],
      ['pelipper', { abilityId: 'drizzle' }, { tailwind: true, boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 1 } }, {}],
      ['garchomp', { itemId: 'choicescarf' }, { status: 'par' }, {}],
      ['excadrill', { abilityId: 'sandrush' }, { boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: -1 } }, { weather: 'Sand' }],
      ['kingambit', {}, { tailwind: true }, {}],
    ];
    for (const [id, patch, side, field] of cases) {
      const set = mk(id, { sp: { hp: 0, atk: 0, def: 0, spa: 0, spd: 2, spe: 32 }, nature: 'Timid', ...patch });
      const cond = { ...defaultSide(), ...side };
      const f = { ...defaultField(), ...field };
      expect(eff(set, side, field).stats.spe.final, id).toBe(calcSpeed(dex, { set, cond }, f));
    }
  });
});

describe('damage calculator adapter', () => {
  it('matches a direct @smogon/calc Champions calculation', () => {
    const gen = Generations.get(0 as never);
    const att = mk('garchomp', { itemId: 'garchompite', nature: 'Jolly', sp: { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 }, moves: ['earthquake', 'dragonclaw', '', ''] });
    const def = mk('incineroar', { abilityId: 'intimidate', nature: 'Careful', sp: { hp: 32, atk: 0, def: 20, spa: 0, spd: 14, spe: 0 } });
    const [eq] = calcMoves(dex, { set: att, cond: defaultSide(true) }, { set: def, cond: defaultSide() }, defaultField());
    const direct = calculate(
      gen,
      new Pokemon(gen, 'Garchomp-Mega', { item: 'Garchompite' as never, nature: 'Jolly' as never, ability: 'Sand Force' as never, evs: { hp: 2, atk: 32, spe: 32 } }),
      new Pokemon(gen, 'Incineroar', { nature: 'Careful' as never, ability: 'Intimidate' as never, evs: { hp: 32, def: 20, spd: 14 } }),
      new Move(gen, 'Earthquake'),
      new Field({ gameType: 'Doubles' }),
    );
    expect(eq.range).toEqual(direct.range());
    expect(eq.koText).toMatch(/2HKO/);
  });

  it('uses the Z Mega forme and its announced ability', () => {
    const att = mk('garchomp', { itemId: 'garchompitez', moves: ['dracometeor', '', '', ''], nature: 'Modest', sp: { hp: 2, atk: 0, def: 0, spa: 32, spd: 0, spe: 32 } });
    const def = mk('incineroar');
    const [r] = calcMoves(dex, { set: att, cond: defaultSide(true) }, { set: def, cond: defaultSide() }, defaultField());
    expect(r.desc).toContain('Garchomp-Mega-Z');
    expect(r.range[1]).toBeGreaterThan(0);
  });

  it('crits ignore Reflect and are bigger', () => {
    const att = mk('kingambit', { moves: ['kowtowcleave', '', '', ''], sp: { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 } });
    const def = mk('sinistcha');
    const normal = calcMoves(dex, { set: att, cond: defaultSide() }, { set: def, cond: { ...defaultSide(), reflect: true } }, defaultField())[0];
    const crit = calcMoves(dex, { set: att, cond: defaultSide() }, { set: def, cond: { ...defaultSide(), reflect: true } }, defaultField(), [true])[0];
    expect(crit.range[0]).toBeGreaterThan(normal.range[1]);
  });
});
