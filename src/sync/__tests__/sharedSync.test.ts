import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handleApi } from '../../../worker/api';
import { goodClaims, makeEnv, makeKey, signJwt, type TestKey } from '../../../worker/__tests__/helpers';
import { getFormat } from '@/domain/formats';
import { createMatch } from '@/domain/matches';
import { cloneTeam, createTeam } from '@/domain/team';
import type { SharedPullResponse, SharesResponse } from '@/domain/syncProtocol';
import type { Team } from '@/domain/types';
import { isLocked, useTeamStore } from '@/store/teamStore';
import { useToastStore } from '@/store/toastStore';
import { storeAdapter } from '../runner';
import { syncShared } from '../sharedSync';
import { useShareStore } from '../shareStore';

let key: TestKey;
beforeAll(async () => {
  key = await makeKey();
});

const OWNER = 'owner@example.com';
const ME = 'me@example.com';
const fmt = getFormat('champions-vgc-reg-mc');

type Env = ReturnType<typeof makeEnv>;
let env: Env;
let clock = Date.now();

async function call<R>(as: string, method: string, path: string, body?: unknown): Promise<R> {
  const sec = Math.floor(clock / 1000);
  const headers = { 'Cf-Access-Jwt-Assertion': await signJwt(key, goodClaims(as, { iat: sec - 60, nbf: sec - 60, exp: sec + 7200 })) };
  const res = await handleApi(new Request(`https://app.example${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, { keys: async () => [key.jwk], now: () => clock });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json() as Promise<R>;
}

/** The app's own shared-sync, acting as ME, against the real Worker handler. */
const syncMe = () =>
  syncShared({
    deviceName: 'Phone',
    now: () => clock,
    api: {
      shares: async () => useShareStore.getState().setShares(await call<SharesResponse>(ME, 'GET', '/api/shares')),
      pull: () => call<SharedPullResponse>(ME, 'GET', '/api/shared'),
      push: (docs) => call(ME, 'POST', '/api/shared', { docs }),
    },
  });

const ownerPush = (docs: object[]) => call(OWNER, 'POST', '/api/sync', { docs });
const asDoc = (t: Team) => ({ id: t.id, kind: 'team', updatedAt: t.updatedAt, deleted: false, json: t });
const shareWithMe = (ref: string, role: 'view' | 'edit') => call(OWNER, 'PUT', '/api/shares', { kind: 'team-group', ref, grantee: ME, role });
const mine = () => Object.values(useTeamStore.getState().teams);
const sharedCopies = () => mine().filter((t) => t.shared);

function ownerFolder() {
  const root: Team = { ...createTeam(fmt, 'Rain'), createdAt: clock - 9000, updatedAt: clock - 9000 };
  const variation: Team = { ...cloneTeam(root, 'Rain', { groupId: root.id, variationLabel: 'vs Sun' }), updatedAt: clock - 8000 };
  return { root, variation };
}

beforeEach(() => {
  env = makeEnv();
  clock = Date.now();
  useShareStore.getState().clear();
  useToastStore.setState({ toasts: [] });
  const own = createTeam(fmt, 'My team');
  useTeamStore.setState({ teams: { [own.id]: own }, order: [own.id], activeTeamId: own.id });
});

describe('receiving a shared folder', () => {
  it('arrives marked as the owner’s, read-only for a viewer, and my own teams are untouched', async () => {
    const { root, variation } = ownerFolder();
    await ownerPush([asDoc(root), asDoc(variation)]);
    await shareWithMe(root.id, 'view');
    const { changes } = await syncMe();
    const copies = sharedCopies();
    expect(copies.map((t) => t.id).sort()).toEqual([root.id, variation.id].sort());
    expect(copies.every((t) => t.shared?.owner === OWNER && t.shared.role === 'view')).toBe(true);
    expect(mine()).toHaveLength(3);
    expect(changes.map((c) => c.owner)).toEqual([OWNER, OWNER]);
  });

  it('read-only enforcement: no edit, rename, format change, delete or variation sticks', async () => {
    const { root } = ownerFolder();
    await ownerPush([asDoc(root)]);
    await shareWithMe(root.id, 'view');
    await syncMe();
    const s = useTeamStore.getState();
    expect(isLocked(s.teams[root.id])).toBe(true);
    const before = JSON.stringify(s.teams[root.id]);
    s.updateTeam(root.id, { name: 'Mine now' });
    s.setSlot(root.id, 0, null);
    s.switchFormat(root.id, 'champions-vgc-reg-ma');
    s.clearTeam(root.id);
    s.deleteTeam(root.id);
    const after = useTeamStore.getState();
    expect(JSON.stringify(after.teams[root.id])).toBe(before);
    const n = Object.keys(after.teams).length;
    after.addVariation(root.id);
    expect(Object.keys(useTeamStore.getState().teams)).toHaveLength(n);
    expect(useToastStore.getState().toasts.length).toBeGreaterThan(0);
  });

  it('“Make my own copy” makes an independent, editable copy of the folder', async () => {
    const { root, variation } = ownerFolder();
    await ownerPush([asDoc(root), asDoc(variation)]);
    await shareWithMe(root.id, 'view');
    await syncMe();
    const copyId = useTeamStore.getState().copySharedToMine(root.id);
    const copy = useTeamStore.getState().teams[copyId];
    expect(copy.shared).toBeUndefined();
    expect(copy.id).not.toBe(root.id);
    const kids = mine().filter((t) => t.groupId === copyId);
    expect(kids).toHaveLength(1);
    expect(kids[0].shared).toBeUndefined();
    useTeamStore.getState().updateTeam(copyId, { name: 'Edited copy' });
    expect(useTeamStore.getState().teams[copyId].name).toBe('Edited copy');
    expect(useTeamStore.getState().teams[root.id].name).toBe('Rain');
  });

  it("shared teams never go into my own sync", () => {
    const own = mine().length;
    useTeamStore.setState((s) => ({ teams: { ...s.teams, x: { ...createTeam(fmt, 'Theirs'), id: 'x', shared: { owner: OWNER, role: 'view' } } } }));
    expect(storeAdapter.list().filter((d) => d.kind === 'team')).toHaveLength(own);
  });

  it('what the owner changes arrives later, with a notice that says who and when', async () => {
    const { root } = ownerFolder();
    await ownerPush([asDoc(root)]);
    await shareWithMe(root.id, 'view');
    await call(OWNER, 'PUT', '/api/profile', { displayName: 'Ash' });
    await syncMe();
    clock += 2 * 3600 * 1000;
    await ownerPush([asDoc({ ...root, name: 'Rain M-C', updatedAt: clock - 1000 })]);
    const { changes } = await syncMe();
    expect(useTeamStore.getState().teams[root.id].name).toBe('Rain M-C');
    expect(changes).toHaveLength(1);
    expect(changes[0].existed).toBe(true);
    // the toast wording
    const { sharedNotices } = await import('@/domain/sharing');
    expect(sharedNotices(changes, useShareStore.getState().names, clock)).toEqual(['Ash updated “Rain M-C” just now.']);
  });

  it('stopping the share removes my copies', async () => {
    const { root, variation } = ownerFolder();
    await ownerPush([asDoc(root), asDoc(variation)]);
    await shareWithMe(root.id, 'view');
    await syncMe();
    expect(sharedCopies()).toHaveLength(2);
    await call(OWNER, 'DELETE', '/api/shares', { kind: 'team-group', ref: root.id, grantee: ME });
    await syncMe();
    expect(sharedCopies()).toHaveLength(0);
    expect(useShareStore.getState().known).toEqual({});
  });

  it('a change of role reaches the copy', async () => {
    const { root } = ownerFolder();
    await ownerPush([asDoc(root)]);
    await shareWithMe(root.id, 'view');
    await syncMe();
    await shareWithMe(root.id, 'edit');
    await syncMe();
    expect(useTeamStore.getState().teams[root.id].shared?.role).toBe('edit');
    expect(isLocked(useTeamStore.getState().teams[root.id])).toBe(false);
  });
});

describe('editing a folder shared with edit rights', () => {
  it('my edit and a new variation reach the owner', async () => {
    const { root, variation } = ownerFolder();
    await ownerPush([asDoc(root), asDoc(variation)]);
    await shareWithMe(root.id, 'edit');
    await syncMe();
    clock += 60_000;
    useTeamStore.getState().updateTeam(variation.id, { variationLabel: 'edited by me' });
    const addedId = useTeamStore.getState().addVariation(root.id);
    expect(useTeamStore.getState().teams[addedId].shared?.owner).toBe(OWNER);
    // updatedAt comes from Date.now() in the store; the Worker allows a few minutes of drift, the test clock follows
    clock = Date.now();
    await syncMe();
    const own = (await call<{ docs: { id: string; json: Team }[] }>(OWNER, 'GET', '/api/sync?since=0')).docs;
    expect(own.find((d) => d.id === variation.id)?.json.variationLabel).toBe('edited by me');
    expect(own.some((d) => d.id === addedId)).toBe(true);
  });

  it('when both of us changed a team, the losing version is kept as a team of my own', async () => {
    const { root } = ownerFolder();
    await ownerPush([asDoc(root)]);
    await shareWithMe(root.id, 'edit');
    await syncMe();
    // I edit on the phone; the owner edits later the same day
    clock = Date.now();
    useTeamStore.getState().updateTeam(root.id, { name: 'My edit' });
    clock += 60_000;
    await ownerPush([asDoc({ ...root, name: 'Owner edit', updatedAt: clock })]);
    clock += 1000;
    await syncMe();
    const teams = mine();
    expect(teams.find((t) => t.id === root.id)?.name).toBe('Owner edit');
    const kept = teams.find((t) => t.name.startsWith('My edit'));
    expect(kept).toBeTruthy();
    expect(kept?.shared).toBeUndefined();
    expect(kept?.name).toContain('conflict copy (Phone');
    expect(kept?.groupId).toBeUndefined();
  });
});

describe('a shared match log', () => {
  it("arrives as a read-only list, separate from my own matches, and is replaced as it changes", async () => {
    const m = { ...createMatch('2026-10-01'), updatedAt: clock - 5000 };
    await ownerPush([{ id: m.id, kind: 'match', updatedAt: m.updatedAt, deleted: false, json: m }]);
    await call(OWNER, 'PUT', '/api/shares', { kind: 'matches', ref: '*', grantee: ME, role: 'view' });
    await syncMe();
    expect(useShareStore.getState().matches.map((x) => [x.id, x.owner])).toEqual([[m.id, OWNER]]);
    await call(OWNER, 'DELETE', '/api/shares', { kind: 'matches', ref: '*', grantee: ME });
    await syncMe();
    expect(useShareStore.getState().matches).toEqual([]);
  });
});
