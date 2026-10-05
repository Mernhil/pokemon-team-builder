import { describe, expect, it } from 'vitest';
import { MAX_BENCHMARKS, benchmarkKey, mergeBenchmarks, sanitizeBenchmarks, type Benchmark } from '@/domain/benchmarks';
import { sanitizeSet, sanitizeTeam } from '@/domain/sanitize';

const survive = (over: Partial<Benchmark> = {}): Benchmark =>
  ({ id: 'b1', kind: 'survive', savedAt: 1, metAtSave: true, foe: { speciesId: 'garchomp', source: 'meta' }, moveId: 'earthquake', rolls: 16, ...over }) as Benchmark;

describe('sanitizeBenchmarks', () => {
  it('keeps a valid benchmark of each kind', () => {
    const list = sanitizeBenchmarks([
      survive({ crit: true, cond: { field: { weather: 'Rain' }, foe: { megaMode: 'mega' } } }),
      { id: 'b2', kind: 'ko', savedAt: 2, metAtSave: false, foe: { speciesId: 'kingambit', source: 'custom', set: { speciesId: 'kingambit', nature: 'Adamant', moves: ['suckerpunch'], spread: [32, 32, 0, 0, 0, 2] } }, moveId: 'closecombat', hits: 2, rolls: 15 },
      { id: 'b3', kind: 'outspeed', savedAt: 3, metAtSave: true, foe: { speciesId: 'fluttermane', source: 'meta' }, scenario: { tailwind: true, stage: 1, scarf: true } },
    ])!;
    expect(list.map((b) => b.kind)).toEqual(['survive', 'ko', 'outspeed']);
    expect(list[0]).toMatchObject({ crit: true, cond: { field: { weather: 'Rain' }, foe: { megaMode: 'mega' } } });
    expect(list[2]).toMatchObject({ scenario: { tailwind: true, stage: 1, scarf: true } });
  });

  it('drops what is not valid and never throws', () => {
    expect(sanitizeBenchmarks(undefined)).toBeUndefined();
    expect(sanitizeBenchmarks('x')).toBeUndefined();
    expect(sanitizeBenchmarks([null, 5, {}, { id: 'a b', kind: 'survive' }, survive({ id: 'ok', moveId: 'Not An Id' as never })])).toBeUndefined();
    // A custom foe without a set, an unknown kind, rolls out of range.
    expect(sanitizeBenchmarks([survive({ foe: { speciesId: 'x', source: 'custom' } }), { ...survive(), kind: 'weird' }])).toBeUndefined();
    expect(sanitizeBenchmarks([survive({ rolls: 99 })])![0]).toMatchObject({ rolls: 16 });
  });

  it('caps the list, drops repeated ids and bad condition values', () => {
    const many = Array.from({ length: 20 }, (_, i) => survive({ id: `b${i}` }));
    expect(sanitizeBenchmarks(many)).toHaveLength(MAX_BENCHMARKS);
    expect(sanitizeBenchmarks([survive(), survive()])).toHaveLength(1);
    const odd = sanitizeBenchmarks([survive({ cond: { field: { weather: 'Meteors' as never, trickRoom: true }, foe: { stage: 99, megaMode: 'huge' as never } } })])![0];
    expect(odd.cond).toEqual({ field: { trickRoom: true }, foe: { stage: 6 } });
  });
});

describe('merging', () => {
  it('a benchmark that asks the same thing replaces the older one; the oldest go past the limit', () => {
    const a = survive({ id: 'old' });
    const b = survive({ id: 'new', savedAt: 9 });
    expect(benchmarkKey(a)).toBe(benchmarkKey(b));
    expect(mergeBenchmarks([a], [b]).map((x) => x.id)).toEqual(['new']);
    const full = Array.from({ length: MAX_BENCHMARKS }, (_, i) => survive({ id: `x${i}`, moveId: `move${i}` }));
    const merged = mergeBenchmarks(full, [survive({ id: 'fresh', moveId: 'thunderbolt' })]);
    expect(merged).toHaveLength(MAX_BENCHMARKS);
    expect(merged.at(-1)!.id).toBe('fresh');
    expect(merged[0].id).toBe('x1');
  });
});

describe('through the set and team sanitisers', () => {
  const set = { speciesId: 'garchomp', uid: 'u1', moves: ['earthquake', '', '', ''], notes: ' why this spread ', benchmarks: [survive()] };
  it('keeps notes and benchmarks on a set, trimmed and limited', () => {
    const s = sanitizeSet(set)!;
    expect(s.notes).toBe('why this spread');
    expect(s.benchmarks).toHaveLength(1);
    expect(sanitizeSet({ ...set, notes: 'n'.repeat(900), benchmarks: 'nope' })!.notes).toHaveLength(300);
    expect(sanitizeSet({ ...set, notes: '   ', benchmarks: [] })).toMatchObject({ notes: undefined, benchmarks: undefined });
  });

  it('keeps matchup notes, only with leads that are on the team', () => {
    const team = sanitizeTeam({
      id: 't', name: 'T', formatId: 'champions-vgc-reg-mc', slots: [set, null, null, null, null, null],
      matchupNotes: [
        { id: 'm1', title: 'vs Rain', leads: ['u1', 'ghost'], text: 'Lead Garchomp.' },
        { id: 'm1', title: 'dup', text: 'x' },
        { id: 'm2', title: '', text: 'no title' },
        { id: 'm3', title: 'vs Sun', text: 't'.repeat(900) },
      ],
    })!;
    expect(team.matchupNotes).toHaveLength(2);
    expect(team.matchupNotes![0]).toEqual({ id: 'm1', title: 'vs Rain', leads: ['u1'], text: 'Lead Garchomp.' });
    expect(team.matchupNotes![1].text).toHaveLength(500);
    expect(sanitizeTeam({ id: 't', name: 'T', formatId: 'x', slots: [], matchupNotes: 'x' })!.matchupNotes).toBeUndefined();
  });
});
