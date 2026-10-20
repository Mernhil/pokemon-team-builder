/** Step 5: sync and sharing identified by the account session (cookie or bearer), with the Access JWT behind it. */
import { beforeAll, describe, expect, it } from 'vitest';
import { getFormat } from '../../src/domain/formats';
import { docKey, type LocalDoc } from '../../src/domain/sync';
import type { PushDoc } from '../../src/domain/syncProtocol';
import { createTeam } from '../../src/domain/team';
import { formatCode } from '../../src/domain/pairing';
import { syncOnce, type LocalStore, type SyncApi, type SyncState } from '../../src/sync/engine';
import { DESKTOP, PW, accountEnv, call as rawCall, cookieOf, keyFor, newKeyBody, type AccountEnv, type CallOptions } from './accountHelpers';
import { NOW, goodClaims, makeKey, signJwt, type TestKey } from './helpers';

let key: TestKey;
beforeAll(async () => {
  key = await makeKey();
});
const ME = 'me@example.com';

async function call(env: AccountEnv, method: string, path: string, o: CallOptions & { as?: string } = {}) {
  const headers = { ...o.headers, ...(o.as ? { 'Cf-Access-Jwt-Assertion': await signJwt(key, goodClaims(o.as)) } : {}) };
  return rawCall(env, method, path, { ...o, headers, now: o.now ?? NOW, deps: { keys: async () => [key.jwk] } });
}
const team = (name: string, at = NOW - 5000) => ({ ...createTeam(getFormat('champions-vgc-reg-mc'), name), updatedAt: at, createdAt: at });
const doc = (t: { id: string; updatedAt: number }): PushDoc => ({ id: t.id, kind: 'team', updatedAt: t.updatedAt, deleted: false, json: t });

async function signup(env: AccountEnv, username: string, invite = env.SETUP_CODE) {
  const r = await call(env, 'POST', '/api/auth/signup', { body: { invite, username, ...(await newKeyBody(PW)) } });
  expect(r.status).toBe(200);
  return { cookie: cookieOf(r)!, id: r.body.user.id as string };
}
async function invite(env: AccountEnv, adminCookie: string) {
  return (await call(env, 'POST', '/api/admin/invites', { cookie: adminCookie, body: {} })).body.code as string;
}
const skip = (env: AccountEnv, cookie: string) => call(env, 'POST', '/api/claim/skip', { cookie, body: {} });

describe('sync by session', () => {
  it('waits while the account hasn’t decided about its data from before; then syncs as the account', async () => {
    const env = accountEnv();
    const { cookie, id } = await signup(env, 'ash');
    const blocked = await call(env, 'GET', '/api/sync?since=0', { cookie });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('claim-pending');
    await skip(env, cookie);
    const t = team('Rain');
    expect((await call(env, 'POST', '/api/sync', { cookie, body: { docs: [doc(t)] } })).status).toBe(200);
    expect(env.DB.raw.prepare('SELECT owner FROM documents').all()).toEqual([{ owner: id }]);
    expect((await call(env, 'GET', '/api/sync?since=0', { cookie })).body.docs).toHaveLength(1);
  });

  it('a cookie write needs our page (CSRF); a read doesn’t', async () => {
    const env = accountEnv();
    const { cookie } = await signup(env, 'ash');
    await skip(env, cookie);
    expect((await call(env, 'POST', '/api/sync', { cookie, body: { docs: [] }, ptb: false })).status).toBe(403);
    expect((await call(env, 'POST', '/api/sync', { cookie, body: { docs: [] }, origin: 'https://evil.example' })).status).toBe(403);
    expect((await call(env, 'GET', '/api/sync?since=0', { cookie, ptb: false, origin: null })).status).toBe(200);
  });

  it('the session comes before Access; without a session Access still works; with neither (Access gone) it is 401', async () => {
    const env = accountEnv();
    const legacy = team('From Access');
    await call(env, 'POST', '/api/sync', { as: ME, body: { docs: [doc(legacy)] } });
    const { cookie } = await signup(env, 'ash');
    await call(env, 'POST', '/api/claim', { cookie, as: ME, body: {} });
    // Same identity either way after the claim.
    const viaSession = await call(env, 'GET', '/api/sync?since=0', { cookie, as: ME });
    const viaAccess = await call(env, 'GET', '/api/sync?since=0', { as: ME });
    expect(viaSession.body).toEqual(viaAccess.body);
    // A revoked session falls back to Access while it is in front...
    await call(env, 'POST', '/api/auth/logout', { cookie, body: {} });
    expect((await call(env, 'GET', '/api/sync?since=0', { cookie, as: ME })).status).toBe(200);
    // ...and without Access there is nothing to fall back on.
    const later = { ...env, AUTH_MODE: 'accounts', ACCESS_TEAM_DOMAIN: undefined, ACCESS_AUD: undefined };
    expect((await call(later, 'GET', '/api/sync?since=0', { cookie })).status).toBe(401);
  });

  it('with AUTH_MODE "access" a session cookie means nothing', async () => {
    const env = accountEnv();
    const { cookie } = await signup(env, 'ash');
    await skip(env, cookie);
    expect((await call({ ...env, AUTH_MODE: 'access' }, 'GET', '/api/sync?since=0', { cookie })).status).toBe(401);
  });

  it('a renewed session sets the cookie again on a sync answer', async () => {
    const env = accountEnv();
    const { cookie } = await signup(env, 'ash');
    await skip(env, cookie);
    const r = await call(env, 'GET', '/api/sync?since=0', { cookie, now: NOW + 2 * 86_400_000 });
    expect(r.status).toBe(200);
    expect(r.headers.get('set-cookie')).toContain(cookie.split('=')[1]);
  });
});

