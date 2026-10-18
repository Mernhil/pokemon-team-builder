import { describe, expect, it } from 'vitest';
import data from '@/data/generated/champions.json';
import metaJson from '@/data/generated/meta.json';
import { Dex } from '@/data/dex';
import { defaultField } from '@/domain/battle/conditions';
import { getFormat } from '@/domain/formats';
import { parseMetaFile } from '@/domain/meta';
import {
  buildCandidates,
  candidateKey,
  candidateUsageLabel,
  defaultSet,
  evaluateCandidate,
  rankMatches,
  refreshTargets,
  resistCheck,
  targetFor,
  withRequiredMoves,
  type Candidate,
  type Condition,
} from '@/domain/reverseSearch';
import type { Dataset, PokemonSet } from '@/domain/types';
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

describe("'safe' (isn't one-shot by)", () => {
  it('needs every move of the target under 100%, says the worst one, and agrees with surviving one hit', () => {
    const t = targetFor(dex, fmt, 'kingambit', snap);
    const cands = buildCandidates(dex, fmt, snap);
    let safe = 0;
    for (const c of cands) {
      const a = evaluateCandidate(dex, c, [{ id: 's', kind: 'safe', target: t }], field);
      const b = evaluateCandidate(dex, c, [{ id: 's', kind: 'survive', target: t }], field);
      if (a) {
        safe++;
        expect(a.results[0].detail).toMatch(/^(worst hit .* \d+%|takes nothing)$/);
      }
      expect(!!a, c.speciesId).toBe(!!b);
    }
    expect(safe).toBeGreaterThan(0);
    expect(safe).toBeLessThan(cands.length);
  });
});

describe('a target added before the meta numbers arrived', () => {
  it('is rebuilt from the snapshot once it is in, so Golisopod is the Mega again', () => {
    const early: Condition = { id: 'a', kind: 'ohko', target: targetFor(dex, fmt, 'golisopod', undefined) };
    expect(early.target.set.itemId).toBeUndefined();
    expect(early.target.megaMode).toBe('base');
    const [late] = refreshTargets(dex, fmt, [early], snap);
    expect(dex.megaFor('golisopod', late.target.set.itemId)).toBeTruthy();
    expect(late.target.megaMode).toBe('mega');
    // The answers are the ones a target added after the load gets.
    const run = (c: Condition) => buildCandidates(dex, fmt, snap).flatMap((x) => evaluateCandidate(dex, x, [c], field) ?? []).length;
    expect(run(late)).toBe(run(cond('a', 'ohko', 'golisopod')));
    expect(run(late)).toBeGreaterThan(run(early));
  });
  it('keeps what the player changed, and returns the same array when nothing differs', () => {
    const early: Condition = { id: 'a', kind: 'ohko', target: { ...targetFor(dex, fmt, 'golisopod', undefined), edited: true } };
    const conds = [early];
    expect(refreshTargets(dex, fmt, conds, snap)).toBe(conds);
    const fresh = [cond('b', 'ohko', 'golisopod')];
    expect(refreshTargets(dex, fmt, fresh, snap)).toBe(fresh);
  });
});

