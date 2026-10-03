import { describe, expect, it } from 'vitest';
import champions from '@/data/generated/champions.json';
import gen9 from '@/data/generated/gen9.json';
import { Dex, unpackDataset } from '@/data/dex';
import { calcMoves, calcSpeed } from '@/domain/battle/damage';
import { defaultField, defaultSide } from '@/domain/battle/conditions';
import { getFormat } from '@/domain/formats';
import { optimize, type Goal, type KoGoal, type SurviveGoal } from '@/domain/optimizer';
import { createSet } from '@/domain/team';
import type { Dataset, PokemonSet, StatTable } from '@/domain/types';

const dex = new Dex(champions as unknown as Dataset);
const fmt = getFormat('champions-vgc-reg-mc');
const mk = (species: string, patch: Partial<PokemonSet> = {}): PokemonSet => ({ ...createSet(dex, species, fmt), ...patch });
const sum = (t: StatTable) => t.hp + t.atk + t.def + t.spa + t.spd + t.spe;
const field = defaultField();

const incineroar = mk('incineroar', { nature: 'Adamant', abilityId: 'intimidate', moves: ['flareblitz', 'fakeout', '', ''] });
const garchomp = mk('garchomp', { nature: 'Jolly', abilityId: 'roughskin', sp: { hp: 0, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 }, moves: ['earthquake', 'dragonclaw', '', ''] });
const dragapult = mk('dragapult', { nature: 'Timid', abilityId: 'clearbody', sp: { hp: 0, atk: 0, def: 0, spa: 32, spd: 0, spe: 32 }, moves: ['shadowball', 'dracometeor', '', ''] });

function passSurvive(set: PokemonSet, g: SurviveGoal, hp: number, d: number): boolean {
  const cat = dex.move(g.moveId)!.category === 'Special' ? 'spd' : 'def';
  const mine = { ...set, sp: { hp, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, [cat]: d } };
  const r = calcMoves(dex, { set: { ...g.attacker, moves: [g.moveId, '', '', ''] }, cond: defaultSide(false) }, { set: mine, cond: defaultSide(false) }, field, [!!g.crit])[0];
  return Math.min(...r.forms.map((f) => f.rolls.filter((x) => x < f.defenderCurHP).length)) >= g.rolls;
}

/** Cheapest hp + defence by trying every pair within the caps. */
function bruteSurvive(set: PokemonSet, g: SurviveGoal, total: number, per: number): number {
  let best = Infinity;
  for (let h = 0; h <= per; h++) for (let d = 0; d <= per; d++) if (h + d <= total && h + d < best && passSurvive(set, g, h, d)) best = h + d;
  return best;
}

const baseOpts = { field, nature: { mode: 'fixed' as const } };

const dragapultMe = mk('dragapult', { nature: 'Timid', moves: ['shadowball', '', '', ''] });
const gengarMe = mk('gengar', { nature: 'Timid', moves: ['shadowball', '', '', ''] });
const kingambitAtk = mk('kingambit', { nature: 'Adamant', abilityId: 'defiant', sp: { hp: 0, atk: 32, def: 0, spa: 0, spd: 0, spe: 0 }, moves: ['suckerpunch', 'ironhead', '', ''] });
const specsDragapult = { ...dragapult, nature: 'Modest', itemId: 'choicespecs' };

