import { describe, expect, it } from 'vitest';
import data from '@/data/generated/champions.json';
import metaJson from '@/data/generated/meta.json';
import { Dex } from '@/data/dex';
import { calcMoves } from '@/domain/battle/damage';
import { defaultField, defaultSide } from '@/domain/battle/conditions';
import { formatForRegulation, getFormat } from '@/domain/formats';
import { metaSet, metaSets } from '@/domain/metaSets';
import { parseMetaFile, type MetaEntry } from '@/domain/meta';
import { classifyKill, computeCell, moveChoices, ohkoEntries, runThreatRow, summarize, type ThreatJob } from '@/domain/threats';
import { createSet, createTeam } from '@/domain/team';
import type { Dataset, PokemonSet } from '@/domain/types';
import { validateTeam } from '@/domain/validation';

const dex = new Dex(data as unknown as Dataset);
const fmt = getFormat('champions-vgc-reg-mc');
const meta = parseMetaFile(metaJson);
const mk = (species: string, patch: Partial<PokemonSet> = {}): PokemonSet => ({ ...createSet(dex, species, fmt), ...patch });
const entry = (speciesId: string, patch: Partial<MetaEntry> = {}): MetaEntry => ({
  speciesId,
  usagePct: 40,
  abilities: [],
  items: [],
  moves: [],
  teammates: [],
  spreads: [{ nature: 'Jolly', values: [2, 32, 0, 0, 0, 32], pct: 50 }],
  ...patch,
});