describe('the player\'s own builds', () => {
  const golisopod = [{ id: 'a', kind: 'ohko' as const, target: targetFor(dex, fmt, 'golisopod', snap) }];
  const answers = (opts: Parameters<typeof buildCandidates>[3]) => buildCandidates(dex, fmt, snap, opts).flatMap((c) => evaluateCandidate(dex, c, golisopod, field) ?? []);
  const medichamite = { ...defaultSet(dex, 'medicham', fmt), itemId: 'medichamite' };

  it('beat the meta set and the default build', () => {
    const metaSpecies = snap!.entries.find((e) => e.speciesId !== 'garchomp')!.speciesId;
    const mine = { ...defaultSet(dex, metaSpecies, fmt), nature: 'Bold', moves: ['protect', '', '', ''] as PokemonSet['moves'] };
    const other = { ...defaultSet(dex, 'garchomp', fmt), nature: 'Impish' };
    const plain = buildCandidates(dex, fmt, snap);
    const cands = buildCandidates(dex, fmt, snap, { overrides: { [metaSpecies]: mine, garchomp: other } });
    expect(cands.length).toBe(plain.length);
    const a = cands.find((c) => c.speciesId === metaSpecies)!;
    expect(a).toMatchObject({ build: 'custom', set: mine });
    expect(a.usagePct ?? a.usageRank).toBeDefined(); // keeps the species' usage, so it ranks where it did
    expect(plain.find((c) => c.speciesId === metaSpecies)!.set).not.toEqual(mine);
    expect(cands.find((c) => c.speciesId === 'garchomp')).toMatchObject({ build: 'custom', set: other });
    expect(cands.filter((c) => c.build === 'custom')).toHaveLength(2);
  });
  it('can be asked for alone, and ignore species the format does not have', () => {
    const cands = buildCandidates(dex, fmt, snap, { overrides: { medicham: medichamite, notamon: { ...medichamite, speciesId: 'notamon' } }, only: new Set(['medicham', 'notamon']) });
    expect(cands.map((c) => c.speciesId)).toEqual(['medicham']);
  });
  it('holding the species\' Mega Stone make it a Mega-capable candidate, tried in both forms', () => {
    expect(answers({}).some((m) => m.candidate.speciesId === 'medicham')).toBe(false);
    const withStone = answers({ overrides: { medicham: medichamite } }).find((m) => m.candidate.speciesId === 'medicham');
    expect(withStone?.candidate).toMatchObject({ build: 'custom', megaMode: 'both' });
    expect(withStone?.form).toBe('mega');
    const noStone = buildCandidates(dex, fmt, snap, { overrides: { medicham: { ...medichamite, itemId: 'sitrusberry' } } }).find((c) => c.speciesId === 'medicham');
    expect(noStone?.megaMode).toBe('base');
  });
  it('are used by "Knows these moves" like any other build', () => {
    const mine = { ...medichamite, moves: ['closecombat', 'zenheadbutt', '', ''] as PokemonSet['moves'] };
    const [c] = buildCandidates(dex, fmt, snap, { overrides: { medicham: mine }, only: new Set(['medicham']) });
    const r = withRequiredMoves(dex, c, ['fakeout'], fmt.regulationId)!;
    expect(r.set.moves).toContain('fakeout');
    expect(r.set.moves).toContain('closecombat');
    expect(r.baseSet).toBe(mine); // an editor starts from the build, not the injected move
    expect(withRequiredMoves(dex, c, ['surf'], fmt.regulationId)).toBeUndefined();
  });
  it('rank with their species\' usage, so a card does not move while it is edited', () => {
    const conds = [cond('a', 'ohko', 'rillaboom')];
    const order = (overrides?: Record<string, PokemonSet>) => rankMatches(buildCandidates(dex, fmt, snap, { overrides }).flatMap((c) => evaluateCandidate(dex, c, conds, field) ?? [])).map((m) => m.candidate.speciesId);
    const before = order();
    const meta = before.find((id) => snap!.entries.some((e) => e.speciesId === id))!;
    const set = buildCandidates(dex, fmt, snap).find((c) => c.speciesId === meta)!.set;
    expect(order({ [meta]: set }).indexOf(meta)).toBe(before.indexOf(meta));
  });
});

describe('Try Mega Stones', () => {
  const golisopod = [{ id: 'a', kind: 'ohko' as const, target: targetFor(dex, fmt, 'golisopod', snap) }];
  const run = (tryStones?: boolean) => buildCandidates(dex, fmt, snap, { tryStones }).flatMap((c) => evaluateCandidate(dex, c, golisopod, field) ?? []);

  it('off, gives exactly the candidates and answers it always did', () => {
    const noUid = (cs: Candidate[]) => cs.map((c) => ({ ...c, set: { ...c.set, uid: '' } }));
    expect(noUid(buildCandidates(dex, fmt, snap, { tryStones: false }))).toEqual(noUid(buildCandidates(dex, fmt, snap)));
    expect(buildCandidates(dex, fmt, snap).some((c) => c.withStone)).toBe(false);
    expect(run(false).map((m) => candidateKey(m.candidate))).toEqual(run(undefined).map((m) => candidateKey(m.candidate)));
  });
  it('on, adds Medicham-Mega to the answers that one-shot Golisopod, labelled with its stone', () => {
    expect(run(false).some((m) => m.candidate.speciesId === 'medicham')).toBe(false);
    const medicham = run(true).find((m) => candidateKey(m.candidate) === 'medicham:medichamite');
    expect(medicham).toBeDefined();
    expect(medicham!.candidate).toMatchObject({ withStone: 'medichamite', megaMode: 'mega', build: 'default' });
    expect(medicham!.candidate.set.itemId).toBe('medichamite');
    expect(medicham!.form).toBe('mega');
    // Nothing else is lost: every answer without stones is still there.
    const keys = new Set(run(true).map((m) => candidateKey(m.candidate)));
    for (const m of run(false)) expect(keys.has(candidateKey(m.candidate))).toBe(true);
  });
  it('only tries stones the species is not holding, one candidate per stone, each legal', () => {
    const cands = buildCandidates(dex, fmt, snap, { tryStones: true });
    const keys = cands.map(candidateKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const c of cands.filter((x) => x.withStone)) {
      expect(dex.megaFor(c.speciesId, c.withStone)).toBeTruthy();
      expect(dex.item(c.withStone)!.legalIn).toContain(fmt.regulationId);
      const plain = cands.find((x) => x.speciesId === c.speciesId && !x.withStone)!;
      expect(plain.set.itemId).not.toBe(c.withStone);
    }
    // Garchomp holds its stone in the meta set (if used) or has none: never a duplicate of itself.
    const garchomp = cands.filter((c) => c.speciesId === 'garchomp');
    expect(garchomp.filter((c) => c.set.itemId === 'garchompite')).toHaveLength(1);
  });
  it('does not add a second card for a custom build that already holds the stone', () => {
    const mine = { ...defaultSet(dex, 'medicham', fmt), itemId: 'medichamite' };
    const cands = buildCandidates(dex, fmt, snap, { tryStones: true, overrides: { medicham: mine } }).filter((c) => c.speciesId === 'medicham');
    expect(cands.map(candidateKey)).toEqual(['medicham']);
  });
});