describe('optimiser vs brute force (small caps)', () => {
  const cases: { name: string; set: PokemonSet; g: SurviveGoal }[] = [];
  for (const rolls of [16, 15, 8]) {
    cases.push({ name: `physical crit ${rolls}`, set: incineroar, g: { kind: 'survive', attacker: garchomp, moveId: 'earthquake', rolls, crit: true } });
    cases.push({ name: `physical vs fragile ${rolls}`, set: dragapultMe, g: { kind: 'survive', attacker: garchomp, moveId: 'dragonclaw', rolls } });
    cases.push({ name: `sucker punch ${rolls}`, set: dragapultMe, g: { kind: 'survive', attacker: kingambitAtk, moveId: 'suckerpunch', rolls } });
    cases.push({ name: `special ${rolls}`, set: gengarMe, g: { kind: 'survive', attacker: dragapult, moveId: 'shadowball', rolls } });
    cases.push({ name: `special mirror ${rolls}`, set: dragapultMe, g: { kind: 'survive', attacker: dragapult, moveId: 'shadowball', rolls } });
  }

  it('finds the same minimum spend for survive goals', () => {
    let nontrivial = 0;
    for (const caps of [{ total: 14, perStat: 8 }, { total: 24, perStat: 14 }]) {
      for (const c of cases) {
        const expected = bruteSurvive(c.set, c.g, caps.total, caps.perStat);
        const res = optimize(dex, fmt, c.set, [c.g], { ...baseOpts, caps });
        if (expected === Infinity) {
          expect(res.goals[0].met, `${c.name} ${JSON.stringify(caps)}`).toBe(false);
        } else {
          expect(res.goals[0].met, `${c.name} ${JSON.stringify(caps)}`).toBe(true);
          expect(res.spent, `${c.name} ${JSON.stringify(caps)}`).toBe(expected);
          if (expected > 0) nontrivial++;
        }
      }
    }
    expect(nontrivial).toBeGreaterThanOrEqual(6);
  });

  it('finds the least Attack for a KO goal and the least Speed for an outspeed goal', () => {
    const target = mk('kingambit', { nature: 'Adamant', sp: { hp: 32, atk: 0, def: 0, spa: 0, spd: 2, spe: 0 }, abilityId: 'defiant' });
    for (const hits of [1, 2] as const) {
      const g: KoGoal = { kind: 'ko', defender: target, moveId: 'earthquake', hits, rolls: 16 };
      let brute = Infinity;
      for (let a = 0; a <= 32; a++) {
        const r = calcMoves(dex, { set: { ...garchomp, sp: { hp: 0, atk: a, def: 0, spa: 0, spd: 0, spe: 0 }, moves: ['earthquake', '', '', ''] }, cond: defaultSide(false) }, { set: target, cond: defaultSide(false) }, field)[0];
        const ko = Math.min(...r.forms.map((f) => {
          if (hits === 1) return f.rolls.filter((x) => x >= f.defenderCurHP).length;
          let n = 0;
          for (const x of f.rolls) for (const y of f.rolls) if (x + y >= f.defenderCurHP) n++;
          return n / 16;
        }));
        if (ko >= 16) {
          brute = a;
          break;
        }
      }
      const res = optimize(dex, fmt, garchomp, [g], baseOpts);
      if (brute === Infinity) expect(res.goals[0].met).toBe(false);
      else {
        expect(res.goals[0].met).toBe(true);
        expect(res.spread.atk).toBe(brute);
        expect(res.spent).toBe(brute);
      }
    }

    const targetSpeed = calcSpeed(dex, { set: { ...garchomp, sp: { ...garchomp.sp, spe: 19 } }, cond: defaultSide(false) }, field)[0].speed;
    const res = optimize(dex, fmt, garchomp, [{ kind: 'outspeed', target: targetSpeed }], baseOpts);
    expect(res.spread.spe).toBe(20);
    const slower = optimize(dex, fmt, garchomp, [{ kind: 'outspeed', target: targetSpeed }], { ...baseOpts, caps: { perStat: 10 } });
    expect(slower.goals[0].met).toBe(false);
    expect(slower.goals[0].shortfall).toMatch(/short by \d+ Speed/);
  });
});

