import { describe, expect, it } from 'vitest';
import data from '@/data/generated/champions.json';
import metaJson from '@/data/generated/meta.json';
import { Dex } from '@/data/dex';
import { calcSpeed } from '@/domain/battle/damage';
import { defaultField, defaultSide } from '@/domain/battle/conditions';
import { getFormat } from '@/domain/formats';
import { parseMetaFile, type MetaEntry, type MetaSnapshot } from '@/domain/meta';
import {
  SCARF_ID,
  buildLadder,
  describePlan,
  metaVariants,
  neutralScenario,
  pickSpeedSnapshot,
  planOutspeed,
  type SpeedScenario,
} from '@/domain/speedTiers';
import { createSet } from '@/domain/team';
import type { Dataset, PokemonSet } from '@/domain/types';

const dex = new Dex(data as unknown as Dataset);
const fmt = getFormat('champions-vgc-reg-mc');
const meta = parseMetaFile(metaJson);
const snapshot = meta.regulations['champions-reg-mb'];

const mk = (species: string, patch: Partial<PokemonSet> = {}): PokemonSet => ({ ...createSet(dex, species, fmt), ...patch });
const sp = (spe: number) => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe });
const entry = (speciesId: string, patch: Partial<MetaEntry> = {}): MetaEntry => ({
  speciesId,
  usagePct: 50,
  abilities: [],
  items: [],
  moves: [],
  teammates: [],
  spreads: [{ nature: 'Jolly', values: [0, 0, 0, 0, 0, 32], pct: 60 }],
  ...patch,
});
const snap = (entries: MetaEntry[], over: Partial<MetaSnapshot> = {}): MetaSnapshot => ({
  regulationId: 'champions-reg-mc',
  updatedAt: '2026-09-28',
  source: { name: 'test', month: '2026-08' },
  entries,
  ...over,
});
const speedOf = (set: PokemonSet, mode: 'base' | 'mega' = 'base', cond = {}, field = {}) =>
  calcSpeed(dex, { set, cond: { ...defaultSide(), megaMode: mode, ...cond } }, { ...defaultField(), ...field })[0].speed;

describe('meta variants', () => {
  it('match the Damage Calc Speed for real meta species', () => {
    const variants = metaVariants(snapshot, dex, fmt, 3);
    expect(variants.length).toBeGreaterThanOrEqual(3);
    for (const v of variants.filter((x) => !x.hasMega)) {
      const expected = calcSpeed(dex, { set: v.set, cond: { ...defaultSide(), megaMode: 'base' } }, defaultField())[0].speed;
      const row = buildLadder(dex, [v], [], neutralScenario()).find((r) => r.variantKey === v.key)!;
      expect(row.speed).toBe(expected);
      expect(row.speed).toBeGreaterThan(0);
    }
  });

  it('merges spreads with the same Speed and keeps the species\' share', () => {
    const e = entry('garchomp', {
      spreads: [
        { nature: 'Jolly', values: [2, 32, 0, 0, 0, 32], pct: 30 },
        { nature: 'Jolly', values: [10, 24, 0, 0, 0, 32], pct: 20 },
        { nature: 'Adamant', values: [0, 32, 0, 0, 2, 0], pct: 15 },
      ],
    });
    const v = metaVariants(snap([e]), dex, fmt);
    expect(v).toHaveLength(2);
    expect(v[0].spreadPct).toBe(50);
    expect(v[0].label).toBe('32 Spe Jolly');
    expect(v[1].label).toBe('0 Spe Adamant');
  });

  it('adds a Choice Scarf row only from 10% of sets', () => {
    const items = (scarf: number) => [{ id: 'sitrusberry', pct: 60 }, { id: SCARF_ID, pct: scarf }];
    const low = metaVariants(snap([entry('garchomp', { items: items(9.9) })]), dex, fmt);
    const high = metaVariants(snap([entry('garchomp', { items: items(10) })]), dex, fmt);
    expect(low.some((v) => v.scarf)).toBe(false);
    const scarf = high.find((v) => v.scarf)!;
    expect(scarf).toBeDefined();
    const main = high.find((v) => !v.scarf)!;
    expect(speedOf(scarf.set)).toBe(Math.floor(speedOf(main.set) * 1.5));
    expect(scarf.label).toMatch(/^Scarf/);
  });

  it('gives a Mega Stone holder its Mega forme\'s Speed as well', () => {
    const v = metaVariants(snap([entry('garchomp', { items: [{ id: 'garchompite', pct: 80 }] })]), dex, fmt);
    expect(v[0].hasMega).toBe(true);
    const rows = buildLadder(dex, v, [], neutralScenario());
    const base = rows.find((r) => r.forme === 'base')!;
    const mega = rows.find((r) => r.forme === 'mega')!;
    expect(mega.name).toBe('Garchomp-Mega');
    expect(mega.speed).toBe(speedOf(v[0].set, 'mega'));
    expect(mega.speed).not.toBe(base.speed);
  });

  it('skips species without spread data and counts only the rest toward N', () => {
    const v = metaVariants(snap([entry('garchomp', { spreads: [] }), entry('incineroar'), entry('kingambit')]), dex, fmt, 2);
    expect(new Set(v.map((x) => x.speciesId))).toEqual(new Set(['incineroar', 'kingambit']));
  });
});

