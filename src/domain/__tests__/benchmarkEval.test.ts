import { describe, expect, it } from 'vitest';
import data from '@/data/generated/champions.json';
import metaJson from '@/data/generated/meta.json';
import { Dex } from '@/data/dex';
import { defaultField, defaultSide } from '@/domain/battle/conditions';
import { benchSetOf, benchmarkFromGoal, brokenCount, evaluateBenchmarks, foeFromSet, resolveFoe, setOfBench } from '@/domain/benchmarkEval';
import type { Benchmark } from '@/domain/benchmarks';
import { getFormat } from '@/domain/formats';
import { metaSet } from '@/domain/metaSets';
import { parseMetaFile } from '@/domain/meta';
import { createSet } from '@/domain/team';
import type { Dataset, PokemonSet } from '@/domain/types';

const dex = new Dex(data as unknown as Dataset);
const fmt = getFormat('champions-vgc-reg-mb');
// An ended regulation: its Smogon numbers no longer change, so these tests do not move with the daily data.
const snapshot = parseMetaFile(metaJson).regulations['champions-reg-mb'];
const sp = (o: Partial<PokemonSet['sp']>) => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...o });
const mk = (species: string, patch: Partial<PokemonSet> = {}): PokemonSet => ({ ...createSet(dex, species, fmt), ...patch });
const base = { id: 'b', savedAt: Date.parse('2026-10-05T12:00:00Z'), metAtSave: true };
const gengar = benchSetOf(mk('gengar', { nature: 'Timid', sp: sp({ spa: 32, spe: 32 }) }), fmt);
const foe = { speciesId: 'gengar', source: 'custom' as const, set: gengar };

describe('damage benchmarks', () => {
  it('my OHKO benchmark holds with a strong move and fails with a weak one', () => {
    const me = mk('garchomp', { nature: 'Jolly', itemId: undefined, abilityId: 'roughskin', sp: sp({ atk: 32, spe: 32 }), moves: ['earthquake', 'dragonclaw', '', ''] });
    const eq: Benchmark = { ...base, id: 'eq', kind: 'ko', foe, moveId: 'earthquake', hits: 1, rolls: 16 };
    const dc: Benchmark = { ...base, id: 'dc', kind: 'ko', foe, moveId: 'dragonclaw', hits: 1, rolls: 16 };
    const [a, b] = evaluateBenchmarks(dex, fmt, me, [eq, dc], snapshot);
    expect(a).toMatchObject({ status: 'met', label: 'OHKO Gengar with Earthquake' });
    expect(b.status).toBe('notmet');
    expect(b.text.length).toBeGreaterThan(0);
  });

  it('a survive benchmark follows the spread: more bulk, and it holds', () => {
    const hit: Benchmark = { ...base, kind: 'survive', foe: { speciesId: 'garchomp', source: 'custom', set: benchSetOf(mk('garchomp', { nature: 'Adamant', sp: sp({ atk: 32 }) }), fmt) }, moveId: 'dragonclaw', rolls: 16 };
    const frail = mk('gengar', { sp: sp({}) });
    const bulky = mk('gengar', { sp: sp({ hp: 32, def: 32 }) });
    const [weak] = evaluateBenchmarks(dex, fmt, frail, [hit], snapshot);
    const [strong] = evaluateBenchmarks(dex, fmt, bulky, [hit], snapshot);
    expect(weak.status).toBe('notmet');
    expect(strong.status).toBe('met');
  });

  it('a Speed benchmark follows Speed investment and Tailwind', () => {
    const chomp = { speciesId: 'garchomp', source: 'custom' as const, set: benchSetOf(mk('garchomp', { nature: 'Jolly', sp: sp({ spe: 32 }) }), fmt) };
    const race: Benchmark = { ...base, kind: 'outspeed', foe: chomp, scenario: {} };
    const slow = mk('whimsicott', { nature: 'Relaxed', sp: sp({}) });
    const fast = mk('whimsicott', { nature: 'Timid', sp: sp({ spe: 32 }) });
    expect(evaluateBenchmarks(dex, fmt, slow, [race], snapshot)[0].status).toBe('notmet');
    expect(evaluateBenchmarks(dex, fmt, fast, [race], snapshot)[0].status).toBe('met');
    // Their Tailwind doubles what has to be beaten; mine undoes it.
    const theirTailwind: Benchmark = { ...race, scenario: { tailwind: true } };
    expect(evaluateBenchmarks(dex, fmt, fast, [theirTailwind], snapshot)[0].status).toBe('notmet');
    expect(evaluateBenchmarks(dex, fmt, fast, [{ ...theirTailwind, scenario: { tailwind: true, myTailwind: true } }], snapshot)[0].status).toBe('met');
    // Trick Room: staying slower.
    const tr: Benchmark = { ...race, scenario: { trickRoom: true } };
    expect(evaluateBenchmarks(dex, fmt, slow, [tr], snapshot)[0].status).toBe('met');
    expect(evaluateBenchmarks(dex, fmt, fast, [tr], snapshot)[0].status).toBe('notmet');
  });
});

