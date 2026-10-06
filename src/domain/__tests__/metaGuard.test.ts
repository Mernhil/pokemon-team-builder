import { describe, expect, it } from 'vitest';
import generatedJson from '@/data/generated/meta.json';
import { parseMetaFile, type MetaFile } from '@/domain/meta';
import { MAX_MIRROR_LAG_DAYS, metaUpdateProblems, mirrorLagDays, newestIngameDate } from '@/domain/metaGuard';

const prev = parseMetaFile(generatedJson);
const clone = (): MetaFile => structuredClone(prev);
const [first, second] = Object.keys(prev.regulations);

describe('metaUpdateProblems', () => {
  it('accepts the committed file, and anything when there is no previous one', () => {
    expect(metaUpdateProblems(prev, clone())).toEqual([]);
    expect(metaUpdateProblems(undefined, clone())).toEqual([]);
  });

  it('refuses a file that fails validation', () => {
    const bad = clone() as unknown as { version: number };
    bad.version = 2;
    expect(metaUpdateProblems(prev, bad)[0]).toMatch(/failed validation/);
    expect(metaUpdateProblems(prev, 'nope')[0]).toMatch(/failed validation/);
  });

  it('refuses a dropped regulation', () => {
    const next = clone();
    delete next.regulations[first];
    expect(metaUpdateProblems(prev, next)).toEqual([expect.stringContaining(`${first} had`)]);
  });

  it('refuses a regulation cut to under half its entries, but allows half', () => {
    const next = clone();
    const n = prev.regulations[second].entries.length;
    next.regulations[second].entries = next.regulations[second].entries.slice(0, Math.ceil(n / 2) - 1);
    expect(metaUpdateProblems(prev, next)).toEqual([expect.stringContaining('shrank')]);
    next.regulations[second].entries = prev.regulations[second].entries.slice(0, Math.ceil(n / 2));
    expect(metaUpdateProblems(prev, next)).toEqual([]);
  });

  it('allows a new regulation', () => {
    const next = clone();
    next.regulations['champions-reg-new'] = { ...next.regulations[first], regulationId: 'champions-reg-new' };
    expect(metaUpdateProblems(prev, next)).toEqual([]);
  });
});

describe('stall check', () => {
  it('measures how far the in-game data trails the mirror', () => {
    expect(mirrorLagDays('2026-10-05', '2026-10-03')).toBe(2);
    expect(mirrorLagDays('2026-10-05', '2026-10-05')).toBe(0);
    expect(mirrorLagDays('2026-10-06', '2026-10-03')).toBeGreaterThan(MAX_MIRROR_LAG_DAYS);
  });

  it('finds the newest in-game snapshot date, if any', () => {
    const file = clone();
    for (const s of Object.values(file.regulations)) s.source = { ...s.source, kind: 'smogon' };
    expect(newestIngameDate(file)).toBeUndefined();
    file.regulations[first].source = { ...file.regulations[first].source, kind: 'ingame' };
    file.regulations[first].updatedAt = '2026-10-03';
    expect(newestIngameDate(file)).toBe('2026-10-03');
  });
});