describe('ladder', () => {
  const mine = [
    { slot: 0, set: mk('garchomp', { nature: 'Jolly', sp: sp(32), itemId: 'garchompite', abilityId: 'roughskin' }) },
    { slot: 1, set: mk('incineroar', { nature: 'Adamant', sp: sp(0) }) },
  ];
  const variants = metaVariants(snap([entry('kingambit'), entry('incineroar', { spreads: [{ nature: 'Adamant', values: [0, 0, 0, 0, 0, 0], pct: 50 }] })]), dex, fmt);

  it('sorts fastest first, and slowest first in Trick Room', () => {
    const normal = buildLadder(dex, variants, mine, neutralScenario()).map((r) => r.speed);
    expect(normal).toEqual([...normal].sort((a, b) => b - a));
    const tr = buildLadder(dex, variants, mine, { ...neutralScenario(), trickRoom: true }).map((r) => r.speed);
    expect(tr).toEqual([...tr].sort((a, b) => a - b));
    expect(tr).toEqual([...normal].reverse());
  });

  it('puts both formes of my Mega holder on the ladder', () => {
    const rows = buildLadder(dex, [], mine, neutralScenario()).filter((r) => r.slot === 0);
    expect(rows.map((r) => r.forme).sort()).toEqual(['base', 'mega']);
  });

  it('flags ties with my own Pokémon', () => {
    // Meta Incineroar (0 SP Adamant) and mine (0 SP Adamant) have exactly the same Speed.
    const rows = buildLadder(dex, variants, mine, neutralScenario());
    const inc = rows.filter((r) => r.speciesId === 'incineroar');
    expect(inc).toHaveLength(2);
    expect(inc.every((r) => r.tie)).toBe(true);
    expect(rows.filter((r) => r.speciesId === 'kingambit').every((r) => !r.tie)).toBe(true);
  });

  const scen = (patch: Partial<SpeedScenario>): SpeedScenario => ({ ...neutralScenario(), ...patch });
  const mineSpeed = (s: SpeedScenario, slot = 1) => buildLadder(dex, [], mine, s).find((r) => r.slot === slot)!.speed;
  const theirSpeed = (s: SpeedScenario) => buildLadder(dex, variants, [], s).find((r) => r.speciesId === 'kingambit')!.speed;

  it('applies each side\'s own modifiers', () => {
    const base = mineSpeed(neutralScenario());
    expect(mineSpeed(scen({ mine: { ...neutralScenario().mine, tailwind: true } }))).toBe(base * 2);
    expect(mineSpeed(scen({ mine: { ...neutralScenario().mine, stage: -1 } }))).toBe(Math.floor((base * 2) / 3));
    expect(mineSpeed(scen({ mine: { ...neutralScenario().mine, stage: 2 } }))).toBe(base * 2);
    expect(mineSpeed(scen({ mine: { ...neutralScenario().mine, scarf: true } }))).toBe(Math.floor(base * 1.5));
    expect(mineSpeed(scen({ mine: { ...neutralScenario().mine, paralyzed: true } }))).toBe(Math.floor(base / 2));
    // Theirs untouched by my modifiers, and the other way round.
    const their = theirSpeed(neutralScenario());
    expect(theirSpeed(scen({ mine: { ...neutralScenario().mine, tailwind: true } }))).toBe(their);
    expect(theirSpeed(scen({ theirs: { ...neutralScenario().theirs, tailwind: true } }))).toBe(their * 2);
    expect(mineSpeed(scen({ theirs: { ...neutralScenario().theirs, tailwind: true } }))).toBe(base);
  });

  it('weather and terrain reach the speed abilities (Chlorophyll, Swift Swim, Surge Surfer)', () => {
    const team = [
      { slot: 0, set: mk('venusaur', { abilityId: 'chlorophyll', sp: sp(0) }) },
      { slot: 1, set: mk('basculegion', { abilityId: 'swiftswim', sp: sp(0) }) },
    ];
    const speeds = (s: SpeedScenario) => Object.fromEntries(buildLadder(dex, [], team, s).map((r) => [r.speciesId, r.speed]));
    const n = speeds(neutralScenario());
    expect(speeds(scen({ weather: 'Sun' })).venusaur).toBe(n.venusaur * 2);
    expect(speeds(scen({ weather: 'Rain' })).basculegion).toBe(n.basculegion * 2);
    expect(speeds(scen({ weather: 'Sun' })).basculegion).toBe(n.basculegion);
  });
});

