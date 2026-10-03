import { beforeAll, describe, expect, it } from 'vitest';
import { getFormat } from '../../src/domain/formats';
import { createMatch } from '../../src/domain/matches';
import { cloneTeam, createTeam } from '../../src/domain/team';
import type { PullResponse, PushResponse, SharedPullResponse, SharesResponse } from '../../src/domain/syncProtocol';
import type { Team } from '../../src/domain/types';
import { handleApi } from '../api';
import { NOW, goodClaims, makeEnv, makeKey, signJwt, type TestKey } from './helpers';

let key: TestKey;
beforeAll(async () => {
  key = await makeKey();
});

const OWNER = 'owner@example.com';
const VIEWER = 'viewer@example.com';
const EDITOR = 'editor@example.com';
const STRANGER = 'stranger@example.com';

type Env = ReturnType<typeof makeEnv>;
async function call<T = Record<string, unknown>>(env: Env, method: string, path: string, who: string, body?: unknown) {
  const headers = { 'Cf-Access-Jwt-Assertion': await signJwt(key, goodClaims(who)) };
  const res = await handleApi(new Request(`https://app.example${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, { keys: async () => [key.jwk], now: () => NOW });
  return { status: res.status, body: (await res.json()) as T };
}

const mk = (name: string, updatedAt = NOW - 5000): Team => ({ ...createTeam(getFormat('champions-vgc-reg-mc'), name), updatedAt, createdAt: updatedAt });
const doc = (t: Team, over: object = {}) => ({ id: t.id, kind: 'team', updatedAt: t.updatedAt, deleted: false, json: t, ...over });

/** The owner has a folder (root + one variation) and a match, all synced; returns them. */
async function setup() {
  const env = makeEnv();
  const root = mk('Rain');
  const variation: Team = { ...cloneTeam(root, 'Rain', { groupId: root.id, variationLabel: 'vs Sun' }), updatedAt: NOW - 4000 };
  const other = mk('Private');
  const match = { ...createMatch('2026-10-01'), updatedAt: NOW - 3000 };
  const r = await call<PushResponse>(env, 'POST', '/api/sync', OWNER, {
    docs: [doc(root), doc(variation), doc(other), { id: match.id, kind: 'match', updatedAt: match.updatedAt, deleted: false, json: match }],
  });
  expect(r.body.results.every((x) => x.status === 'applied')).toBe(true);
  return { env, root, variation, other, match };
}
const share = (env: Env, body: object, who = OWNER) => call<SharesResponse & { error?: string }>(env, 'PUT', '/api/shares', who, body);
const shared = (env: Env, who: string) => call<SharedPullResponse>(env, 'GET', '/api/shared', who);

describe('sharing a folder', () => {
  it('shares the team and its variations, and nothing else', async () => {
    const { env, root, variation, other } = await setup();
    const r = await share(env, { kind: 'team-group', ref: root.id, grantee: 'Viewer@Example.com', role: 'view' });
    expect(r.status).toBe(200);
    expect(r.body.granted).toEqual([{ owner: OWNER, grantee: VIEWER, kind: 'team-group', ref: root.id, role: 'view' }]);

    const docs = (await shared(env, VIEWER)).body.docs;
    expect(docs.map((d) => d.id).sort()).toEqual([root.id, variation.id].sort());
    expect(docs.every((d) => d.owner === OWNER && d.role === 'view')).toBe(true);
    expect(docs.some((d) => d.id === other.id)).toBe(false);
    // a stranger sees nothing, and the owner's own list isn't "shared with me"
    expect((await shared(env, STRANGER)).body.docs).toEqual([]);
    expect((await shared(env, OWNER)).body.docs).toEqual([]);
  });

  it('only a live top-level team of mine can be shared; not myself; valid e-mails only', async () => {
    const { env, variation } = await setup();
    expect((await share(env, { kind: 'team-group', ref: variation.id, grantee: VIEWER, role: 'view' })).status).toBe(400); // a variation, not a folder
    expect((await share(env, { kind: 'team-group', ref: 'nope', grantee: VIEWER, role: 'view' })).status).toBe(400);
    const mineOnly = await share(env, { kind: 'team-group', ref: 'g', grantee: OWNER, role: 'view' });
    expect(mineOnly.status).toBe(400);
    expect((await share(env, { kind: 'team-group', ref: 'g', grantee: 'not-an-email', role: 'view' })).status).toBe(400);
    expect((await share(env, { kind: 'matches', ref: '*', grantee: VIEWER, role: 'edit' })).status).toBe(400); // match logs are view only
    // someone else's folder can't be shared by a stranger
    const root = (await shared(env, OWNER)).body;
    expect(root.docs).toEqual([]);
  });

  it('stopping a share takes the folder away; the grantee can also leave', async () => {
    const { env, root } = await setup();
    await share(env, { kind: 'team-group', ref: root.id, grantee: VIEWER, role: 'view' });
    const left = await call<SharesResponse>(env, 'DELETE', '/api/shares', VIEWER, { kind: 'team-group', ref: root.id, grantee: VIEWER, owner: OWNER });
    expect(left.body.received).toEqual([]);
    expect((await shared(env, VIEWER)).body.docs).toEqual([]);

    await share(env, { kind: 'team-group', ref: root.id, grantee: VIEWER, role: 'view' });
    await call(env, 'DELETE', '/api/shares', OWNER, { kind: 'team-group', ref: root.id, grantee: VIEWER });
    expect((await shared(env, VIEWER)).body.docs).toEqual([]);
    // a stranger can't remove someone else's share
    await share(env, { kind: 'team-group', ref: root.id, grantee: VIEWER, role: 'view' });
    expect((await call(env, 'DELETE', '/api/shares', STRANGER, { kind: 'team-group', ref: root.id, grantee: VIEWER, owner: OWNER })).status).toBe(403);
    expect((await shared(env, VIEWER)).body.docs.length).toBe(2);
  });

  it('changing the role replaces it', async () => {
    const { env, root } = await setup();
    await share(env, { kind: 'team-group', ref: root.id, grantee: EDITOR, role: 'view' });
    const r = await share(env, { kind: 'team-group', ref: root.id, grantee: EDITOR, role: 'edit' });
    expect(r.body.granted).toHaveLength(1);
    expect(r.body.granted[0].role).toBe('edit');
  });
});

describe('writing to a shared folder', () => {
  const edited = (t: Team) => ({ ...t, name: 'Rain (edited)', updatedAt: NOW - 1000 });
  const push = (env: Env, who: string, docs: object[]) => call<PushResponse>(env, 'POST', '/api/shared', who, { docs });

  it('an editor can change the folder and add a variation; the owner sees it in their own sync', async () => {
    const { env, root, variation } = await setup();
    await share(env, { kind: 'team-group', ref: root.id, grantee: EDITOR, role: 'edit' });
    const added: Team = { ...cloneTeam(root, 'Rain', { groupId: root.id, variationLabel: 'by editor' }), updatedAt: NOW - 500 };
    const r = await push(env, EDITOR, [
      { ...doc(edited(variation)), owner: OWNER },
      { ...doc(added), owner: OWNER },
    ]);
    expect(r.body.results.map((x) => x.status)).toEqual(['applied', 'applied']);

    const own = (await call<PullResponse>(env, 'GET', '/api/sync?since=0', OWNER)).body.docs;
    expect((own.find((d) => d.id === variation.id)!.json as Team).name).toBe('Rain (edited)');
    expect(own.some((d) => d.id === added.id)).toBe(true);
    // and the editor's own account got nothing
    expect((await call<PullResponse>(env, 'GET', '/api/sync?since=0', EDITOR)).body.docs).toEqual([]);
  });

  it('an editor cannot delete the top-level team, but can delete a variation', async () => {
    const { env, root, variation } = await setup();
    await share(env, { kind: 'team-group', ref: root.id, grantee: EDITOR, role: 'edit' });
    const delRoot = await push(env, EDITOR, [{ id: root.id, kind: 'team', updatedAt: NOW - 100, deleted: true, owner: OWNER }]);
    expect(delRoot.body.results[0].status).toBe('denied');
    const delVar = await push(env, EDITOR, [{ id: variation.id, kind: 'team', updatedAt: NOW - 100, deleted: true, owner: OWNER }]);
    expect(delVar.body.results[0].status).toBe('applied');
  });

  it('a viewer, a stranger and the owner (through this route) cannot write', async () => {
    const { env, root } = await setup();
    await share(env, { kind: 'team-group', ref: root.id, grantee: VIEWER, role: 'view' });
    const before = (await call<PullResponse>(env, 'GET', '/api/sync?since=0', OWNER)).body.docs.find((d) => d.id === root.id)!;
    for (const who of [VIEWER, STRANGER]) {
      const r = await push(env, who, [{ ...doc(edited(root)), owner: OWNER }]);
      expect(r.body.results[0].status).toBe('denied');
    }
    expect((await push(env, OWNER, [{ ...doc(edited(root)), owner: OWNER }])).status).toBe(400);
    const after = (await call<PullResponse>(env, 'GET', '/api/sync?since=0', OWNER)).body.docs.find((d) => d.id === root.id)!;
    expect(after.updatedAt).toBe(before.updatedAt);
  });

  it("an editor can't move a team into or out of the folder, or touch another folder", async () => {
    const { env, root, other, variation } = await setup();
    await share(env, { kind: 'team-group', ref: root.id, grantee: EDITOR, role: 'edit' });
    // the owner's other, unshared team
    expect((await push(env, EDITOR, [{ ...doc(edited(other)), owner: OWNER }])).body.results[0].status).toBe('denied');
    // moving a team of the shared folder into the unshared one
    const moved = { ...edited(variation), groupId: other.id };
    expect((await push(env, EDITOR, [{ ...doc(moved), owner: OWNER }])).body.results[0].status).toBe('denied');
    // pulling an existing unshared team into the shared folder
    const pulled = { ...edited(other), groupId: root.id };
    expect((await push(env, EDITOR, [{ ...doc(pulled), owner: OWNER }])).body.results[0].status).toBe('denied');
  });

  it('an older edit is reported stale with the server version (same last-write-wins rule)', async () => {
    const { env, root } = await setup();
    await share(env, { kind: 'team-group', ref: root.id, grantee: EDITOR, role: 'edit' });
    const r = await push(env, EDITOR, [{ ...doc({ ...root, name: 'Old' }, { updatedAt: NOW - 90000 }), owner: OWNER }]);
    expect(r.body.results[0].status).toBe('stale');
    expect(r.body.results[0].doc?.id).toBe(root.id);
  });

  it('matches are never writable by a grantee', async () => {
    const { env, match } = await setup();
    await share(env, { kind: 'matches', ref: '*', grantee: EDITOR, role: 'view' });
    const r = await push(env, EDITOR, [{ id: match.id, kind: 'match', updatedAt: NOW - 100, deleted: true, owner: OWNER }]);
    expect(r.body.results[0].status).toBe('denied');
  });

  it('never stores a "shared" marker in an account', async () => {
    const { env, root } = await setup();
    await share(env, { kind: 'team-group', ref: root.id, grantee: EDITOR, role: 'edit' });
    await push(env, EDITOR, [{ ...doc({ ...edited(root), shared: { owner: 'x@y.z', role: 'edit' } } as Team), owner: OWNER }]);
    const own = (await call<PullResponse>(env, 'GET', '/api/sync?since=0', OWNER)).body.docs.find((d) => d.id === root.id)!;
    expect(own.json).not.toHaveProperty('shared');
  });
});

describe('sharing the match log', () => {
  it("is separate from teams, view only, and lists the owner's matches", async () => {
    const { env, match, root } = await setup();
    await share(env, { kind: 'matches', ref: '*', grantee: VIEWER, role: 'view' });
    let docs = (await shared(env, VIEWER)).body.docs;
    expect(docs.map((d) => d.id)).toEqual([match.id]);
    expect(docs[0].kind).toBe('match');
    await share(env, { kind: 'team-group', ref: root.id, grantee: VIEWER, role: 'view' });
    docs = (await shared(env, VIEWER)).body.docs;
    expect(docs).toHaveLength(3);
  });
});

describe('display names and the share list', () => {
  it('shows a display name the person set, to the people it is shared with', async () => {
    const { env, root } = await setup();
    expect((await call(env, 'PUT', '/api/profile', OWNER, { displayName: '  Ash  ' })).status).toBe(200);
    expect((await call(env, 'PUT', '/api/profile', OWNER, { displayName: 'x'.repeat(41) })).status).toBe(400);
    await share(env, { kind: 'team-group', ref: root.id, grantee: VIEWER, role: 'view' });
    const s = await call<SharesResponse>(env, 'GET', '/api/shares', VIEWER);
    expect(s.body.received).toHaveLength(1);
    expect(s.body.names[OWNER]).toBe('Ash');
    expect((await shared(env, VIEWER)).body.names[OWNER]).toBe('Ash');
    expect((await call<SharesResponse>(env, 'GET', '/api/shares', OWNER)).body.me).toEqual({ email: OWNER, displayName: 'Ash' });
  });

  it('caps how many things one person can share', async () => {
    const { env, root } = await setup();
    for (let i = 0; i < 50; i++) expect((await share(env, { kind: 'team-group', ref: root.id, grantee: `p${i}@example.com`, role: 'view' })).status).toBe(200);
    expect((await share(env, { kind: 'team-group', ref: root.id, grantee: 'p50@example.com', role: 'view' })).status).toBe(400);
  });
});