describe("can't check", () => {
  const me = mk('garchomp', { moves: ['earthquake', '', '', ''] });
  const ask = (b: Partial<Benchmark> & Record<string, unknown>, withSnapshot = true) => evaluateBenchmarks(dex, fmt, me, [{ ...base, kind: 'survive', foe: { speciesId: 'garchomp', source: 'meta' }, moveId: 'earthquake', rolls: 16, ...b } as Benchmark], withSnapshot ? snapshot : undefined)[0];

  it('says why: a species not in the regulation, no usage data, a move that is not legal, an unknown species', () => {
    expect(ask({ foe: { speciesId: 'garchomp', source: 'meta' } }, false)).toMatchObject({ status: 'cant', text: expect.stringContaining('no usage data') });
    expect(ask({ foe: { speciesId: 'notamon', source: 'meta' } }).text).toMatch(/not in this game/);
    expect(ask({ moveId: 'notamove', foe }).text).toMatch(/not a move/);
    // Reg M-B does not have Reg M-C's additions: Squawkabilly came in with M-C.
    const squawk = ask({ foe: { speciesId: 'squawkabilly', source: 'meta' } });
    expect(squawk).toMatchObject({ status: 'cant' });
    expect(squawk.text).toMatch(/not legal in Reg M-B/);
    expect(resolveFoe(dex, fmt, { speciesId: 'squawkabilly', source: 'meta' }, snapshot).cant).toMatch(/Squawkabilly/);
  });

  it('cannot check anything for a format without Stat Points or EVs', () => {
    const gen1 = getFormat('gen1');
    expect(gen1.datasetId).toBe('gen1');
    const r = evaluateBenchmarks(dex, gen1, me, [{ ...base, kind: 'outspeed', foe: { speciesId: 'garchomp', source: 'meta' }, scenario: {} } as Benchmark], snapshot);
    expect(r[0].status).toBe('cant');
  });
});

describe('what changed since it was saved', () => {
  it('says what changed in the other Pokémon\'s most-used set when a benchmark that held no longer does', () => {
    const entry = snapshot.entries[0];
    const species = entry.speciesId;
    const ms = metaSet(entry, dex, fmt)!;
    const frail = mk('kommoo', { nature: 'Hardy', sp: sp({}), itemId: undefined });
    // The first damaging move this foe runs that a frail Kommo-o does not survive.
    const move = ms.set.moves.find((m) => m && dex.move(m)?.category !== 'Status')!;
    const b: Benchmark = { ...base, kind: 'survive', foe: { speciesId: species, source: 'meta' }, moveId: move, rolls: 16, crit: true, cond: { foe: { stage: 0 } }, seen: { itemId: 'zzzfakeitem', abilityId: ms.set.abilityId, nature: ms.set.nature, spread: Object.values(ms.set.sp) } };
    const [r] = evaluateBenchmarks(dex, fmt, frail, [b], snapshot);
    if (r.status === 'notmet') {
      expect(r.change).toMatch(/^Met when saved on 5 Oct 2026; now not met: /);
      expect(r.change).toContain('most-used item is now');
      expect(brokenCount([r], [b])).toBe(1);
    } else {
      // The move was weak enough to survive: then nothing drifted.
      expect(r.change).toBeUndefined();
    }
  });

  it('a benchmark that did not hold and now does is noted, and one that was never met and still is not is quiet', () => {
    const chomp = { speciesId: 'garchomp', source: 'custom' as const, set: benchSetOf(mk('garchomp', { nature: 'Jolly', sp: sp({ spe: 32 }) }), fmt) };
    const fast = mk('whimsicott', { nature: 'Timid', sp: sp({ spe: 32 }) });
    const slow = mk('whimsicott', { nature: 'Relaxed', sp: sp({}) });
    const was: Benchmark = { ...base, metAtSave: false, kind: 'outspeed', foe: chomp, scenario: {} };
    expect(evaluateBenchmarks(dex, fmt, fast, [was], snapshot)[0].change).toMatch(/^Not met when saved on 5 Oct 2026; met now/);
    expect(evaluateBenchmarks(dex, fmt, slow, [was], snapshot)[0].change).toBeUndefined();
    expect(brokenCount(evaluateBenchmarks(dex, fmt, slow, [was], snapshot), [was])).toBe(0);
  });
});