describe('the desktop app with its account', () => {
  it('syncs under /api/device/ with its session token; signs itself out; the old pairing token still works', async () => {
    const env = accountEnv();
    const { cookie } = await signup(env, 'ash');
    await skip(env, cookie);
    const login = await call(env, 'POST', '/api/device/auth/login', { body: { username: 'ash', key: await keyFor(env, 'ash', PW), mode: 'token' }, origin: DESKTOP });
    const token = login.body.token as string;
    const t = team('Desk');
    expect((await call(env, 'POST', '/api/device/sync', { bearer: token, origin: DESKTOP, body: { docs: [doc(t)] } })).status).toBe(200);
    expect((await call(env, 'GET', '/api/sync?since=0', { cookie })).body.docs.map((d: { id: string }) => d.id)).toEqual([t.id]);
    expect((await call(env, 'DELETE', '/api/device/self', { bearer: token, origin: DESKTOP })).status).toBe(200);
    expect((await call(env, 'GET', '/api/device/sync?since=0', { bearer: token, origin: DESKTOP })).status).toBe(401);

    // A desktop app linked with a pairing code before keeps working until the last step.
    const code = (await call(env, 'POST', '/api/pair', { as: ME })).body.code as string;
    const ptbd = (await call(env, 'POST', '/api/device/redeem', { body: { code: formatCode(code), name: 'Old desktop' } })).body.token as string;
    expect((await call(env, 'GET', '/api/device/sync?since=0', { bearer: ptbd })).status).toBe(200);
  });

  it('waits too while the account is pending', async () => {
    const env = accountEnv();
    await signup(env, 'ash');
    const login = await call(env, 'POST', '/api/device/auth/login', { body: { username: 'ash', key: await keyFor(env, 'ash', PW), mode: 'token' }, origin: DESKTOP });
    expect((await call(env, 'GET', '/api/device/sync?since=0', { bearer: login.body.token, origin: DESKTOP })).status).toBe(409);
  });
});