describe('caps, budget and unreachable goals', () => {
  it('never exceeds the per-stat or total caps', () => {
    const goals: Goal[] = [
      { kind: 'survive', attacker: garchomp, moveId: 'earthquake', rolls: 16 },
      { kind: 'survive', attacker: dragapult, moveId: 'shadowball', rolls: 16 },
      { kind: 'outspeed', target: 150 },
      { kind: 'ko', defender: mk('kingambit', { sp: { hp: 32, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } }), moveId: 'flareblitz', hits: 2, rolls: 16 },
    ];
    for (const leftover of [undefined, { kind: 'stat', stat: 'atk' } as const, { kind: 'bulkSplit' } as const]) {
      const res = optimize(dex, fmt, incineroar, goals, { ...baseOpts, leftover });
      for (const v of Object.values(res.spread)) expect(v).toBeLessThanOrEqual(32);
      expect(sum(res.spread)).toBeLessThanOrEqual(66);
      expect(res.spent).toBe(sum(res.spread));
      expect(res.unspent).toBe(66 - sum(res.spread));
    }
  });

  it('reports an unreachable goal with how short it falls', () => {
    const g: SurviveGoal = { kind: 'survive', attacker: specsDragapult, moveId: 'shadowball', rolls: 16, crit: true };
    const res = optimize(dex, fmt, gengarMe, [g], baseOpts);
    expect(res.goals[0].met).toBe(false);
    expect(res.goals[0].shortfall).toMatch(/short by [\d.]+% even at max HP and SpD: consider Assault Vest/);
    const some: SurviveGoal = { ...g, rolls: 15 };
    expect(optimize(dex, fmt, gengarMe, [some], baseOpts).goals[0].shortfall).toMatch(/only \d+ of 16 rolls survive even at max HP and SpD \(need 15\)/);
  });

  it('drops the lowest-priority goal that does not fit and says how many points it needs', () => {
    const per = 16;
    const g1: SurviveGoal = { kind: 'survive', attacker: dragapult, moveId: 'shadowball', rolls: 16 };
    const g2: SurviveGoal = { kind: 'survive', attacker: kingambitAtk, moveId: 'suckerpunch', rolls: 16 };
    const survivesAll = (set: PokemonSet, goals: SurviveGoal[]) =>
      goals.every((g) => {
        const r = calcMoves(dex, { set: { ...g.attacker, moves: [g.moveId, '', '', ''] }, cond: defaultSide(false) }, { set, cond: defaultSide(false) }, field)[0];
        return Math.min(...r.forms.map((f) => f.rolls.filter((x) => x < f.defenderCurHP).length)) >= g.rolls;
      });
    let alone = Infinity;
    let together = Infinity;
    for (let h = 0; h <= per; h++) for (let d = 0; d <= per; d++) for (let s = 0; s <= per; s++) {
      const set = { ...dragapultMe, sp: { hp: h, atk: 0, def: d, spa: 0, spd: s, spe: 0 } };
      if (survivesAll(set, [g1]) && h + s < alone) alone = h + s;
      if (survivesAll(set, [g1, g2]) && h + d + s < together) together = h + d + s;
    }
    expect(alone).toBeLessThan(together);
    expect(together).toBeLessThan(Infinity);
    const caps = { total: alone, perStat: per };
    const res = optimize(dex, fmt, dragapultMe, [g1, g2], { ...baseOpts, caps });
    expect(res.goals[0].met).toBe(true);
    expect(res.goals[1].met).toBe(false);
    expect(res.goals[1].shortfall).toBe(`needs ${together - alone} more SP than you have`);
    expect(res.spent).toBeLessThanOrEqual(alone);
  });
});

describe('natures', () => {
  it('suggests a Speed nature when the fixed one cannot reach the target, never lowering a goal stat', () => {
    const max = calcSpeed(dex, { set: { ...incineroar, nature: 'Adamant', sp: { ...incineroar.sp, spe: 32 } }, cond: defaultSide(false) }, field)[0].speed;
    const goals: Goal[] = [{ kind: 'outspeed', target: max + 2 }];
    const fixed = optimize(dex, fmt, incineroar, goals, { ...baseOpts, nature: { mode: 'fixed' } });
    expect(fixed.goals[0].met).toBe(false);
    const suggested = optimize(dex, fmt, incineroar, goals, { ...baseOpts, nature: { mode: 'suggest' } });
    expect(suggested.goals[0].met).toBe(true);
    expect(suggested.natureChanged).toBe(true);
    const n = dex.nature(suggested.nature)!;
    expect(n.plus).toBe('spe');
    expect(n.minus).not.toBe('spe');
    // It prefers a nature that doesn't cost the set's own attacking stat.
    expect(n.minus).not.toBe('atk');
  });

  it('keeps the current nature when it is enough', () => {
    const res = optimize(dex, fmt, incineroar, [{ kind: 'survive', attacker: garchomp, moveId: 'earthquake', rolls: 16 }], { ...baseOpts, nature: { mode: 'suggest' } });
    expect(res.goals[0].met).toBe(true);
    expect(res.spent).toBeLessThanOrEqual(optimize(dex, fmt, incineroar, [{ kind: 'survive', attacker: garchomp, moveId: 'earthquake', rolls: 16 }], baseOpts).spent);
  });
});