describe('from a goal', () => {
  const me = mk('kommoo');
  it('a goal made from the most-used set is a meta benchmark, a tweaked one is custom', () => {
    const entry = snapshot.entries[0];
    const ms = metaSet(entry, dex, fmt)!;
    const goal = { kind: 'survive' as const, attacker: ms.set, moveId: ms.set.moves.find((m) => m && dex.move(m)?.category !== 'Status')!, rolls: 16 };
    const b = benchmarkFromGoal(dex, fmt, goal, { snapshot, met: true, now: 1 })!;
    expect(b).toMatchObject({ kind: 'survive', metAtSave: true, savedAt: 1, foe: { speciesId: entry.speciesId, source: 'meta' } });
    expect(b.seen?.nature).toBe(ms.set.nature);
    const tweaked = benchmarkFromGoal(dex, fmt, { ...goal, attacker: { ...ms.set, nature: ms.set.nature === 'Hardy' ? 'Bold' : 'Hardy' } }, { snapshot, met: false })!;
    expect(tweaked.foe.source).toBe('custom');
    expect(tweaked.foe.set?.speciesId).toBe(entry.speciesId);
    expect(tweaked.metAtSave).toBe(false);
    expect(foeFromSet(dex, fmt, ms.set, undefined).source).toBe('custom');
  });

  it('keeps conditions that are not the default, and only those', () => {
    const attacker = mk('garchomp');
    const plain = benchmarkFromGoal(dex, fmt, { kind: 'survive', attacker, moveId: 'earthquake', rolls: 16, attackerCond: defaultSide(false) }, { met: true })!;
    expect(plain.cond).toBeUndefined();
    const rain = benchmarkFromGoal(dex, fmt, { kind: 'survive', attacker, moveId: 'earthquake', rolls: 15, crit: true, attackerCond: { ...defaultSide(false), tailwind: true } }, { field: { ...defaultField(), weather: 'Rain', trickRoom: true }, myCond: { ...defaultSide(false), tailwind: true }, met: true })!;
    expect(rain).toMatchObject({ rolls: 15, crit: true, cond: { field: { weather: 'Rain', trickRoom: true }, foe: { tailwind: true }, mine: { tailwind: true } } });
  });

  it('a Speed goal needs to say who it is about', () => {
    expect(benchmarkFromGoal(dex, fmt, { kind: 'outspeed', target: 150, label: 'x' }, { met: true })).toBeUndefined();
    const b = benchmarkFromGoal(dex, fmt, { kind: 'outspeed', target: 150, mode: 'under', foe: { speciesId: 'sneasler', source: 'meta' }, scenario: { tailwind: true, scarf: true } }, { met: true, myCond: { ...defaultSide(false), tailwind: true } })!;
    expect(b).toMatchObject({ kind: 'outspeed', foe: { speciesId: 'sneasler', source: 'meta' }, scenario: { tailwind: true, scarf: true, myTailwind: true, trickRoom: true } });
  });

  it('a custom foe round-trips through a benchmark set', () => {
    const set = mk('kingambit', { nature: 'Adamant', sp: sp({ hp: 32, atk: 32 }), moves: ['suckerpunch', 'ironhead', '', ''] });
    const back = setOfBench(dex, fmt, benchSetOf(set, fmt));
    expect(back).toMatchObject({ speciesId: 'kingambit', nature: 'Adamant', sp: sp({ hp: 32, atk: 32 }), moves: ['suckerpunch', 'ironhead', '', ''] });
    expect(me.speciesId).toBe('kommoo');
  });
});
