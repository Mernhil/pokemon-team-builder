import { describe, expect, it } from 'vitest';
import { createMatch, type Match } from '../matches';
import { localMetaFromMatches } from '../meta';
import { overallWinRate } from '../matches';
import { friendLabel, isFriendMatch, matchSourceOptions, selectMatches, validSource } from '../sharedMatches';
import { reconcileViewer } from '../sharedSync';
import { describeUpdate, noticeMessages, timeAgo } from '../syncNotices';

const match = (id: string, over: Partial<Match> = {}): Match => ({ ...createMatch('2026-10-01'), id, ...over });
const mon = (speciesId: string, extra: object = {}) => ({ speciesId, ...extra });

describe('which matches a view shows', () => {
  const mine = [match('m1', { result: 'win' }), match('m2', { result: 'loss' })];
  const friends = { 'ash@example.com': [match('f1', { result: 'win' }), match('f2', { result: 'win' }), match('f3', { result: 'win' })], 'misty@example.com': [match('g1', { result: 'loss' })] };

  it('is just my own log by default, and never mixes in a friend’s', () => {
    expect(selectMatches('mine', mine, friends)).toBe(mine);
    expect(overallWinRate(selectMatches('mine', mine, friends))).toMatchObject({ wins: 1, losses: 1 });
  });

  it('shows a friend’s matches on their own', () => {
    expect(selectMatches('friend:ash@example.com', mine, friends).map((m) => m.id)).toEqual(['f1', 'f2', 'f3']);
    expect(selectMatches('friend:nobody@example.com', mine, friends)).toEqual([]);
  });

  it('"Both of us" is mine plus that one friend’s, no one else’s', () => {
    const both = selectMatches('both:ash@example.com', mine, friends);
    expect(both.map((m) => m.id)).toEqual(['m1', 'm2', 'f1', 'f2', 'f3']);
    expect(overallWinRate(both)).toMatchObject({ wins: 4, losses: 1 });
    expect(both.some((m) => m.id === 'g1')).toBe(false);
  });

  it('can’t be tricked by an owner called __proto__ or constructor', () => {
    expect(selectMatches('friend:__proto__', mine, friends)).toEqual([]);
    expect(selectMatches('both:constructor', mine, friends)).toEqual(mine);
  });

  it('offers only "My matches" until someone shares, then a friend and a "Both of us" entry each', () => {
    expect(matchSourceOptions([])).toEqual([{ value: 'mine', label: 'My matches' }]);
    const o = matchSourceOptions([{ owner: 'ash@example.com', name: 'Ash' }, { owner: 'misty@example.com' }]);
    expect(o.map((x) => x.value)).toEqual(['mine', 'friend:ash@example.com', 'friend:misty@example.com', 'both:ash@example.com', 'both:misty@example.com']);
    expect(o[1].label).toBe('Ash\'s matches');
    expect(o.find((x) => x.value === 'both:ash@example.com')!.label).toBe('Both of us (me + Ash)');
    expect(friendLabel({ owner: 'x@y.z' })).toBe('x@y.z');
  });

  it('falls back to mine when the friend stopped sharing', () => {
    const list = [{ owner: 'ash@example.com' }];
    expect(validSource('both:ash@example.com', list)).toBe('both:ash@example.com');
    expect(validSource('both:gone@example.com', list)).toBe('mine');
    expect(validSource('friend:gone@example.com', [])).toBe('mine');
    expect(isFriendMatch('friend:ash@example.com')).toBe(true);
    expect(isFriendMatch('both:ash@example.com')).toBe(false);
  });
});

