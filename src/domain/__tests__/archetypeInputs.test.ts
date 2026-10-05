import { describe, expect, it } from 'vitest';
import data from '@/data/generated/champions.json';
import metaJson from '@/data/generated/meta.json';
import { Dex } from '@/data/dex';
import { metaSetLookup, monsOfLogged, monsOfTeam, suggestForMatch, suggestionPatch, untaggedMatches } from '@/domain/archetypeInputs';
import { getFormat } from '@/domain/formats';
import { createMatch, type Match } from '@/domain/matches';
import { parseMetaFile } from '@/domain/meta';
import { createSet, createTeam } from '@/domain/team';
import type { Dataset, PokemonSet } from '@/domain/types';

const dex = new Dex(data as unknown as Dataset);
const fmt = getFormat('champions-vgc-reg-mc');
const snapshot = parseMetaFile(metaJson).regulations['champions-reg-mc'];
const rainOpp = [
  { speciesId: 'pelipper', abilityId: 'drizzle', moves: ['hurricane', 'tailwind', 'protect', 'weatherball'] },
  { speciesId: 'basculegion', abilityId: 'swiftswim', moves: ['waterfall', 'protect', 'flipturn', 'shadowball'] },
];
const match = (patch: Partial<Match> = {}): Match => ({ ...createMatch('2026-10-05'), regulationId: 'champions-reg-mc', opponentTeam: rainOpp, ...patch });

describe('inputs', () => {
  it('reads a saved team and a logged team', () => {
    const set: PokemonSet = { ...createSet(dex, 'pelipper', fmt), abilityId: 'drizzle', moves: ['hurricane', '', '', 'protect'] };
    const team = { ...createTeam(fmt), slots: [set, null, null, null, null, null] as never };
    expect(monsOfTeam(team)).toEqual([expect.objectContaining({ speciesId: 'pelipper', abilityId: 'drizzle', moves: ['hurricane', 'protect'] })]);
    expect(monsOfLogged([{ speciesId: '' }, { speciesId: 'garchomp', moves: ['earthquake'] }])).toEqual([expect.objectContaining({ speciesId: 'garchomp', moves: ['earthquake'] })]);
  });

  it('looks up the most-used set of a species in a snapshot, and nothing without one', () => {
    expect(metaSetLookup(undefined, dex, fmt)).toBeUndefined();
    const lookup = metaSetLookup(snapshot, dex, fmt)!;
    const top = snapshot.entries[0].speciesId;
    expect(lookup(top)?.moves?.length).toBeGreaterThan(0);
    expect(lookup('notapokemon')).toBeUndefined();
  });
});

describe('suggesting for a match', () => {
  it('suggests for the empty fields only, and never over a value the player set', () => {
    expect(suggestForMatch(match(), {}, dex, fmt).opponentArchetype?.tag).toBe('Rain');
    const set = suggestForMatch(match({ opponentArchetype: 'Stall' }), {}, dex, fmt);
    expect(set.opponentArchetype).toBeUndefined();
  });

  it('the patch fills what is empty and leaves what is not', () => {
    const m = match({ myArchetype: 'Balance' });
    const s = { myArchetype: { tag: 'Rain' as const, confidence: 0.9, reasons: [] }, opponentArchetype: { tag: 'Rain' as const, confidence: 0.9, reasons: [] } };
    expect(suggestionPatch(m, s)).toEqual({ opponentArchetype: 'Rain' });
  });

  it('suggests for my side from a saved team\'s sets', () => {
    const sets = ['pelipper', 'basculegion'].map((id) => ({ ...createSet(dex, id, fmt), abilityId: id === 'pelipper' ? 'drizzle' : 'swiftswim', moves: id === 'pelipper' ? ['hurricane', 'protect', 'weatherball', 'wideguard'] : ['waterfall', 'protect', 'flipturn', 'shadowball'] }));
    const team = { ...createTeam(fmt), id: 't1', slots: [...sets, null, null, null, null] as never };
    expect(suggestForMatch(match({ myTeamId: 't1', opponentTeam: [] }), { t1: team }, dex, fmt).myArchetype?.tag).toBe('Rain');
  });
});

describe('untaggedMatches', () => {
  it('lists the matches a tag can be suggested for, skips the finished ones, and changes nothing', () => {
    const tagged = match({ id: 'a', myArchetype: 'Balance', opponentArchetype: 'Rain' });
    const open = match({ id: 'b' });
    const nothing = match({ id: 'c', opponentTeam: [{ speciesId: 'garchomp' }] });
    const before = JSON.stringify([tagged, open, nothing]);
    const list = untaggedMatches([tagged, open, nothing], {}, dex, fmt, () => undefined);
    expect(list.map((x) => x.match.id)).toEqual(['b']);
    expect(list[0].suggestion.opponentArchetype?.tag).toBe('Rain');
    expect(JSON.stringify([tagged, open, nothing])).toBe(before);
  });
});
