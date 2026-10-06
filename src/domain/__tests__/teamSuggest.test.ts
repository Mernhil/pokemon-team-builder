import { describe, expect, it } from 'vitest';
import data from '@/data/generated/champions.json';
import metaJson from '@/data/generated/meta.json';
import { Dex } from '@/data/dex';
import { getFormat } from '@/domain/formats';
import { parseMetaFile } from '@/domain/meta';
import { createSet, createTeam } from '@/domain/team';
import {
  MAX_REASONS,
  MAX_THREATS,
  SECOND_MEGA_PENALTY,
  SHORTLIST_CAP,
  WEIGHTS,
  answerOf,
  applyThreatAnswers,
  problemThreats,
  reasonChips,
  shortlist,
  suggestCheap,
  teamCandidates,
  teamNeeds,
  threatJobFor,
  type Suggestion,
} from '@/domain/teamSuggest';
import { metaSets } from '@/domain/metaSets';
import type { Dataset, PokemonSet, Team } from '@/domain/types';

const dex = new Dex(data as unknown as Dataset);
const meta = parseMetaFile(metaJson);
const fmt = getFormat('champions-vgc-reg-mb');
const snapshot = meta.regulations['champions-reg-mb']; // Smogon: teammates as %
const ingame = meta.regulations['champions-reg-mc']; // in-game: teammates as ranks
const sp = (o: Partial<PokemonSet['sp']>) => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...o });
const mk = (species: string, patch: Partial<PokemonSet> = {}): PokemonSet => ({ ...createSet(dex, species, fmt), ...patch });
const teamOf = (...sets: PokemonSet[]): Team => ({ ...createTeam(fmt), slots: [...sets, null, null, null, null, null, null].slice(0, 6) as Team['slots'] });

const incineroar = mk('incineroar', { abilityId: 'intimidate', itemId: 'sitrusberry', moves: ['fakeout', 'flareblitz', 'partingshot', 'knockoff'], sp: sp({ hp: 32, atk: 32 }) });
const rillaboom = mk('rillaboom', { abilityId: 'grassysurge', itemId: 'assaultvest', moves: ['grassyglide', 'woodhammer', 'fakeout', 'uturn'], sp: sp({ hp: 32, atk: 32 }) });
const team = teamOf(incineroar, rillaboom);
const input = { dex, format: fmt, team, snapshot };

describe('candidates and the rules', () => {
  it('never suggests a species already on the team, or anything illegal in the regulation', () => {
    const c = teamCandidates(input);
    expect(c.length).toBeGreaterThan(10);
    expect(c.map((x) => x.speciesId)).not.toContain('incineroar');
    expect(c.map((x) => x.speciesId)).not.toContain('rillaboom');
    for (const x of c) expect(dex.species(x.speciesId)!.legalIn).toContain('champions-reg-mb');
    for (const x of c) if (x.set.itemId) expect(dex.item(x.set.itemId)!.legalIn).toContain('champions-reg-mb');
  });

  it('respects the item clause: an item the team already holds is swapped for another or dropped, and says so', () => {
    const held = teamOf(mk('gengar', { itemId: 'focussash', moves: ['shadowball', 'protect', '', ''] }));
    const c = teamCandidates({ ...input, team: held });
    expect(c.every((x) => x.set.itemId !== 'focussash')).toBe(true);
    const changed = c.filter((x) => x.notes.some((n) => /item clause/.test(n)));
    expect(changed.length).toBeGreaterThan(0);
    // with no item clause nothing changes
    const noClause = teamCandidates({ ...input, team: held, format: { ...fmt, clauses: { ...fmt.clauses, item: false } } });
    expect(noClause.some((x) => x.set.itemId === 'focussash')).toBe(true);
  });

  it('allows a second Mega Stone holder but notes it and scores it lower', () => {
    const mega = teamOf(mk('garchomp', { itemId: 'garchompite', abilityId: 'roughskin', moves: ['earthquake', 'dragonclaw', 'rockslide', 'protect'] }), incineroar);
    const ranked = suggestCheap({ ...input, team: mega });
    const second = ranked.filter((s) => s.notes.some((n) => /only one can Mega Evolve per battle/.test(n)));
    expect(second.length).toBeGreaterThan(0);
    for (const s of second) {
      const raw = (Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]).reduce((a, k) => a + WEIGHTS[k] * s.parts[k], 0);
      expect(s.total).toBeCloseTo(raw - SECOND_MEGA_PENALTY, 2);
    }
    // a team without a Mega never gets the note
    expect(suggestCheap(input).some((s) => s.notes.some((n) => /Mega/.test(n)))).toBe(false);
  });
});

