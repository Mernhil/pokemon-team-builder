import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import generatedJson from '@/data/generated/meta.json';
import manualJson from '@/data/meta/manual.json';
import {
  META_STALE_DAYS,
  chaosToSnapshot,
  coreOverlapScore,
  localMetaFromMatches,
  metaAgeDays,
  metaDataDate,
  metaPartners,
  parseMetaFile,
  pickSnapshot,
  type MetaEntry,
  type MetaFile,
  type MetaSnapshot,
} from '@/domain/meta';
import { migrateMetaState } from '@/store/metaStore';

/**
 * A test fixture in the shape of Smogon's chaos JSON (not real usage numbers): two species, the
 * keys this app reads, plus extra keys it must ignore.
 */
const CHAOS = {
  info: { metagame: 'gen9championsvgc2026regmc', cutoff: 1760, 'cutoff deviation': 0, 'team type': null, 'number of battles': 1234 },
  data: {
    Incineroar: {
      'Raw count': 900,
      usage: 0.5123,
      Abilities: { intimidate: 95, blaze: 5 },
      Items: { sitrusberry: 60, safetygoggles: 30, nothing: 10 },
      Moves: { fakeout: 98, partingshot: 80, flareblitz: 70, knockoff: 50, '': 2 },
      Teammates: { 'Rillaboom': 40, 'Garchomp-Mega': 20, 'Unknownmon': 30 },
      Spreads: { 'Careful:32/0/20/0/14/0': 30, 'Other': 70 },
      'Checks and Counters': {},
      Happiness: { '255': 100 },
    },
    Rillaboom: {
      usage: 0.004,
      Abilities: { grassysurge: 10 },
      Items: {},
      Moves: {},
      Teammates: {},
      Spreads: {},
    },
  },
};

const baseSnap = (over: Partial<MetaSnapshot> = {}): MetaSnapshot => ({
  regulationId: 'champions-reg-mc',
  updatedAt: '2026-09-01',
  source: { name: 'Test' },
  entries: [{ speciesId: 'incineroar', usagePct: 50, abilities: [], items: [], moves: [], teammates: [], spreads: [] }],
  ...over,
});

describe('meta schema', () => {
  it('accepts the files shipped with the app', () => {
    expect(() => parseMetaFile(generatedJson)).not.toThrow();
    expect(() => parseMetaFile(manualJson)).not.toThrow();
  });

  it('rejects malformed data with a message naming the problem', () => {
    const bad = { version: 1, generatedAt: '2026-09-28', regulations: { x: { ...baseSnap(), entries: [{ speciesId: 'Bad Id!', usagePct: 5 }] } } };
    expect(() => parseMetaFile(bad)).toThrow(/regulations\.x\.entries\.0\.speciesId/);
    expect(() => parseMetaFile({ version: 2, generatedAt: '2026-09-28', regulations: {} })).toThrow();
    expect(() => parseMetaFile({ ...bad, regulations: { x: { ...baseSnap(), entries: [{ ...baseSnap().entries[0], usagePct: 140 }] } } })).toThrow();
    expect(() => parseMetaFile(null)).toThrow();
  });
});

describe('Smogon chaos → snapshot', () => {
  const species = (name: string) => ({ incineroar: 'incineroar', rillaboom: 'rillaboom', garchompmega: 'garchomp' })[name.toLowerCase().replace(/[^a-z0-9]/g, '')];
  const snap = chaosToSnapshot(CHAOS, { regulationId: 'champions-reg-mc', format: 'gen9championsvgc2026regmc', month: '2026-09', url: 'https://www.smogon.com/stats/2026-09/chaos/gen9championsvgc2026regmc-1760.json', speciesId: species });

  it('keeps the source details', () => {
    expect(snap.source).toMatchObject({ month: '2026-09', cutoff: 1760, battles: 1234, format: 'gen9championsvgc2026regmc' });
  });

  it('turns weights into % of the species total, dropping placeholders and species under 1% usage', () => {
    expect(snap.entries.map((e) => e.speciesId)).toEqual(['incineroar']);
    const inc = snap.entries[0];
    expect(inc.usagePct).toBe(51.2);
    expect(inc.abilities[0]).toEqual({ id: 'intimidate', pct: 95 });
    expect(inc.items.map((i) => i.id)).toEqual(['sitrusberry', 'safetygoggles']); // "nothing" dropped
    expect(inc.moves[0]).toEqual({ id: 'fakeout', pct: 98 });
    expect(inc.spreads).toEqual([{ nature: 'Careful', values: [32, 0, 20, 0, 14, 0], pct: 30 }]);
  });

  it('maps teammate names to species ids (Megas to their base)', () => {
    expect(snap.entries[0].teammates.map((t) => t.id)).toEqual(expect.arrayContaining(['rillaboom', 'garchomp']));
  });

  it('rejects a file that isn’t chaos JSON', () => {
    expect(() => chaosToSnapshot({ data: {} }, { regulationId: 'x', format: 'f', month: '2026-09', url: 'https://example.org/' })).toThrow();
  });
});

describe('picking and dating snapshots', () => {
  it('prefers the newer copy and falls back across files', () => {
    const file = (s: MetaSnapshot): MetaFile => ({ version: 1, generatedAt: s.updatedAt, regulations: { [s.regulationId]: s } });
    const older = baseSnap({ updatedAt: '2026-08-01' });
    const newer = baseSnap({ updatedAt: '2026-09-15' });
    expect(pickSnapshot('champions-reg-mc', file(older), file(newer))?.updatedAt).toBe('2026-09-15');
    expect(pickSnapshot('champions-reg-mc', undefined, file(older))?.updatedAt).toBe('2026-08-01');
    expect(pickSnapshot('champions-reg-mb', file(older))).toBeUndefined();
  });

  it('dates monthly data by the end of its month', () => {
    const snap = baseSnap({ updatedAt: '2026-09-28', source: { name: 'Smogon', month: '2026-08' } });
    expect(metaDataDate(snap)).toBe('2026-08-31');
    expect(metaAgeDays(snap, Date.parse('2026-09-30'))).toBe(30);
    expect(metaAgeDays(snap, Date.parse('2026-11-01'))).toBeGreaterThan(META_STALE_DAYS);
    expect(metaDataDate(baseSnap({ updatedAt: '2026-09-02' }))).toBe('2026-09-02');
  });
});

