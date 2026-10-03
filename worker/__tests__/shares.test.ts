import { beforeAll, describe, expect, it } from 'vitest';
import { getFormat } from '../../src/domain/formats';
import { createMatch } from '../../src/domain/matches';
import { cloneTeam, createTeam } from '../../src/domain/team';
import type { PullResponse, PushResponse, SharedResponse, SharesResponse } from '../../src/domain/syncProtocol';
import { handleApi } from '../api';
import { NOW, goodClaims, makeEnv, makeKey, signJwt, type TestKey } from './helpers';

let key: TestKey;
beforeAll(async () => {
  key = await makeKey();
});

type Env = ReturnType<typeof makeEnv>;
const OWNER = 'owner@example.com';
const VIEWER = 'viewer@example.com';
const EDITOR = 'editor@example.com';
const STRANGER = 'stranger@example.com';

async function call(env: Env, method: string, path: string, who: string, body?: unknown) {
  const headers = { 'Cf-Access-Jwt-Assertion': await signJwt(key, goodClaims(who)) };
  const res = await handleApi(new Request(`https://app.example${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, { keys: async () => [key.jwk], now: () => NOW });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}
const sharedFor = async (env: Env, who: string) => (await call(env, 'GET', '/api/shared', who)).body as unknown as SharedResponse;
const shareOp = (env: Env, who: string, op: Record<string, unknown>) => call(env, 'POST', '/api/shares', who, op);

const mk = (name: string, over: object = {}) => ({ ...createTeam(getFormat('champions-vgc-reg-mc'), name), updatedAt: NOW - 5000, createdAt: NOW - 5000, ...over });
const doc = (t: { id: string; updatedAt: number }) => ({ id: t.id, kind: 'team', updatedAt: t.updatedAt, deleted: false, json: t });

/** The owner has a shared-able folder (root + one variation), an unrelated team and a match. */
async function world() {
  const env = makeEnv();
  const root = mk('Rain');
  const variation = { ...cloneTeam(root, 'Rain', { groupId: root.id, variationLabel: 'vs Sun' }), updatedAt: NOW - 4000 };
  const other = mk('Private');
  const match = { ...createMatch('2026-10-01'), updatedAt: NOW - 3000 };
  const r = await call(env, 'POST', '/api/sync', OWNER, { docs: [doc(root), doc(variation), doc(other), { id: match.id, kind: 'match', updatedAt: match.updatedAt, deleted: false, json: match }] });
  expect(r.body).not.toHaveProperty('error');
  return { env, root, variation, other, match };
}

describe('access matrix: owner / viewer / editor / stranger', () => {
  it('reads: only people the folder is shared with see it, and only that folder', async () => {
    const { env, root, variation, other } = await world();
    expect((await shareOp(env, OWNER, { op: 'share', folderId: root.id, grantee: VIEWER, role: 'view' })).status).toBe(200);
    expect((await shareOp(env, OWNER, { op: 'share', folderId: root.id, grantee: EDITOR, role: 'edit' })).status).toBe(200);

    for (const who of [VIEWER, EDITOR]) {
      const s = await sharedFor(env, who);
      expect(s.folders).toHaveLength(1);
      expect(s.folders[0]).toMatchObject({ owner: OWNER, folderId: root.id, role: who === VIEWER ? 'view' : 'edit' });
      expect(s.folders[0].docs.map((d) => d.id).sort()).toEqual([root.id, variation.id].sort());
      expect(s.folders[0].docs.some((d) => d.id === other.id)).toBe(false);
      expect(s.matches).toEqual([]);
    }
    expect(await sharedFor(env, STRANGER)).toMatchObject({ folders: [], matches: [] });
    // The owner's own view of their account is unchanged and never lists themselves as a grantee.
    expect(((await call(env, 'GET', '/api/sync?since=0', OWNER)).body as unknown as PullResponse).docs).toHaveLength(4);
    expect(await sharedFor(env, OWNER)).toMatchObject({ folders: [], matches: [] });
  });

  it('writes: a viewer and a stranger are refused, an editor can edit and add variations', async () => {
    const { env, root, variation } = await world();
    await shareOp(env, OWNER, { op: 'share', folderId: root.id, grantee: VIEWER, role: 'view' });
    await shareOp(env, OWNER, { op: 'share', folderId: root.id, grantee: EDITOR, role: 'edit' });
    const edited = { ...variation, name: 'Rain (edited)', updatedAt: NOW - 1000 };
    const push = (who: string, docs: unknown[]) => call(env, 'POST', '/api/shared', who, { owner: OWNER, docs });

    expect((await push(VIEWER, [doc(edited)])).status).toBe(403);
    expect((await push(STRANGER, [doc(edited)])).status).toBe(403);
    expect((await push(OWNER, [doc(edited)])).status).toBe(400); // the owner uses /api/sync

    const ok = await push(EDITOR, [doc(edited)]);
    expect(ok.status).toBe(200);
    expect((ok.body as unknown as PushResponse).results[0].status).toBe('applied');
    const added = { ...cloneTeam(variation, 'Rain', { groupId: root.id, variationLabel: 'Conflict copy' }), updatedAt: NOW - 500 };
    expect((await push(EDITOR, [doc(added)])).status).toBe(200);

    // The owner's next pull has both, marked as made by the editor; nothing was written by the viewer.
    const pulled = ((await call(env, 'GET', '/api/sync?since=0', OWNER)).body as unknown as PullResponse).docs;
    expect(pulled.find((d) => d.id === variation.id)).toMatchObject({ by: EDITOR });
    expect((pulled.find((d) => d.id === variation.id)!.json as { name: string }).name).toBe('Rain (edited)');
    expect(pulled.some((d) => d.id === added.id)).toBe(true);
    expect(pulled.find((d) => d.id === root.id)!.by).toBeUndefined();
  });

  it("an editor stays inside the folder: not the owner's other teams, no moves, no new or deleted root, no matches", async () => {
    const { env, root, variation, other, match } = await world();
    await shareOp(env, OWNER, { op: 'share', folderId: root.id, grantee: EDITOR, role: 'edit' });
    const push = (docs: unknown[]) => call(env, 'POST', '/api/shared', EDITOR, { owner: OWNER, docs });
    const later = NOW - 100;

    expect((await push([doc({ ...other, updatedAt: later })])).status).toBe(403); // someone else's folder
    expect((await push([doc({ ...variation, groupId: other.id, updatedAt: later })])).status).toBe(403); // moved out
    expect((await push([doc({ ...mk('New root'), updatedAt: later })])).status).toBe(403); // a root of their own making
    expect((await push([doc({ ...root, groupId: variation.id, updatedAt: later })])).status).toBe(403); // root turned into a variation
    expect((await push([{ id: root.id, kind: 'team', updatedAt: later, deleted: true }])).status).toBe(403); // root deleted
    expect((await push([{ id: other.id, kind: 'team', updatedAt: later, deleted: true }])).status).toBe(403);
    expect((await push([{ id: match.id, kind: 'match', updatedAt: later, deleted: false, json: match }])).status).toBe(403);
    // …but a variation can be deleted, and the delete reaches the owner.
    expect((await push([{ id: variation.id, kind: 'team', updatedAt: later, deleted: true }])).status).toBe(200);
    const pulled = ((await call(env, 'GET', '/api/sync?since=0', OWNER)).body as unknown as PullResponse).docs;
    expect(pulled.find((d) => d.id === variation.id)).toMatchObject({ deleted: true, by: EDITOR });
    // The owner's private team was never touched.
    expect(pulled.find((d) => d.id === other.id)!.deleted).toBe(false);
  });

  it('a mixed batch is all-or-nothing: one refused document stops the others', async () => {
    const { env, root, variation, other } = await world();
    await shareOp(env, OWNER, { op: 'share', folderId: root.id, grantee: EDITOR, role: 'edit' });
    const r = await call(env, 'POST', '/api/shared', EDITOR, { owner: OWNER, docs: [doc({ ...variation, name: 'X', updatedAt: NOW - 50 }), doc({ ...other, updatedAt: NOW - 50 })] });
    expect(r.status).toBe(403);
    const pulled = ((await call(env, 'GET', '/api/sync?since=0', OWNER)).body as unknown as PullResponse).docs;
    expect((pulled.find((d) => d.id === variation.id)!.json as { name: string }).name).toBe('Rain');
  });

  it('revoking, changing a role and leaving take effect on the next request', async () => {
    const { env, root, variation } = await world();
    await shareOp(env, OWNER, { op: 'share', folderId: root.id, grantee: EDITOR, role: 'edit' });
    const edit = (t: number) => call(env, 'POST', '/api/shared', EDITOR, { owner: OWNER, docs: [doc({ ...variation, updatedAt: t })] });
    expect((await edit(NOW - 900)).status).toBe(200);
    await shareOp(env, OWNER, { op: 'share', folderId: root.id, grantee: EDITOR, role: 'view' });
    expect((await edit(NOW - 800)).status).toBe(403);
    expect((await sharedFor(env, EDITOR)).folders[0].role).toBe('view');
    await shareOp(env, OWNER, { op: 'unshare', folderId: root.id, grantee: EDITOR });
    expect((await sharedFor(env, EDITOR)).folders).toEqual([]);

    await shareOp(env, OWNER, { op: 'share', folderId: root.id, grantee: VIEWER, role: 'view' });
    expect((await shareOp(env, VIEWER, { op: 'leave', owner: OWNER, folderId: root.id })).status).toBe(200);
    expect((await sharedFor(env, VIEWER)).folders).toEqual([]);
  });

  it('only the owner can share, and only a synced folder root, and not with themselves', async () => {
    const { env, root, variation } = await world();
    expect((await shareOp(env, VIEWER, { op: 'share', folderId: root.id, grantee: STRANGER, role: 'view' })).status).toBe(404); // not theirs
    expect((await shareOp(env, OWNER, { op: 'share', folderId: variation.id, grantee: VIEWER, role: 'view' })).status).toBe(404); // a variation isn't a folder
    expect((await shareOp(env, OWNER, { op: 'share', folderId: 'nope', grantee: VIEWER, role: 'view' })).status).toBe(404);
    expect((await shareOp(env, OWNER, { op: 'share', folderId: root.id, grantee: OWNER, role: 'view' })).status).toBe(400);
    expect((await shareOp(env, OWNER, { op: 'share', folderId: root.id, grantee: 'not an email', role: 'view' })).status).toBe(400);
    expect((await shareOp(env, OWNER, { op: 'share', folderId: root.id, grantee: VIEWER, role: 'admin' })).status).toBe(400);
    expect((await sharedFor(env, STRANGER)).folders).toEqual([]);
    // An editor can't hand the folder on.
    await shareOp(env, OWNER, { op: 'share', folderId: root.id, grantee: EDITOR, role: 'edit' });
    expect((await shareOp(env, EDITOR, { op: 'share', folderId: root.id, grantee: STRANGER, role: 'view' })).status).toBe(404);
  });

  it('grantee e-mails are case-insensitive', async () => {
    const { env, root } = await world();
    await shareOp(env, OWNER, { op: 'share', folderId: root.id, grantee: ' Viewer@Example.COM ', role: 'view' });
    expect((await sharedFor(env, VIEWER)).folders).toHaveLength(1);
  });

  it('the match log is private unless shared, per person, and read-only', async () => {
    const { env, match } = await world();
    expect((await sharedFor(env, VIEWER)).matches).toEqual([]);
    expect((await shareOp(env, OWNER, { op: 'shareMatches', grantee: VIEWER, enabled: true })).status).toBe(200);
    const s = await sharedFor(env, VIEWER);
    expect(s.matches).toHaveLength(1);
    expect(s.matches[0]).toMatchObject({ owner: OWNER });
    expect(s.matches[0].docs.map((d) => d.id)).toEqual([match.id]);
    expect((await sharedFor(env, STRANGER)).matches).toEqual([]);
    expect(((await call(env, 'GET', '/api/shares', OWNER)).body as unknown as SharesResponse).matchGrantees).toEqual([VIEWER]);
    // Sharing the log shares no teams, and sharing a team shares no matches.
    expect(s.folders).toEqual([]);
    await shareOp(env, OWNER, { op: 'shareMatches', grantee: VIEWER, enabled: false });
    expect((await sharedFor(env, VIEWER)).matches).toEqual([]);
  });

  it('a deleted match is not shared', async () => {
    const { env, match } = await world();
    await shareOp(env, OWNER, { op: 'shareMatches', grantee: VIEWER, enabled: true });
    await call(env, 'POST', '/api/sync', OWNER, { docs: [{ id: match.id, kind: 'match', updatedAt: NOW - 10, deleted: true }] });
    expect((await sharedFor(env, VIEWER)).matches[0].docs).toEqual([]);
  });

  it('display names show up as the owner and as the editor, and can be cleared', async () => {
    const { env, root, variation } = await world();
    expect(((await call(env, 'POST', '/api/shares', OWNER, { op: 'profile', displayName: 'Ash' })).body as unknown as SharesResponse).displayName).toBe('Ash');
    await call(env, 'POST', '/api/shares', EDITOR, { op: 'profile', displayName: 'Misty' });
    await shareOp(env, OWNER, { op: 'share', folderId: root.id, grantee: EDITOR, role: 'edit' });
    expect((await sharedFor(env, EDITOR)).folders[0].ownerName).toBe('Ash');
    await call(env, 'POST', '/api/shared', EDITOR, { owner: OWNER, docs: [doc({ ...variation, name: 'Z', updatedAt: NOW - 20 })] });
    const pulled = ((await call(env, 'GET', '/api/sync?since=0', OWNER)).body as unknown as PullResponse).docs;
    expect(pulled.find((d) => d.id === variation.id)!.by).toBe('Misty');
    await call(env, 'POST', '/api/shares', OWNER, { op: 'profile', displayName: '' });
    expect(((await call(env, 'GET', '/api/shares', OWNER)).body as unknown as SharesResponse).displayName).toBe('');
    expect((await call(env, 'POST', '/api/shares', OWNER, { op: 'profile', displayName: 'x'.repeat(41) })).status).toBe(400);
  });

  it('an owner moving a team out of a shared folder takes it away from the grantees', async () => {
    const { env, root, variation } = await world();
    await shareOp(env, OWNER, { op: 'share', folderId: root.id, grantee: VIEWER, role: 'view' });
    await call(env, 'POST', '/api/sync', OWNER, { docs: [doc({ ...variation, groupId: undefined, updatedAt: NOW - 10 })] });
    expect((await sharedFor(env, VIEWER)).folders[0].docs.map((d) => d.id)).toEqual([root.id]);
  });

  it('needs a signed-in caller on every route', async () => {
    const env = makeEnv();
    for (const path of ['/api/shared', '/api/shares']) {
      const res = await handleApi(new Request(`https://app.example${path}`), env, { keys: async () => [key.jwk], now: () => NOW });
      expect(res.status).toBe(401);
    }
  });
});