describe('scoring', () => {
  it('is deterministic and sorted best first with ties on the species id', () => {
    const a = suggestCheap(input);
    const b = suggestCheap(input);
    // (a set's uid is random; everything the ranking says is not)
    const plain = (l: Suggestion[]) => l.map(({ set, ...rest }) => ({ ...rest, set: { ...set, uid: '' } }));
    expect(plain(b)).toEqual(plain(a));
    for (let i = 1; i < a.length; i++) expect(a[i - 1].total >= a[i].total).toBe(true);
    expect(suggestCheap({ ...input, team: teamOf() })).toEqual([]);
  });

  it('finds what the team needs: shared weaknesses, offensive gaps, missing roles', () => {
    const needs = teamNeeds(team, dex, fmt);
    expect(needs.missing).toContain('speed control');
    expect(needs.missing).not.toContain('Fake Out');
    expect(needs.missing).not.toContain('Intimidate');
    expect(needs.weak.length + needs.gaps.length).toBeGreaterThan(0);
  });

  it('every component is visible: synergy, defence, offence and roles each give a reason text', () => {
    const ranked = suggestCheap(input);
    const texts = ranked.flatMap((s) => s.reasons.map((r) => `${r.component}:${r.text}`));
    expect(texts.some((t) => /^synergy:Paired with .+ on \d+% of teams$/.test(t))).toBe(true);
    expect(texts.some((t) => /^defense:Resists \d+ of your \d+ weak types? \(/.test(t))).toBe(true);
    expect(texts.some((t) => /^offense:Hits .+ super-effectively, which your team can’t$/.test(t))).toBe(true);
    expect(texts.some((t) => /^roles:Adds .+, which your team lacks$/.test(t))).toBe(true);
    const inGame = suggestCheap({ ...input, snapshot: ingame }).flatMap((s) => s.reasons.map((r) => r.text));
    expect(inGame.some((t) => /^A top-\d+ teammate of /.test(t))).toBe(true);
  });

  it('shows at most three reasons, the strongest first', () => {
    for (const s of suggestCheap(input).slice(0, 30)) {
      expect(reasonChips(s).length).toBeLessThanOrEqual(MAX_REASONS);
      const weights = s.reasons.map((r) => WEIGHTS[r.component] * s.parts[r.component]);
      expect([...weights].sort((a, b) => b - a)).toEqual(weights);
    }
  });

  it('"every legal Pokémon" adds the ones without meta data, on the generic build', () => {
    const meta = teamCandidates(input).length;
    const all = teamCandidates({ ...input, includeAll: true });
    expect(all.length).toBeGreaterThan(meta);
    expect(all.some((c) => c.build === 'default')).toBe(true);
    expect(teamCandidates(input).every((c) => c.build === 'meta')).toBe(true);
  });
});

describe('the shortlist and threat answers', () => {
  it('caps the shortlist sent to the damage engine', () => {
    const ranked = suggestCheap(input);
    expect(shortlist(ranked)).toHaveLength(SHORTLIST_CAP);
    expect(shortlist(ranked, 3).map((s) => s.speciesId)).toEqual(ranked.slice(0, 3).map((s) => s.speciesId));
    expect(shortlist([], 5)).toEqual([]);
  });

  const cell = (verdict: number, kill: 'ohko' | '2hko' | 'none' = 'none', first: 'me' | 'them' | 'tie' = 'them') => ({ verdict, mine: kill === 'none' ? null : ({ kill } as never), first });
  it('picks the threats that beat several members, worst first, capped', () => {
    const rows = [[cell(-3), cell(-2)], [cell(-3), cell(1)], [cell(-2), cell(-2)], undefined, [cell(-2), cell(-3)]];
    const p = problemThreats(['a', 'b', 'c', 'd', 'e'], rows);
    expect(p.map((x) => x.speciesId)).toEqual(['a', 'c', 'e']);
    expect(p[0].beats).toBe(2);
    expect(problemThreats(Array.from({ length: 20 }, (_, i) => `t${i}`), Array.from({ length: 20 }, () => [cell(-3), cell(-3)]))).toHaveLength(MAX_THREATS);
  });

  it('answers: an OHKO, or outspeeding and 2HKOing', () => {
    expect(answerOf(cell(0, 'ohko'))).toBe('ohko');
    expect(answerOf(cell(0, '2hko', 'me'))).toBe('outspeed2hko');
    expect(answerOf(cell(0, '2hko', 'them'))).toBeNull();
    expect(answerOf(cell(0, 'none'))).toBeNull();
  });

  it('adds the threat component and a reason like "OHKOs Kingambit, which beats 4 of yours"', () => {
    const ranked = suggestCheap(input);
    const list = shortlist(ranked, 3);
    const threats = [{ speciesId: 'kingambit', beats: 4 }, { speciesId: 'sneasler', beats: 2 }];
    const rows = [
      [cell(0, 'none'), cell(0, 'ohko'), cell(0, '2hko', 'me')],
      [cell(0, 'none'), cell(0, 'none'), cell(0, '2hko', 'me')],
    ];
    const out = applyThreatAnswers(dex, ranked, list, threats, rows);
    expect(out).toHaveLength(ranked.length);
    const second = out.find((s) => s.speciesId === list[1].speciesId)!;
    expect(second.parts.threats).toBeCloseTo(0.5, 5);
    expect(second.reasons.find((r) => r.component === 'threats')!.text).toBe('OHKOs Kingambit, which beats 4 of yours');
    const third = out.find((s) => s.speciesId === list[2].speciesId)!;
    expect(third.parts.threats).toBeCloseTo(0.7, 5);
    expect(third.reasons.find((r) => r.component === 'threats')!.text).toMatch(/^Outspeeds and 2HKOs Kingambit, which beats 4 of yours \(2 of 2 problem threats answered\)$/);
    expect(out.find((s) => s.speciesId === list[0].speciesId)!.parts.threats).toBe(0);
    // rows still being calculated change nothing yet
    expect(applyThreatAnswers(dex, ranked, list, threats, [undefined, undefined])).toEqual(ranked);
    for (let i = 1; i < out.length; i++) expect(out[i - 1].total >= out[i].total).toBe(true);
  });

  it('builds the worker job: the shortlist as members, the problem threats as threats', () => {
    const ranked: Suggestion[] = shortlist(suggestCheap(input), 4);
    const threats = metaSets(snapshot, dex, fmt, 3);
    const job = threatJobFor(fmt, ranked, threats)!;
    expect(job.members.map((m) => m.set.speciesId)).toEqual(ranked.map((s) => s.speciesId));
    expect(job.threats.map((t) => t.speciesId)).toEqual(threats.map((t) => t.speciesId));
    expect(threatJobFor(fmt, [], threats)).toBeUndefined();
    expect(threatJobFor(fmt, ranked, [])).toBeUndefined();
  });
});
