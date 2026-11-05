import { describe, expect, it } from 'vitest';
import { adoptStamps, deviceDirectory, deviceKind, deviceText, hasSeveralDevices, labelTeams, makeStamp, matchesFilter, newDeviceId, onlyAddsStamps, parseFilter, parseStamp, sanitizeStamp, teamDevices, unlabelled } from '@/domain/deviceStamp';
import { sanitizeTeam } from '@/domain/sanitize';
import { sameContent } from '@/domain/sync';
import { cloneTeam, createTeam } from '@/domain/team';
import { getFormat } from '@/domain/formats';
import type { Team } from '@/domain/types';

const fmt = getFormat('champions-vgc-reg-mc');
const PHONE = 'pabcdefg';
const DESK = 'chijklmn';
const team = (name: string, over: Partial<Team> = {}): Team => ({ ...createTeam(fmt, name), createdAt: 1000, updatedAt: 1000, ...over });

describe('stamps', () => {
  it('are `<id>~<name>`, at most 40 characters, and parse back', () => {
    const s = makeStamp(PHONE, 'My phone');
    expect(s).toBe('pabcdefg~My phone');
    expect(parseStamp(s)).toEqual({ id: PHONE, kind: 'phone', name: 'My phone' });
    expect(makeStamp(PHONE, 'x'.repeat(80))).toHaveLength(40);
    expect(parseStamp(makeStamp(DESK, 'Desk'))?.kind).toBe('computer');
  });
  it('a malformed or over-long stamp is dropped, never shown as "undefined"', () => {
    for (const bad of [undefined, null, 5, '', 'Phone', 'pabcdefg', 'zabcdefg~x', 'pabc~x', {}]) expect(sanitizeStamp(bad)).toBeUndefined();
    expect(sanitizeStamp(`${PHONE}~Pho‮ne\u0000`)).toBe('pabcdefg~Phone');
  });
  it('device ids carry the kind and are unique enough', () => {
    expect(newDeviceId('phone')).toMatch(/^p[a-z0-9]{7}$/);
    expect(newDeviceId('computer', () => 0.5)).toMatch(/^c[a-z0-9]{7}$/);
    expect(new Set(Array.from({ length: 50 }, () => newDeviceId('unknown'))).size).toBe(50);
  });
  it('kinds from the user agent', () => {
    expect(deviceKind({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Mobile/15E148' })).toBe('phone');
    expect(deviceKind({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' })).toBe('tablet');
    expect(deviceKind({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 })).toBe('tablet');
    expect(deviceKind({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 0 })).toBe('computer');
    expect(deviceKind({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari' })).toBe('phone');
    expect(deviceKind({ userAgent: 'whatever', desktopApp: true })).toBe('computer');
    expect(deviceKind({})).toBe('unknown');
  });
});

describe('the sanitiser', () => {
  it('keeps valid stamps, drops bad ones, and old teams without them load fine', () => {
    const t = sanitizeTeam({ ...team('A'), createdOn: makeStamp(PHONE, 'Phone'), updatedOn: 'garbage' });
    expect(t?.createdOn).toBe('pabcdefg~Phone');
    expect(t?.updatedOn).toBeUndefined();
    const old = sanitizeTeam(JSON.parse(JSON.stringify(team('Old'))));
    expect(old).not.toBeNull();
    expect('createdOn' in old! && old!.createdOn !== undefined).toBe(false);
    expect(JSON.stringify(old)).not.toContain('undefined');
  });
});

describe('labels', () => {
  const dirOf = (teams: Team[], own?: { id: string; name: string }) => deviceDirectory(teams, own);
  it('say where a team was made and, when it differs, where it was last edited', () => {
    const made = team('Made on phone', { createdOn: makeStamp(PHONE, 'Phone'), updatedOn: makeStamp(PHONE, 'Phone') });
    const edited = team('Edited on desktop', { createdOn: makeStamp(PHONE, 'Phone'), updatedOn: makeStamp(DESK, 'Desktop'), updatedAt: 2000 });
    const dir = dirOf([made, edited]);
    expect(deviceText(teamDevices(made, dir))).toBe('Made on Phone');
    expect(deviceText(teamDevices(edited, dir))).toBe('Made on Phone · edited on Desktop');
    expect(deviceText(teamDevices(team('Only editor', { updatedOn: makeStamp(DESK, 'Desktop') }), dir))).toBe('Edited on Desktop');
  });
  it('an old team shows nothing', () => {
    const old = team('Old');
    expect(deviceText(teamDevices(old, dirOf([old])))).toBeUndefined();
    expect(deviceText(teamDevices({}, new Map()))).toBeUndefined();
  });
  it('are shown only when there are two devices to tell apart', () => {
    const a = team('A', { createdOn: makeStamp(PHONE, 'Phone') });
    expect(hasSeveralDevices(dirOf([a]))).toBe(false);
    expect(hasSeveralDevices(dirOf([a, team('B', { createdOn: makeStamp(DESK, 'Desktop') })]))).toBe(true);
  });
  it('a rename updates every old label on this device at once, and other devices once the renamed one stamps anything newer', () => {
    const old = team('Old', { createdOn: makeStamp(PHONE, 'Phone'), updatedAt: 1000 });
    expect(dirOf([old]).get(PHONE)?.name).toBe('Phone');
    expect(dirOf([old], { id: PHONE, name: 'Lorenzo’s iPhone' }).get(PHONE)?.name).toBe('Lorenzo’s iPhone'); // this device
    const newer = team('New', { createdOn: makeStamp(PHONE, 'Lorenzo’s iPhone'), updatedOn: makeStamp(PHONE, 'Lorenzo’s iPhone'), updatedAt: 5000 });
    expect(dirOf([old, newer]).get(PHONE)?.name).toBe('Lorenzo’s iPhone'); // as seen from the desktop
    expect(deviceText(teamDevices(old, dirOf([old, newer])))).toBe('Made on Lorenzo’s iPhone');
  });
  it('two devices with the same name stay two devices and are told apart', () => {
    const a = team('A', { createdOn: makeStamp('pxxxxxx1', 'Phone') });
    const b = team('B', { createdOn: makeStamp('pyyyyyy2', 'Phone') });
    const dir = dirOf([a, b]);
    expect(dir.size).toBe(2);
    expect(new Set([...dir.values()].map((d) => d.label)).size).toBe(2);
  });
  it('shared teams (someone else\'s devices) are left out', () => {
    const shared = team('Theirs', { createdOn: makeStamp(DESK, 'Their desktop'), shared: { owner: 'x@example.com', role: 'view' } });
    expect(dirOf([shared]).size).toBe(0);
  });
});

describe('the filter', () => {
  const a = team('A', { createdOn: makeStamp(PHONE, 'Phone'), updatedOn: makeStamp(DESK, 'Desktop') });
  const dir = deviceDirectory([a]);
  it('made on / edited on a device, folders by any member, and an unknown device means all', () => {
    expect(matchesFilter(parseFilter('all', dir), [a])).toBe(true);
    expect(matchesFilter(parseFilter(`made:${PHONE}`, dir), [a])).toBe(true);
    expect(matchesFilter(parseFilter(`made:${DESK}`, dir), [a])).toBe(false);
    expect(matchesFilter(parseFilter(`edited:${DESK}`, dir), [a])).toBe(true);
    const variation = team('V', { createdOn: makeStamp(DESK, 'Desktop'), groupId: a.id });
    expect(matchesFilter(parseFilter(`made:${DESK}`, dir), [a, variation])).toBe(true);
    expect(parseFilter('made:pzzzzzzz', dir)).toEqual({ mode: 'all' });
    expect(parseFilter('nonsense', dir)).toEqual({ mode: 'all' });
  });
});

describe('backfill', () => {
  it('marks only teams with no stamp, and never touches updatedAt', () => {
    const old = team('Old', { updatedAt: 1234 });
    const known = team('Known', { createdOn: makeStamp(DESK, 'Desktop'), updatedOn: makeStamp(DESK, 'Desktop'), updatedAt: 999 });
    const shared = team('Shared', { shared: { owner: 'x@example.com', role: 'edit' } });
    expect(unlabelled([old, known, shared]).map((t) => t.name)).toEqual(['Old']);
    const [done] = labelTeams([old], makeStamp(PHONE, 'Phone'));
    expect(done.updatedAt).toBe(1234);
    expect(done.createdAt).toBe(old.createdAt);
    expect(done.createdOn).toBe('pabcdefg~Phone');
    expect(done.updatedOn).toBe('pabcdefg~Phone');
    expect(unlabelled([done])).toEqual([]);
  });
  it('the server takes a labelled team at the same version only when labels are all that was added', () => {
    const old = JSON.parse(JSON.stringify(team('Old')));
    const labelled = { ...old, createdOn: makeStamp(PHONE, 'Phone'), updatedOn: makeStamp(PHONE, 'Phone') };
    expect(onlyAddsStamps(old, labelled, sameContent)).toBe(true);
    expect(onlyAddsStamps(labelled, labelled, sameContent)).toBe(false); // nothing added
    expect(onlyAddsStamps(labelled, { ...labelled, createdOn: makeStamp(DESK, 'Desktop') }, sameContent)).toBe(false); // would rewrite a label
    expect(onlyAddsStamps(old, { ...labelled, name: 'Renamed' }, sameContent)).toBe(false); // a content change
    expect(onlyAddsStamps(old, { ...labelled, updatedAt: old.updatedAt + 1 }, sameContent)).toBe(true); // updatedAt is not content (and the server requires it equal anyway)
  });
  it('a device takes the server\'s labels for an unedited version, and fills a missing createdOn on an edited one', () => {
    const local = { name: 'T' };
    const remote = { name: 'T', createdOn: makeStamp(DESK, 'Desktop'), updatedOn: makeStamp(DESK, 'Desktop') };
    expect(adoptStamps(local, remote, false)).toEqual(remote);
    expect(adoptStamps({ ...local, updatedOn: makeStamp(PHONE, 'Phone') }, remote, true)).toEqual({ name: 'T', createdOn: remote.createdOn, updatedOn: makeStamp(PHONE, 'Phone') });
    expect(adoptStamps(remote, remote, false)).toBe(remote); // nothing to take: same object, so nothing is written
  });
});

describe('copies', () => {
  it('cloneTeam gives the copy only the stamps it is told to', () => {
    const src = team('Src', { createdOn: makeStamp(PHONE, 'Phone'), updatedOn: makeStamp(PHONE, 'Phone') });
    const dup = cloneTeam(src, undefined, { createdOn: makeStamp(DESK, 'Desktop'), updatedOn: makeStamp(DESK, 'Desktop') });
    expect(dup.createdOn).toBe('cchijklmn~Desktop'.replace('cchijklmn', DESK));
    const bare = cloneTeam(src);
    expect(bare.createdOn).toBeUndefined();
    expect(bare.updatedOn).toBeUndefined();
  });
});
