import { describe, expect, it } from 'vitest';
import { createMatch, type Match } from '../matches';
import { localMetaFromMatches } from '../meta';
import { sanitizeTeam } from '../sanitize';
import { ago, isReadOnly, matchesForSource, nameOf, NEWS_WINDOW_MS, sharedFolders, sharedNotices, type SharedChange } from '../sharing';
import { getFormat } from '../formats';
import { createTeam } from '../team';
import type { Team } from '../types';

const NOW = Date.parse('2026-10-03T12:00:00Z');
const H = 3600 * 1000;

describe('match sources', () => {
  const mine = [createMatch('2026-10-01'), createMatch('2026-10-02')];
  const theirs = [{ ...createMatch('2026-10-03'), owner: 'a@b.c' }];
  it('mine / theirs / both of us', () => {
    expect(matchesForSource(mine, theirs, 'mine')).toBe(mine);
    expect(matchesForSource(mine, theirs, 'theirs')).toBe(theirs);
    expect(matchesForSource(mine, theirs, 'both')).toHaveLength(3);
  });
  it('never alters my own list when asked for both', () => {
    matchesForSource(mine, theirs, 'both');
    expect(mine).toHaveLength(2);
  });
});

describe('notices', () => {
  const names = { 'a@b.c': 'Ash' };
  const change = (over: Partial<SharedChange> = {}): SharedChange => ({ kind: 'team', name: 'Rain M-C', owner: 'a@b.c', updatedAt: NOW - 2 * H, existed: true, ...over });

  it('says who changed what and how long ago', () => {
    expect(sharedNotices([change()], names, NOW)).toEqual(['Ash updated “Rain M-C” 2 h ago.']);
    expect(sharedNotices([change({ existed: false })], names, NOW)).toEqual(['Ash shared “Rain M-C” with you.']);
  });
  it('falls back to the e-mail when there is no display name', () => {
    expect(sharedNotices([change()], {}, NOW)[0]).toContain('a@b.c updated');
    expect(nameOf('x@y.z', {})).toBe('x@y.z');
  });
  it('keeps to three lines, newest first, then counts the rest; old changes and matches are not news', () => {
    const many = [1, 2, 3, 4, 5].map((i) => change({ name: `T${i}`, updatedAt: NOW - i * H }));
    const lines = sharedNotices([...many, change({ name: 'Old', updatedAt: NOW - NEWS_WINDOW_MS - H }), change({ kind: 'match' })], names, NOW);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('T1');
    expect(lines[3]).toBe('…and 2 more shared teams changed.');
  });
  it('says it once when a folder and its variation have the same name', () => {
    expect(sharedNotices([change(), change({ updatedAt: NOW - H })], names, NOW)).toHaveLength(1);
  });
  it('wording of the time', () => {
    expect(ago(NOW - 10_000, NOW)).toBe('just now');
    expect(ago(NOW - 5 * 60_000, NOW)).toBe('5 min ago');
    expect(ago(NOW - 5 * H, NOW)).toBe('5 h ago');
    expect(ago(NOW - 72 * H, NOW)).toBe('3 days ago');
  });
});

describe('shared teams', () => {
  const fmt = getFormat('champions-vgc-reg-mc');
  const mk = (name: string, shared?: Team['shared'], groupId?: string, updatedAt = 1): Team => ({ ...createTeam(fmt, name), shared, groupId, updatedAt });
  it('only a view share is read-only', () => {
    expect(isReadOnly(mk('a', { owner: 'x@y.z', role: 'view' }))).toBe(true);
    expect(isReadOnly(mk('a', { owner: 'x@y.z', role: 'edit' }))).toBe(false);
    expect(isReadOnly(mk('a'))).toBe(false);
  });
  it('groups shared teams into folders with their variations; my own teams are not listed', () => {
    const root = mk('Theirs', { owner: 'x@y.z', role: 'view' }, undefined, 5);
    const v = mk('Theirs', { owner: 'x@y.z', role: 'view' }, root.id, 9);
    const own = mk('Mine');
    const folders = sharedFolders({ [root.id]: root, [v.id]: v, [own.id]: own });
    expect(folders).toHaveLength(1);
    expect(folders[0].root.id).toBe(root.id);
    expect(folders[0].variations.map((t) => t.id)).toEqual([v.id]);
  });
});

describe('combined meta source', () => {
  const m = (species: string[], owner?: string): Match & { owner?: string } => ({ ...createMatch('2026-10-01'), regulationId: 'reg-mc', opponentTeam: species.map((speciesId) => ({ speciesId })), owner });
  const mine = [m(['garchomp']), m(['garchomp', 'incineroar'])];
  const theirs = [m(['incineroar'], 'a@b.c'), m(['incineroar'], 'a@b.c'), m(['incineroar'], 'a@b.c')];
  const top = (list: Match[]) => localMetaFromMatches(list, 'reg-mc')?.entries.map((e) => [e.speciesId, e.usagePct]);

  it('"Both of us" counts both logs; mine and theirs count only their own', () => {
    expect(top(matchesForSource(mine, theirs, 'mine'))?.[0][0]).toBe('garchomp');
    expect(top(matchesForSource(mine, theirs, 'theirs'))?.map((x) => x[0])).toEqual(['incineroar']);
    const both = top(matchesForSource(mine, theirs, 'both'));
    expect(both?.[0][0]).toBe('incineroar'); // 4 of 5 matches
    expect(both?.find((x) => x[0] === 'garchomp')?.[1]).toBeCloseTo(40);
  });
});

describe('the shared marker on a team', () => {
  const fmt = getFormat('champions-vgc-reg-mc');
  it('survives loading, is cleaned up when malformed', () => {
    const t = { ...createTeam(fmt, 'T'), shared: { owner: 'A@B.C', role: 'edit' } };
    expect(sanitizeTeam(t)?.shared).toEqual({ owner: 'a@b.c', role: 'edit' });
    expect(sanitizeTeam({ ...t, shared: { owner: 'nope', role: 'edit' } })?.shared).toBeUndefined();
    expect(sanitizeTeam({ ...t, shared: { owner: 'a@b.c', role: 'admin' } })?.shared?.role).toBe('view'); // unknown roles never get more rights
    expect(sanitizeTeam({ ...t, shared: 'x' })?.shared).toBeUndefined();
  });
});