describe('sharing between accounts', () => {
  it('by @username, keyed by id, shown by name; a disabled account’s shares disappear and come back', async () => {
    const env = accountEnv();
    const ash = await signup(env, 'ash');
    await skip(env, ash.cookie);
    const misty = await signup(env, 'Misty', await invite(env, ash.cookie));
    await skip(env, misty.cookie);
    await call(env, 'PUT', '/api/me', { cookie: misty.cookie, body: { displayName: 'Misty W.' } });
    const t = team('Rain');
    await call(env, 'POST', '/api/sync', { cookie: ash.cookie, body: { docs: [doc(t)] } });
    expect((await call(env, 'PUT', '/api/shares', { cookie: ash.cookie, body: { kind: 'team-group', ref: t.id, grantee: '@nobody', role: 'view' } })).status).toBe(400);
    const shared = await call(env, 'PUT', '/api/shares', { cookie: ash.cookie, body: { kind: 'team-group', ref: t.id, grantee: '@misty', role: 'edit' } });
    expect(shared.status).toBe(200);
    expect(shared.body.granted).toEqual([{ owner: ash.id, grantee: misty.id, kind: 'team-group', ref: t.id, role: 'edit' }]);
    expect(shared.body.names[misty.id]).toBe('Misty W.');
    expect(shared.body.names[ash.id]).toBe('ash');

    const got = await call(env, 'GET', '/api/shared', { cookie: misty.cookie });
    expect(got.body.docs.map((d: { owner: string; id: string }) => [d.owner, d.id])).toEqual([[ash.id, t.id]]);
    // Ids keep their case on the way back in.
    const edited = { ...t, name: 'Rain 2', updatedAt: NOW - 10 };
    expect((await call(env, 'POST', '/api/shared', { cookie: misty.cookie, body: { docs: [{ ...doc(edited), owner: ash.id }] } })).body.results[0].status).toBe('applied');

    // Ash is disabled: Misty no longer sees the share; Ash's own list hides nothing of hers either way.
    env.DB.raw.prepare('UPDATE users SET disabled = 1 WHERE id = ?').run(ash.id);
    expect((await call(env, 'GET', '/api/shared', { cookie: misty.cookie })).body.docs).toEqual([]);
    expect((await call(env, 'GET', '/api/shares', { cookie: misty.cookie })).body.received).toEqual([]);
    env.DB.raw.prepare('UPDATE users SET disabled = 0 WHERE id = ?').run(ash.id);
    expect((await call(env, 'GET', '/api/shared', { cookie: misty.cookie })).body.docs).toHaveLength(1);
    // Leaving a share names the owner by id.
    const left = await call(env, 'DELETE', '/api/shares', { cookie: misty.cookie, body: { kind: 'team-group', ref: t.id, grantee: misty.id, owner: ash.id } });
    expect(left.body.received).toEqual([]);
  });
});

describe('a device that synced through Access, then logs in after the claim', () => {
  it('keeps its cursor: nothing is pulled again and nothing becomes a conflict copy', async () => {
    const env = accountEnv();
    const docs = new Map<string, LocalDoc>();
    let state: SyncState = { cursor: 0, known: {} };
    const store: LocalStore = {
      list: () => [...docs.values()],
      apply: ({ upserts, deletes }) => {
        for (const d of upserts) docs.set(docKey(d.kind, d.id), d);
        for (const d of deletes) docs.delete(docKey(d.kind, d.id));
      },
    };
    let who: CallOptions & { as?: string } = { as: ME };
    const go = async (method: string, path: string, body?: unknown) => {
      const r = await call(env, method, path, { ...who, body });
      if (r.status !== 200) throw new Error(`${r.status} ${r.text}`);
      return r.body as never;
    };
    const api: SyncApi = { pull: (since) => go('GET', `/api/sync?since=${since}`), push: (batch) => go('POST', '/api/sync', { docs: batch }) };
    const run = async () => {
      const r = await syncOnce({ store, api, state, save: (s) => (state = s), deviceName: 'Phone', now: () => NOW });
      state = r.state;
      return r.stats;
    };
    for (const name of ['Rain', 'Sun', 'Sand']) {
      const t = team(name);
      docs.set(docKey('team', t.id), { id: t.id, kind: 'team', updatedAt: t.updatedAt, json: t });
    }
    expect((await run()).pushed).toBe(3);
    // A second run settles it (the next pull reads back what this device pushed, without changing anything).
    expect(await run()).toMatchObject({ pushed: 0, updated: 0, conflicts: 0 });
    const cursor = state.cursor;

    const { cookie } = await signup(env, 'ash');
    await call(env, 'POST', '/api/claim', { cookie, as: ME, body: {} });
    who = { cookie }; // the same device, now with its account session
    const after = await run();
    expect(after).toMatchObject({ pulled: 0, pushed: 0, updated: 0, conflicts: 0 });
    expect(state.cursor).toBe(cursor);
    expect(docs.size).toBe(3);
  });
});