describe('the Meta tab’s "Both of us" source', () => {
  const reg = 'champions-vgc-reg-mc';
  const mine = [match('m1', { regulationId: reg, opponentTeam: [mon('garchomp', { itemId: 'lifeorb' }), mon('rotom')] }), match('m2', { regulationId: reg, opponentTeam: [mon('garchomp')] })];
  const theirs = [match('f1', { regulationId: reg, opponentTeam: [mon('garchomp', { itemId: 'lifeorb' }), mon('pikachu')] }), match('f2', { regulationId: 'other', opponentTeam: [mon('mew')] })];

  it('counts both logs together, only for that regulation, and says so in the label', () => {
    const solo = localMetaFromMatches(mine, reg, '2026-10-03')!;
    expect(solo.source).toEqual({ name: 'Your logged matches (2)', battles: 2 });
    expect(solo.entries.find((e) => e.speciesId === 'garchomp')!.usagePct).toBe(100);

    const both = localMetaFromMatches([...mine, ...theirs], reg, '2026-10-03', 'Matches of you and Ash')!;
    expect(both.source).toEqual({ name: 'Matches of you and Ash (3)', battles: 3 });
    const by = Object.fromEntries(both.entries.map((e) => [e.speciesId, e.usagePct]));
    expect(by).toEqual({ garchomp: 100, rotom: 33.3, pikachu: 33.3 });
    expect(by.mew).toBeUndefined();
    expect(both.entries.find((e) => e.speciesId === 'garchomp')!.items[0]).toEqual({ id: 'lifeorb', pct: 66.7 });
  });

  it('is built through the same selection as the match log', () => {
    const sel = selectMatches('both:ash@example.com', mine, { 'ash@example.com': theirs });
    expect(localMetaFromMatches(sel, reg, '2026-10-03', 'x')!.source.battles).toBe(3);
    expect(localMetaFromMatches(selectMatches('mine', mine, { 'ash@example.com': theirs }), reg, '2026-10-03')!.source.battles).toBe(2);
  });
});

describe('"who updated what" toasts', () => {
  const now = Date.parse('2026-10-03T12:00:00Z');
  it('says how long ago, in plain words', () => {
    expect(timeAgo(now - 20_000, now)).toBe('just now');
    expect(timeAgo(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(timeAgo(now - 2 * 3_600_000, now)).toBe('2 h ago');
    expect(timeAgo(now - 3 * 86_400_000, now)).toBe('3 d ago');
    expect(timeAgo(now + 5000, now)).toBe('just now'); // a clock slightly ahead
  });

  it('reads "<who> updated “<team>” <time>"', () => {
    expect(describeUpdate({ teamId: 't', teamName: 'Rain M-C', who: 'Ash', updatedAt: now - 2 * 3_600_000 }, now)).toBe('Ash updated “Rain M-C” 2 h ago');
  });

  it('keeps one line per team (the latest), newest first, and counts the rest', () => {
    const n = (teamId: string, updatedAt: number, who = 'Ash') => ({ teamId, teamName: `Team ${teamId}`, who, updatedAt });
    const msgs = noticeMessages([n('a', now - 3_600_000), n('a', now - 60_000), n('b', now - 7_200_000), n('c', now - 10_800_000), n('d', now - 14_400_000)], now, 2);
    expect(msgs).toEqual(['Ash updated “Team a” 1 min ago', 'Ash updated “Team b” 2 h ago', '…and 2 more shared teams were updated.']);
    expect(noticeMessages([], now)).toEqual([]);
    expect(noticeMessages([n('a', now), n('b', now - 1000), n('c', now - 2000)], now, 2).at(-1)).toBe('…and 1 more shared team was updated.');
  });
});

describe('mirroring a folder I can only view', () => {
  const doc = (id: string, updatedAt: number, over: object = {}) => ({ id, kind: 'team' as const, updatedAt, deleted: false, json: { id, name: id }, seq: 1, ...over });
  const local = (id: string, updatedAt: number) => ({ id, kind: 'team' as const, updatedAt, json: { id, name: id } });

  it('takes new and changed teams, removes what is gone, and leaves the unchanged alone', () => {
    const r = reconcileViewer([local('a', 1), local('b', 1), local('gone', 1), local('deleted', 1)], [doc('a', 1), doc('b', 5, { by: 'Ash' }), doc('new', 3), doc('deleted', 9, { deleted: true, json: undefined })]);
    expect(r.upserts.map((d) => d.id)).toEqual(['b', 'new']);
    expect(r.deletes.map((d) => d.id).sort()).toEqual(['deleted', 'gone']);
    expect(r.updated).toEqual([{ id: 'b', name: 'b', updatedAt: 5, by: 'Ash' }]);
    expect(Object.keys(r.known).sort()).toEqual(['team:a', 'team:b', 'team:new']);
  });

  it('adopts an older server version too (the owner’s word is final)', () => {
    const r = reconcileViewer([local('a', 10)], [doc('a', 4)]);
    expect(r.upserts.map((d) => d.updatedAt)).toEqual([4]);
    expect(r.updated).toEqual([]); // not a newer change, so nothing to announce
  });
});