describe('regulation fallback', () => {
  const mc = snapshot && { ...snapshot, regulationId: 'champions-reg-mc' };
  const lookup = (id: string) => ({ 'champions-reg-mb': snapshot, 'champions-reg-ma': meta.regulations['champions-reg-ma'] })[id as 'champions-reg-mb'];
  it('uses the wanted regulation when it has data', () => {
    const p = pickSpeedSnapshot('champions-reg-mb', ['champions-reg-mc', 'champions-reg-mb', 'champions-reg-ma'], lookup)!;
    expect(p.regulationId).toBe('champions-reg-mb');
    expect(p.fellBackFrom).toBeUndefined();
  });
  it('falls back to the newest regulation with data and says so', () => {
    const p = pickSpeedSnapshot('champions-reg-mc', ['champions-reg-mc', 'champions-reg-mb', 'champions-reg-ma'], lookup)!;
    expect(p.regulationId).toBe('champions-reg-mb');
    expect(p.fellBackFrom).toBe('champions-reg-mc');
    expect(mc).toBeDefined();
  });
  it('has nothing to show when no regulation has data', () => {
    expect(pickSpeedSnapshot('champions-reg-mc', ['champions-reg-mc'], () => undefined)).toBeUndefined();
  });
});

describe('Outspeed this', () => {
  const set = mk('incineroar', { nature: 'Adamant', sp: { hp: 32, atk: 32, def: 0, spa: 0, spd: 0, spe: 0 } });
  const n = neutralScenario();

  it('finds the least Speed Points that beat a target', () => {
    const target = speedOf({ ...set, sp: sp(0) }) + 10;
    const plan = planOutspeed(dex, fmt, set, 'base', target, n);
    expect(plan.status).toBe('reachable');
    expect(speedOf({ ...set, sp: { ...set.sp, spe: plan.sp } })).toBeGreaterThan(target);
    expect(speedOf({ ...set, sp: { ...set.sp, spe: plan.sp - 1 } })).toBeLessThanOrEqual(target);
    expect(plan.sp).toBe(11);
    expect(plan.natureChanged).toBe(false);
    expect(describePlan(plan, set, false)).toContain('11 Spe');
  });

  it('is strictly faster: matching the target is not enough', () => {
    const target = speedOf({ ...set, sp: sp(5) });
    expect(planOutspeed(dex, fmt, set, 'base', target, n).sp).toBe(6);
  });

  it('switches to a Speed nature when the current one cannot reach it', () => {
    const max = speedOf({ ...set, sp: { ...set.sp, spe: 32 } });
    const plan = planOutspeed(dex, fmt, set, 'base', max + 3, n);
    expect(plan.status).toBe('reachable');
    expect(plan.natureChanged).toBe(true);
    expect(dex.nature(plan.nature)?.plus).toBe('spe');
  });

  it('reports an unreachable target, and one that is already beaten', () => {
    expect(planOutspeed(dex, fmt, set, 'base', 9999, n).status).toBe('unreachable');
    expect(planOutspeed(dex, fmt, set, 'base', 1, n).status).toBe('already');
  });

  it('flags a plan that does not fit in the Stat Points left', () => {
    const full = { ...set, sp: { hp: 32, atk: 32, def: 0, spa: 0, spd: 0, spe: 0 } };
    const plan = planOutspeed(dex, fmt, full, 'base', speedOf({ ...full, sp: sp(0) }) + 10, n);
    expect(plan.budgetLeft).toBe(2);
    expect(plan.overBudget).toBe(true);
  });

  it('counts the scenario: Tailwind halves what is needed', () => {
    const target = speedOf({ ...set, sp: sp(0) }) + 10;
    const tw = planOutspeed(dex, fmt, set, 'base', target, { ...n, mine: { ...n.mine, tailwind: true } });
    expect(tw.status).toBe('already');
  });

  it('wants to be slower under Trick Room', () => {
    const slowest = speedOf({ ...set, nature: 'Brave', sp: sp(0) });
    const plan = planOutspeed(dex, fmt, { ...set, nature: 'Adamant', sp: { ...set.sp, spe: 20 } }, 'base', slowest + 1, { ...n, trickRoom: true });
    expect(plan.status).toBe('reachable');
    expect(plan.speed).toBeLessThan(slowest + 1);
  });
});