describe('metaSet', () => {
  it('builds a legal set for every top-30 entry of each regulation with data', () => {
    for (const [regId, snap] of Object.entries(meta.regulations)) {
      const format = formatForRegulation(regId)!;
      const sets = metaSets(snap, dex, format, 30);
      expect(sets.length, regId).toBeGreaterThanOrEqual(20);
      for (const m of sets) {
        const team = { ...createTeam(format), slots: [m.set, null, null, null, null, null] as never };
        const errors = validateTeam(team, format, dex).filter((i) => i.severity === 'error');
        expect(errors, `${regId} ${m.speciesId}: ${errors.map((e) => e.message).join('; ')}`).toEqual([]);
        expect(Object.values(m.set.sp).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(66);
        const moves = m.set.moves.filter(Boolean).map((id) => dex.move(id)!);
        expect(moves.length).toBeGreaterThan(0);
        expect(moves.some((mv) => mv.category !== 'Status')).toBe(true);
      }
    }
  });

  it('uses the most common ability, item, spread and top moves', () => {
    const m = metaSet(
      entry('garchomp', {
        abilities: [{ id: 'roughskin', pct: 90 }],
        items: [{ id: 'sitrusberry', pct: 50 }, { id: 'focussash', pct: 20 }],
        moves: [{ id: 'earthquake', pct: 99 }, { id: 'dragonclaw', pct: 80 }, { id: 'protect', pct: 70 }, { id: 'rockslide', pct: 60 }, { id: 'swordsdance', pct: 5 }],
      }),
      dex,
      fmt,
    )!;
    expect(m.set.abilityId).toBe('roughskin');
    expect(m.set.itemId).toBe('sitrusberry');
    expect(m.set.nature).toBe('Jolly');
    expect(m.set.sp).toMatchObject({ hp: 2, atk: 32, spe: 32 });
    expect(m.set.moves).toEqual(['earthquake', 'dragonclaw', 'protect', 'rockslide']);
    expect(m.megaMode).toBe('base');
  });

  it('never ends up with four status moves', () => {
    const m = metaSet(
      entry('incineroar', {
        moves: [{ id: 'protect', pct: 99 }, { id: 'taunt', pct: 90 }, { id: 'willowisp', pct: 80 }, { id: 'partingshot', pct: 70 }, { id: 'flareblitz', pct: 60 }],
      }),
      dex,
      fmt,
    )!;
    const moves = m.set.moves.filter(Boolean).map((id) => dex.move(id)!);
    expect(moves.some((mv) => mv.category !== 'Status')).toBe(true);
    expect(m.set.moves).toContain('flareblitz');
  });

  it('puts a Mega Stone holder in Mega mode', () => {
    const m = metaSet(entry('garchomp', { items: [{ id: 'garchompite', pct: 80 }] }), dex, fmt)!;
    expect(m.set.itemId).toBe('garchompite');
    expect(m.megaMode).toBe('mega');
  });

  it('drops what the format does not allow and says so', () => {
    const m = metaSet(
      entry('garchomp', { items: [{ id: 'notanitem', pct: 70 }, { id: 'sitrusberry', pct: 30 }], moves: [{ id: 'notamove', pct: 99 }, { id: 'earthquake', pct: 90 }] }),
      dex,
      fmt,
    )!;
    expect(m.set.itemId).toBe('sitrusberry');
    expect(m.set.moves[0]).toBe('earthquake');
    expect(m.dropped.length).toBe(2);
    expect(metaSet(entry('notaspecies'), dex, fmt)).toBeUndefined();
  });
});

describe('classifyKill', () => {
  it('reads the calculator text', () => {
    expect(classifyKill('guaranteed OHKO', [100, 120])).toBe('ohko');
    expect(classifyKill('56.2% chance to OHKO', [90, 110])).toBe('pohko');
    expect(classifyKill('possible OHKO', [90, 110])).toBe('pohko');
    expect(classifyKill('guaranteed 2HKO', [60, 70])).toBe('2hko');
    expect(classifyKill('12.5% chance to 2HKO', [45, 55])).toBe('2hko');
    expect(classifyKill('possible 3HKO', [30, 40])).toBe('3hko');
    expect(classifyKill('guaranteed 5HKO', [10, 15])).toBe('3hko');
    expect(classifyKill('', [0, 0])).toBe('none');
    expect(classifyKill('', [100, 120])).toBe('ohko');
  });
});

describe('computeCell', () => {
  const garchomp = mk('garchomp', { nature: 'Jolly', sp: { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 }, moves: ['earthquake', 'dragonclaw', '', ''], abilityId: 'roughskin' });
  const incineroar = mk('incineroar', { nature: 'Adamant', sp: { hp: 32, atk: 32, def: 0, spa: 0, spd: 0, spe: 0 }, moves: ['flareblitz', 'fakeout', '', ''], abilityId: 'intimidate' });
  const threat = { set: incineroar, megaMode: 'base' as const };

  it('matches calcMoves and picks the strongest move', () => {
    const cell = computeCell(dex, garchomp, threat, defaultField());
    const direct = calcMoves(dex, { set: garchomp, cond: defaultSide(false) }, { set: incineroar, cond: defaultSide(false) }, defaultField());
    const eq = direct.find((m) => m.moveId === 'earthquake')!.forms[0];
    expect(cell.mine?.move).toBe('Earthquake');
    expect(cell.mine?.percent).toEqual(eq.percent);
    expect(cell.mine?.kill).toBe(classifyKill(eq.koText, eq.percent));
    expect(cell.theirs?.move).toBe('Flare Blitz');
    expect(cell.first).toBe('me');
    expect(cell.verdict).toBe(cell.verdict);
  });

  it('flips who moves first under Trick Room', () => {
    expect(computeCell(dex, garchomp, threat, { ...defaultField(), trickRoom: true }).first).toBe('them');
  });

  it('reads Speed as my worst case in both directions: slowest vs fastest, and under Trick Room fastest vs slowest', () => {
    const zam = mk('alakazam', { itemId: 'alakazite', nature: 'Timid', moves: ['psychic', '', '', ''] });
    const normal = computeCell(dex, zam, threat, defaultField());
    const tr = computeCell(dex, zam, threat, { ...defaultField(), trickRoom: true });
    // A Mega holder has two formes with different Speed: the base forme is the slow one without Trick Room...
    expect(normal.mySpeed).toBeLessThan(tr.mySpeed);
    // ...and the Mega forme (the faster one, so the one that moves last) under it.
    const speeds = [calcSpeedOf('base'), calcSpeedOf('mega')];
    expect(normal.mySpeed).toBe(Math.min(...speeds));
    expect(tr.mySpeed).toBe(Math.max(...speeds));
    function calcSpeedOf(mode: 'base' | 'mega') {
      return computeCell(dex, zam, threat, defaultField(), mode).mySpeed;
    }
  });

  it('Tailwind doubles the Speed of whichever side has it', () => {
    const base = computeCell(dex, garchomp, threat, defaultField());
    expect(computeCell(dex, garchomp, threat, { ...defaultField(), myTailwind: true }).mySpeed).toBe(base.mySpeed * 2);
    expect(computeCell(dex, garchomp, threat, { ...defaultField(), theirTailwind: true }).theirSpeed).toBe(base.theirSpeed * 2);
  });

  it('All hits makes a multi-hit move land every hit', () => {
    const pop = mk('incineroar', { moves: ['populationbomb', '', '', ''] as PokemonSet['moves'] });
    const auto = computeCell(dex, pop, { set: garchomp, megaMode: 'base' }, defaultField());
    const all = computeCell(dex, pop, { set: garchomp, megaMode: 'base' }, { ...defaultField(), maxHits: true });
    expect(all.mine!.percent[1]).toBeGreaterThan(auto.mine!.percent[1]);
  });
});

describe('report', () => {
  const sets = metaSets(meta.regulations['champions-reg-mb'], dex, getFormat('champions-vgc-reg-mb'), 6);
  const members = [
    { slot: 0, set: mk('garchomp', { sp: { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 }, nature: 'Jolly', moves: ['earthquake', 'dragonclaw', '', ''] }) },
    { slot: 1, set: mk('incineroar', { sp: { hp: 32, atk: 32, def: 0, spa: 0, spd: 0, spe: 0 }, nature: 'Adamant', moves: ['flareblitz', 'fakeout', '', ''] }) },
  ];
  const job: ThreatJob = {
    datasetId: 'champions',
    formatId: 'champions-vgc-reg-mc',
    members,
    threats: sets.map((m) => ({ key: m.speciesId, speciesId: m.speciesId, usagePct: m.usagePct, set: m.set, megaMode: m.megaMode })),
    field: defaultField(),
  };

  it('summaries are worst first and deterministic', () => {
    const rows = job.threats.map((_, i) => runThreatRow(dex, job, i));
    const a = summarize(dex, job, rows);
    const b = summarize(dex, job, rows);
    expect(a).toEqual(b);
    expect(a.map((s) => s.danger)).toEqual([...a.map((s) => s.danger)].sort((x, y) => y - x));
    expect(a.length).toBe(job.threats.length);
    for (const s of a) expect(s.lines.length).toBeGreaterThan(0);
    // Rebuilding the job with the threats in another order gives the same ranking.
    const reversed = { ...job, threats: [...job.threats].reverse() };
    const c = summarize(dex, reversed, reversed.threats.map((_, i) => runThreatRow(dex, reversed, i)));
    expect(c.map((s) => s.speciesId)).toEqual(a.map((s) => s.speciesId));
  });

  it('a worker round trip (structured clone) gives identical results to the main thread', () => {
    const run = (j: ThreatJob) => j.threats.map((_, i) => runThreatRow(dex, j, i));
    const direct = run(job);
    const viaWire = run(structuredClone(job));
    expect(JSON.parse(JSON.stringify(viaWire))).toEqual(JSON.parse(JSON.stringify(direct)));
  });

  it('memoises per (set, threat, field): the same cell object comes back', () => {
    const cache = new Map();
    const first = runThreatRow(dex, job, 0, cache);
    expect(cache.size).toBe(members.length);
    expect(runThreatRow(dex, job, 0, cache)[0]).toBe(first[0]);
    runThreatRow(dex, { ...job, field: { ...job.field, weather: 'Rain' } }, 0, cache);
    expect(cache.size).toBe(members.length * 2);
  });
});

describe('ohkoEntries', () => {
  const move = (kill: 'ohko' | 'pohko' | '2hko') => ({ move: 'X', moveId: 'x', percent: [90, 110] as [number, number], kill, text: '' });
  const cell = (mine: ReturnType<typeof move> | null, theirs: ReturnType<typeof move> | null) => ({ mine, theirs, mineMoves: mine ? [mine] : [], theirMoves: theirs ? [theirs] : [], first: 'them' as const, mySpeed: 1, theirSpeed: 2, verdict: 0 });
  const rows = [
    [cell(null, move('pohko'))], // 0: it possibly OHKOs me
    [cell(move('ohko'), move('2hko'))], // 1: I OHKO it
    [cell(move('pohko'), move('ohko'))], // 2: both
    undefined, // 3: still calculating
  ];

  it("lists what can OHKO a member: guaranteed first, then possible, in usage order", () => {
    expect(ohkoEntries(rows, 0, 'by').map((e) => [e.threatIndex, e.kill])).toEqual([[2, 'ohko'], [0, 'pohko']]);
  });

  it('lists what a member can OHKO, leaving out 2HKOs and unfinished rows', () => {
    expect(ohkoEntries(rows, 0, 'to').map((e) => [e.threatIndex, e.kill])).toEqual([[1, 'ohko'], [2, 'pohko']]);
  });

  describe('per move', () => {
    const mv = (moveId: string, kill: 'ohko' | 'pohko' | '2hko' | 'none', hi = 100) => ({ move: moveId, moveId, percent: [hi - 10, hi] as [number, number], kill, text: '' });
    const multi = (mine: ReturnType<typeof mv>[]) => ({ mine: null, theirs: null, mineMoves: mine, theirMoves: [], first: 'me' as const, mySpeed: 2, theirSpeed: 1, verdict: 0 });
    const grid = [
      [multi([mv('overheat', 'ohko'), mv('energyball', '2hko', 60)])],
      [multi([mv('overheat', '2hko', 70), mv('energyball', 'ohko')])],
      [multi([mv('overheat', 'pohko', 105), mv('energyball', 'none', 0)])],
    ];

    it('narrows the list to one move, and judges each threat by that move alone', () => {
      expect(ohkoEntries(grid, 0, 'to', { move: 'overheat' }).map((e) => [e.threatIndex, e.kill])).toEqual([[0, 'ohko'], [2, 'pohko']]);
      expect(ohkoEntries(grid, 0, 'to', { move: 'energyball' }).map((e) => [e.threatIndex, e.move.moveId])).toEqual([[1, 'energyball']]);
      expect(ohkoEntries(grid, 0, 'to', { move: 'overheat', possible: false }).map((e) => e.threatIndex)).toEqual([0]);
    });

    it('lists every threat that takes damage with `all`, best kill class first', () => {
      const all = ohkoEntries(grid, 0, 'to', { all: true });
      expect(all.map((e) => [e.threatIndex, e.kill])).toEqual([[0, 'ohko'], [1, 'ohko'], [2, 'pohko']]);
      expect(ohkoEntries(grid, 0, 'to', { all: true, move: 'overheat' }).map((e) => [e.threatIndex, e.kill])).toEqual([[0, 'ohko'], [2, 'pohko'], [1, '2hko']]);
    });

    it('counts how many threats each move gets onto the list', () => {
      expect(moveChoices(grid, 0, 'to').map((c) => [c.moveId, c.count])).toEqual([['overheat', 2], ['energyball', 1]]);
      expect(moveChoices(grid, 0, 'to', { possible: false }).map((c) => [c.moveId, c.count])).toEqual([['energyball', 1], ['overheat', 1]]);
      expect(moveChoices(grid, 0, 'to', { all: true }).map((c) => [c.moveId, c.count])).toEqual([['overheat', 3], ['energyball', 2]]);
    });
  });
});

describe('computeCell: every move', () => {
  it('keeps each damaging move, and the best one is the strongest of them', () => {
    const mine = mk('scovillain', { moves: ['overheat', 'energyball', 'protect', ''] as PokemonSet['moves'] });
    const theirs = metaSets(Object.values(meta.regulations)[0], dex, fmt, 5)[0];
    const cell = computeCell(dex, mine, theirs, defaultField());
    expect(cell.mineMoves.map((m) => m.moveId)).toEqual(['overheat', 'energyball']);
    const top = cell.mineMoves.reduce((a, b) => (b.percent[1] > a.percent[1] ? b : a));
    if (cell.mine) expect(cell.mineMoves.map((m) => m.moveId)).toContain(cell.mine.moveId);
    expect(top.percent[1]).toBeGreaterThanOrEqual(cell.mine?.percent[1] ?? 0);
  });
});
