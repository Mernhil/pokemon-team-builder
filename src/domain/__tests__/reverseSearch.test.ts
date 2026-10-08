import { describe, expect, it } from 'vitest';
import data from '@/data/generated/champions.json';
import metaJson from '@/data/generated/meta.json';
import { Dex } from '@/data/dex';
import { defaultField } from '@/domain/battle/conditions';
import { getFormat } from '@/domain/formats';
import { parseMetaFile } from '@/domain/meta';
import {
  buildCandidates,
  candidateUsageLabel,
  defaultSet,
  evaluateCandidate,
  rankMatches,
  resistCheck,
  targetFor,
  withRequiredMoves,
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

describe('target form', () => {
  it('is the Mega when the meta set holds its stone, so Fire one-shots Golisopod', () => {
    const t = targetFor(dex, fmt, 'golisopod', snap);
    expect(dex.megaFor('golisopod', t.set.itemId)).toBeTruthy();
    expect(t.megaMode).toBe('mega');
    const m = evaluateCandidate(dex, { speciesId: 'typhlosion', set: defaultSet(dex, 'typhlosion', fmt), megaMode: 'base', build: 'default' }, [{ id: 'a', kind: 'ohko', target: t }], field);
    expect(m).toBeDefined();
    // Flipped to the base form (Bug/Water: Fire is only neutral) the same attacker no longer one-shots it.
    expect(evaluateCandidate(dex, { speciesId: 'typhlosion', set: defaultSet(dex, 'typhlosion', fmt), megaMode: 'base', build: 'default' }, [{ id: 'a', kind: 'ohko', target: { ...t, megaMode: 'base' } }], field)).toBeUndefined();
  });
  it('is the base form without a stone', () => {
    expect(targetFor(dex, fmt, 'garchomp', snap).megaMode).toBe(dex.megaFor('garchomp', targetFor(dex, fmt, 'garchomp', snap).set.itemId) ? 'mega' : 'base');
  });
});

describe('Mega Stone holders as answers', () => {
  it('are tried as the Mega and as the base form, and the match says which', () => {
    const cands = buildCandidates(dex, fmt, snap).filter((c) => c.megaMode === 'both');
    expect(cands.length).toBeGreaterThan(0);
    const target = targetFor(dex, fmt, 'golisopod', snap);
    const forms = new Set<string>();
    for (const c of cands) {
      const m = evaluateCandidate(dex, c, [{ id: 'a', kind: 'ohko', target, allowPossible: true }, { id: 'b', kind: 'survive', target }], field);
      if (m) forms.add(m.form!);
    }
    for (const f of forms) expect(['mega', 'base', 'either']).toContain(f);
    // Every holder reports a form, never undefined, when it matches.
    const some = cands.map((c) => evaluateCandidate(dex, c, [], field)).filter(Boolean);
    expect(some.every((m) => m!.form === 'either')).toBe(true);
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

describe('usage as a percentage or only a rank', () => {
  it('labels and orders both kinds (the game\'s Battle Data has ranks only)', () => {
    expect(candidateUsageLabel({ usagePct: 47.24 })).toBe('47.2%');
    expect(candidateUsageLabel({ usageRank: 3 })).toBe('#3');
    expect(candidateUsageLabel({})).toBe('');
    const mk = (id: string, usage: { usagePct?: number; usageRank?: number }) => ({
      candidate: { speciesId: id, set: defaultSet(dex, 'garchomp', fmt), megaMode: 'base' as const, build: 'meta' as const, ...usage },
      results: [],
      score: 0,
    });
    const ranked = rankMatches([mk('c', { usageRank: 3 }), mk('a', { usageRank: 1 }), mk('b', { usageRank: 2 })]);
    expect(ranked.map((m) => m.candidate.speciesId)).toEqual(['a', 'b', 'c']);
    const mixed = rankMatches([mk('lo', { usagePct: 5 }), mk('hi', { usagePct: 40 })]);
    expect(mixed.map((m) => m.candidate.speciesId)).toEqual(['hi', 'lo']);
  });
});

describe('required moves', () => {
  const candidates = buildCandidates(dex, fmt, snap);
  const reg = fmt.regulationId;
  const inc = candidates.find((c) => c.speciesId === 'incineroar')!;

  it('rejects a Pokémon that cannot learn the move', () => {
    const chomp = candidates.find((c) => c.speciesId === 'garchomp')!;
    expect(dex.learnset('garchomp', reg).some((m) => m.id === 'fakeout')).toBe(false);
    expect(withRequiredMoves(dex, chomp, ['fakeout'], reg)).toBeUndefined();
  });

  it('keeps a set that already knows the move, and says nothing changed', () => {
    expect(inc.set.moves).toContain('fakeout');
    expect(withRequiredMoves(dex, inc, ['fakeout'], reg)).toBe(inc);
  });

  it('puts a missing move in place of a status move first, and reports it', () => {
    const base: Candidate = { ...inc, set: { ...inc.set, moves: ['flareblitz', 'knockoff', 'protect', 'darkestlariat'] } };
    const out = withRequiredMoves(dex, base, ['partingshot'], reg)!;
    expect(out.set.moves).toContain('partingshot');
    expect(out.set.moves).toContain('flareblitz');
    expect(out.set.moves).not.toContain('protect');
    expect(out.moveChanges).toEqual({ added: ['Parting Shot'], dropped: ['Protect'] });
  });

  it('every Fake Out user that one-shots something is built with Fake Out and can learn it', () => {
    const target = cond('c1', 'ohko', 'sylveon', { allowPossible: true });
    const matches = candidates
      .flatMap((c) => withRequiredMoves(dex, c, ['fakeout'], reg) ?? [])
      .flatMap((c) => evaluateCandidate(dex, c, [target], field) ?? []);
    for (const m of matches) {
      expect(m.candidate.set.moves).toContain('fakeout');
      expect(dex.canLearn(m.candidate.speciesId, 'fakeout')).toBe(true);
    }
  });
});
