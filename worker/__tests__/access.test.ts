import { describe, expect, it } from 'vitest';
import { ALL_MATCHES, accessTo, canRead, canWrite, type Share, type Target } from '../access';

const shares: Share[] = [
  { owner: 'o@x.io', grantee: 'viewer@x.io', kind: 'team-group', ref: 'g1', role: 'view' },
  { owner: 'o@x.io', grantee: 'editor@x.io', kind: 'team-group', ref: 'g1', role: 'edit' },
  { owner: 'o@x.io', grantee: 'viewer@x.io', kind: 'matches', ref: ALL_MATCHES, role: 'view' },
];
const g1: Target = { kind: 'team', group: 'g1' };
const g2: Target = { kind: 'team', group: 'g2' };
const match: Target = { kind: 'match' };

describe('access matrix: owner / viewer / editor / stranger', () => {
  it.each([
    ['o@x.io', g1, 'owner', true, true],
    ['editor@x.io', g1, 'edit', true, true],
    ['viewer@x.io', g1, 'view', true, false],
    ['stranger@x.io', g1, null, false, false],
    // another folder of the same owner is not shared
    ['editor@x.io', g2, null, false, false],
    ['viewer@x.io', g2, null, false, false],
    // matches: viewer was given the log; the editor of a folder was not
    ['viewer@x.io', match, 'view', true, false],
    ['editor@x.io', match, null, false, false],
    ['stranger@x.io', match, null, false, false],
    ['o@x.io', match, 'owner', true, true],
  ] as const)('%s on %j', (who, target, access, read, write) => {
    const a = accessTo(who, 'o@x.io', target, shares);
    expect(a).toBe(access);
    expect(canRead(a)).toBe(read);
    expect(canWrite(a, target)).toBe(write);
  });

  it("never lets anyone but the owner write someone's match log", () => {
    const edit: Share[] = [{ owner: 'o@x.io', grantee: 'f@x.io', kind: 'matches', ref: ALL_MATCHES, role: 'edit' }];
    expect(canWrite(accessTo('f@x.io', 'o@x.io', match, edit), match)).toBe(false);
  });

  it("a share belongs to its owner: it grants nothing on someone else's documents", () => {
    expect(accessTo('viewer@x.io', 'other@x.io', g1, shares)).toBeNull();
  });

  it('the strongest of several shares wins', () => {
    const both: Share[] = [shares[0], { ...shares[1], grantee: 'viewer@x.io' }];
    expect(accessTo('viewer@x.io', 'o@x.io', g1, both)).toBe('edit');
  });
});
