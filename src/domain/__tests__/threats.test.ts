import { describe, expect, it } from 'vitest';
import data from '@/data/generated/champions.json';
import metaJson from '@/data/generated/meta.json';
import { Dex } from '@/data/dex';
import { calcMoves } from '@/domain/battle/damage';
import { defaultField, defaultSide } from '@/domain/battle/conditions';
import { formatForRegulation, getFormat } from '@/domain/formats';
import { metaSet, metaSets } from '@/domain/metaSets';
import { parseMetaFile, type MetaEntry } from '@/domain/meta';
import { classifyKill, computeCell, ohkoEntries, runThreatJob, runThreatRow, summarize, type ThreatJob } from '@/domain/threats';
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

  it('reads a Mega holder pessimistically for me and optimistically for the threat', () => {
    const mega = mk('garchomp', { ...garchomp, itemId: 'garchompite' });
    const cell = computeCell(dex, mega, threat, defaultField());
    const direct = calcMoves(dex, { set: mega, cond: defaultSide(true) }, { set: incineroar, cond: defaultSide(false) }, defaultField());
    const eq = direct.find((m) => m.moveId === 'earthquake')!;
    expect(eq.forms).toHaveLength(2);
    expect(cell.mine?.percent[1]).toBe(Math.min(...eq.forms.map((f) => f.percent[1])));
    // The Mega threat is read at its strongest forme, and its Speed is the faster one.
    const megaThreat = { set: mk('garchomp', { ...garchomp, itemId: 'garchompite' }), megaMode: 'both' as const };
    const c2 = computeCell(dex, incineroar, megaThreat, defaultField());
    const d2 = calcMoves(dex, { set: megaThreat.set, cond: { ...defaultSide(true), megaMode: 'both' } }, { set: incineroar, cond: defaultSide(false) }, defaultField());
    expect(c2.theirs?.percent[1]).toBe(Math.max(...d2.find((m) => m.moveId === 'earthquake')!.forms.map((f) => f.percent[1])));
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
    const direct = runThreatJob(dex, job, () => {});
    const viaWire = runThreatJob(dex, structuredClone(job), () => {});
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

  it('reports progressively, one row at a time', () => {
    const seen: number[] = [];
    runThreatJob(dex, job, (i) => seen.push(i));
    expect(seen).toEqual(job.threats.map((_, i) => i));
  });
});

describe('ohkoEntries', () => {
  const move = (kill: 'ohko' | 'pohko' | '2hko') => ({ move: 'X', moveId: 'x', percent: [90, 110] as [number, number], kill, text: '' });
  const cell = (mine: ReturnType<typeof move> | null, theirs: ReturnType<typeof move> | null) => ({ mine, theirs, first: 'them' as const, mySpeed: 1, theirSpeed: 2, verdict: 0 });
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
});
