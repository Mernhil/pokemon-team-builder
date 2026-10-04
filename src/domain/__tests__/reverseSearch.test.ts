import { describe, expect, it } from 'vitest';
import data from '@/data/generated/champions.json';
import metaJson from '@/data/generated/meta.json';
import { Dex } from '@/data/dex';
import { defaultField } from '@/domain/battle/conditions';
import { getFormat } from '@/domain/formats';
import { parseMetaFile } from '@/domain/meta';
import {
  buildCandidates,
  defaultSet,
  evaluateCandidate,
  rankMatches,
  resistCheck,
  targetFor,
  type Candidate,
  type Condition,
} from '@/domain/reverseSearch';
import type { Dataset } from '@/domain/types';
import { validateTeam } from '@/domain/validation';
import { createTeam } from '@/domain/team';

const dex = new Dex(data as unknown as Dataset);
const fmt = getFormat('champions-vgc-reg-mc');
const snap = parseMetaFile(metaJson).regulations['champions-reg-mc'];
const field = defaultField();
const cond = (id: string, kind: Condition['kind'], speciesId: string, extra: Partial<Condition> = {}): Condition => ({ id, kind, target: targetFor(dex, fmt, speciesId, snap), ...extra });

describe('default builds', () => {
  it('are legal, attack with their stronger side and use distinct move types', () => {
    for (const s of dex.selectableSpecies(fmt.regulationId)) {
      const set = defaultSet(dex, s.id, fmt);
      const moves = set.moves.filter(Boolean);
      for (const m of moves) {
        expect(dex.canLearn(s.id, m), `${s.id} ${m}`).toBe(true);
        expect(dex.move(m)!.legalIn, `${s.id} ${m}`).toContain(fmt.regulationId);
      }
      expect(new Set(moves.map((m) => dex.move(m)!.type)).size).toBe(moves.length);
      expect(Object.values(set.sp).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(66);
    }
    // Real attacking moves: no recharge, charge or two-turn moves, but the core ones (Earthquake, Close Combat).
    expect(defaultSet(dex, 'garchomp', fmt).moves).toContain('earthquake');
    expect(defaultSet(dex, 'machamp', fmt).moves).toContain('closecombat');
    for (const s of dex.selectableSpecies(fmt.regulationId)) {
      for (const m of defaultSet(dex, s.id, fmt).moves.filter(Boolean)) {
        expect(dex.move(m)!.shortDesc, `${s.id} ${m}`).not.toMatch(/cannot move next turn|faints|turn 2|Fails (unless|if)/i);
      }
    }
    const team = { ...createTeam(fmt), slots: [defaultSet(dex, 'garchomp', fmt), null, null, null, null, null] as never };
    expect(validateTeam(team, fmt, dex).filter((i) => i.severity === 'error')).toEqual([]);
  });
});

describe('candidates', () => {
  const cands = buildCandidates(dex, fmt, snap);
  it('cover the whole regulation, with meta sets for the used species', () => {
    expect(cands.length).toBeGreaterThan(250);
    expect(cands.find((c) => c.speciesId === snap!.entries[0].speciesId)?.build).toBe('meta');
    expect(new Set(cands.map((c) => c.speciesId)).size).toBe(cands.length);
  });
});

describe('resist', () => {
  const cand = (speciesId: string): Candidate => ({ speciesId, set: defaultSet(dex, speciesId, fmt), megaMode: 'base', build: 'default', usagePct: 0 });
  it('is a type check against the target\'s attacking types', () => {
    const fireTarget = { speciesId: 'incineroar', megaMode: 'base' as const, set: { ...defaultSet(dex, 'incineroar', fmt), moves: ['flareblitz', '', '', ''] as never } };
    expect(resistCheck(dex, cand('corviknight'), fireTarget).pass).toBe(false); // Steel is weak to Fire
    expect(resistCheck(dex, cand('tsareena'), fireTarget).pass).toBe(false);
    expect(resistCheck(dex, cand('azumarill'), fireTarget).pass).toBe(true); // Water/Fairy
  });
  it('needs every attacking type resisted', () => {
    const t = { speciesId: 'incineroar', megaMode: 'base' as const, set: { ...defaultSet(dex, 'incineroar', fmt), moves: ['flareblitz', 'knockoff', '', ''] as never } };
    expect(resistCheck(dex, cand('azumarill'), t).pass).toBe(true); // Water resists Fire; Fairy resists Dark
    expect(resistCheck(dex, cand('tsareena'), t).pass).toBe(false); // Grass is weak to Fire
  });
});

describe('evaluateCandidate', () => {
  it('only keeps candidates that meet every condition, and agrees with the calc', () => {
    const conds = [cond('a', 'ohko', 'rillaboom'), cond('b', 'survive', 'rillaboom')];
    const matches = buildCandidates(dex, fmt, snap).flatMap((c) => evaluateCandidate(dex, c, conds, field) ?? []);
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) {
      expect(m.results.map((r) => r.conditionId)).toEqual(['a', 'b']);
      expect(m.results.every((r) => r.pass)).toBe(true);
    }
    // Adding a condition can only shrink the answer.
    const more = [...conds, cond('c', 'outspeed', 'rillaboom')];
    const fewer = buildCandidates(dex, fmt, snap).flatMap((c) => evaluateCandidate(dex, c, more, field) ?? []);
    expect(fewer.length).toBeLessThanOrEqual(matches.length);
    expect(fewer.every((m) => matches.some((x) => x.candidate.speciesId === m.candidate.speciesId))).toBe(true);
  });

  it('rankMatches puts meta-backed answers first', () => {
    const conds = [cond('a', 'ohko', 'rillaboom')];
    const ranked = rankMatches(buildCandidates(dex, fmt, snap).flatMap((c) => evaluateCandidate(dex, c, conds, field) ?? []));
    const firstDefault = ranked.findIndex((m) => m.candidate.build === 'default');
    if (firstDefault >= 0) expect(ranked.slice(firstDefault).every((m) => m.candidate.build === 'default')).toBe(true);
  });
});