describe('core overlap hint', () => {
  const entry: Pick<MetaEntry, 'speciesId' | 'teammates'> = { speciesId: 'incineroar', teammates: [{ id: 'rillaboom', pct: 40 }] };
  it('scores shared species over the core size', () => {
    expect(coreOverlapScore(['incineroar', 'rillaboom'], entry)).toBe(1);
    expect(coreOverlapScore(['incineroar'], entry)).toBe(0.5);
    expect(coreOverlapScore(['landorustherian'], entry)).toBe(0);
    expect(coreOverlapScore(['incineroar'], { ...entry, teammates: [] })).toBe(0);
  });
});

describe('teammate suggestions', () => {
  const snap = baseSnap({
    entries: [
      { speciesId: 'incineroar', usagePct: 50, abilities: [], items: [], moves: [], spreads: [], teammates: [{ id: 'rillaboom', pct: 40 }, { id: 'garchomp', pct: 20 }, { id: 'kingambit', pct: 10 }] },
      { speciesId: 'garchomp', usagePct: 40, abilities: [], items: [], moves: [], spreads: [], teammates: [{ id: 'kingambit', pct: 35 }, { id: 'incineroar', pct: 30 }] },
    ],
  });
  it('sums pairings over the team, skipping members already on it', () => {
    const out = metaPartners(snap, ['incineroar', 'garchomp']);
    expect(out.map((p) => p.speciesId)).toEqual(['kingambit', 'rillaboom']);
    expect(out[0]).toEqual({ speciesId: 'kingambit', score: 45, with: [{ speciesId: 'garchomp', pct: 35 }, { speciesId: 'incineroar', pct: 10 }] });
  });
  it('is empty when no member has data', () => {
    expect(metaPartners(snap, ['pikachu'])).toEqual([]);
  });
});

describe('fallback from your logged matches', () => {
  it('builds usage, items and moves from matches in the given regulation only', () => {
    const snap = localMetaFromMatches(
      [
        { regulationId: 'reg-a', opponentTeam: [{ speciesId: 'incineroar', itemId: 'safetygoggles', moves: ['fakeout', 'knockoff'] }, { speciesId: 'rillaboom', itemId: 'assaultvest' }] },
        { regulationId: 'reg-a', opponentTeam: [{ speciesId: 'incineroar', itemId: 'safetygoggles' }] },
        { regulationId: 'reg-b', opponentTeam: [{ speciesId: 'landorustherian' }] },
      ],
      'reg-a',
      '2026-09-28',
    );
    expect(snap).not.toBeNull();
    expect(snap!.source).toEqual({ kind: 'matches', name: 'Your logged matches (2)', battles: 2 });
    expect(snap!.entries[0]).toMatchObject({ speciesId: 'incineroar', usagePct: 100, items: [{ id: 'safetygoggles', pct: 100 }] });
    expect(snap!.entries.find((e) => e.speciesId === 'rillaboom')?.usagePct).toBe(50);
    // The result passes the same validation as published data.
    expect(() => parseMetaFile({ version: 1, generatedAt: '2026-09-28', regulations: { 'reg-a': snap } })).not.toThrow();
  });

  it('returns null without matches for that regulation', () => {
    expect(localMetaFromMatches([{ regulationId: 'reg-a', opponentTeam: [{ speciesId: 'x' }] }], 'reg-b')).toBeNull();
    expect(localMetaFromMatches([], 'reg-a')).toBeNull();
  });
});

describe('meta store migration', () => {
  it('drops v1’s cached championsbattledata.com responses', () => {
    const v1 = { snapshots: { 'champions-reg-mc': { regulationId: 'champions-reg-mc', fetchedAt: 1, source: 'championsbattledata.com', entries: [] } } };
    expect(migrateMetaState(v1, 1)).toEqual({});
  });

  it('keeps a valid refreshed file and drops an invalid one', () => {
    const refreshed: MetaFile = { version: 1, generatedAt: '2026-09-28', regulations: { 'champions-reg-mc': baseSnap() } };
    expect(migrateMetaState({ refreshed, refreshedAt: 5 }, 2)).toEqual({ refreshed, refreshedAt: 5 });
    expect(migrateMetaState({ refreshed: { version: 1, regulations: 'nope' } }, 2)).toEqual({});
  });
});

describe('meta data loading', () => {
  it('is never imported statically, so it stays out of the first download', () => {
    const files = (readdirSync('src', { recursive: true }) as string[]).filter((f) => /\.tsx?$/.test(f) && !f.includes('__tests__'));
    const imports = (f: string) => [...readFileSync(join('src', f), 'utf8').matchAll(/^import [^;]*? from '([^']+)';/gm)].map((m) => m[1]);
    const isMetaData = (f: string, spec: string) => ['@/data/meta', '@/data/metaHistoryData', '@/data/tournamentTeamsData'].includes(spec) || (f.startsWith('data') && ['./meta', './metaHistoryData', './tournamentTeamsData'].includes(spec));
    const offenders = files.filter((f) => imports(f).some((spec) => isMetaData(f, spec)));
    expect(offenders).toEqual([]);
  });
});