describe('several goals at once', () => {
  it('physical bulk + special bulk + speed all hold at the final spread', () => {
    const goals: Goal[] = [
      { kind: 'survive', attacker: garchomp, moveId: 'earthquake', rolls: 15 },
      { kind: 'survive', attacker: dragapult, moveId: 'shadowball', rolls: 15 },
      { kind: 'outspeed', target: 100 },
    ];
    const res = optimize(dex, fmt, incineroar, goals, { ...baseOpts, leftover: { kind: 'stat', stat: 'atk' } });
    expect(res.goals.every((g) => g.met)).toBe(true);
    const mine = { ...incineroar, sp: res.spread, nature: res.nature };
    expect(passSurvive({ ...mine, sp: { ...res.spread } }, goals[0] as SurviveGoal, res.spread.hp, res.spread.def)).toBe(true);
    expect(calcSpeed(dex, { set: mine, cond: defaultSide(false) }, field)[0].speed).toBeGreaterThan(100);
    expect(res.spread.atk).toBeGreaterThan(0);
    expect(res.spent).toBeLessThanOrEqual(66);
    expect(res.goals[0].text).toContain('Earthquake');
  });

  it('puts leftovers where asked: one stat, or max HP then an even split', () => {
    const one = optimize(dex, fmt, incineroar, [], { ...baseOpts, leftover: { kind: 'stat', stat: 'spe' } });
    expect(one.spread).toMatchObject({ spe: 32 });
    expect(one.unspent).toBe(34);
    const split = optimize(dex, fmt, incineroar, [], { ...baseOpts, leftover: { kind: 'bulkSplit' } });
    expect(split.spread.hp).toBe(32);
    expect(split.spent).toBe(66);
    const others = [split.spread.def, split.spread.spd, split.spread.atk, split.spread.spa, split.spread.spe];
    expect(Math.max(...others) - Math.min(...others)).toBeLessThanOrEqual(1);
  });
});

describe('EV format (Gen 9)', () => {
  const dex9 = new Dex(unpackDataset(gen9));
  const fmt9 = getFormat('gen9');
  const mk9 = (id: string, patch: Partial<PokemonSet> = {}): PokemonSet => ({ ...createSet(dex9, id, fmt9), ...patch });
  it('works in steps of 4 with a 510 total', () => {
    const me = mk9('corviknight', { nature: 'Impish', abilityId: 'pressure', level: 100 });
    const atk = mk9('garchomp', { nature: 'Jolly', abilityId: 'roughskin', level: 100, evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 }, moves: ['earthquake', '', '', ''] });
    const goals: Goal[] = [
      { kind: 'survive', attacker: atk, moveId: 'dragonclaw', rolls: 16 },
      { kind: 'outspeed', target: 150 },
    ];
    const res = optimize(dex9, fmt9, me, goals, { field: { ...field, gameType: 'Singles' }, nature: { mode: 'fixed' } });
    for (const v of Object.values(res.spread)) {
      expect(v % 4).toBe(0);
      expect(v).toBeLessThanOrEqual(252);
    }
    expect(sum(res.spread)).toBeLessThanOrEqual(510);
    expect(res.cap).toBe(510);
    for (const g of res.goals) expect(g.met || !!g.shortfall).toBe(true);
    // The result checks out when the calculator is asked directly.
    const spe = calcSpeed(dex9, { set: { ...me, evs: res.spread }, cond: defaultSide(false) }, field)[0].speed;
    expect(res.goals[1].met).toBe(spe > 150);
  });
});
