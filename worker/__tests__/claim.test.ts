import { beforeAll, describe, expect, it } from 'vitest';
import { getFormat } from '../../src/domain/formats';
import { createMatch } from '../../src/domain/matches';
import { createTeam } from '../../src/domain/team';
import { formatCode } from '../../src/domain/pairing';
import type { PullResponse, PushDoc } from '../../src/domain/syncProtocol';
import { claimStatements, unclaimStatements } from '../claim';
import { bindSql } from '../../scripts/lib/adminSql';
import { PW, accountEnv, call as rawCall, cookieOf, newKeyBody, type AccountEnv, type CallOptions } from './accountHelpers';
import { NOW, goodClaims, makeKey, signJwt, type TestKey } from './helpers';

let key: TestKey;
beforeAll(async () => {
  key = await makeKey();
});
const ME = 'me@example.com';
const FRIEND = 'friend@example.com';

/** Every call at NOW (the Access JWTs are valid then), optionally with an Access JWT for `as`. */
async function call(env: AccountEnv, method: string, path: string, o: CallOptions & { as?: string } = {}) {
  const headers = { ...o.headers, ...(o.as ? { 'Cf-Access-Jwt-Assertion': await signJwt(key, goodClaims(o.as)) } : {}) };
  return rawCall(env, method, path, { ...o, headers, now: NOW, deps: { keys: async () => [key.jwk] } });
}
const team = (name: string) => ({ ...createTeam(getFormat('champions-vgc-reg-mc'), name), updatedAt: NOW - 5000, createdAt: NOW - 5000 });
const doc = (json: { id: string; updatedAt: number }, kind: 'team' | 'match' = 'team'): PushDoc => ({ id: json.id, kind, updatedAt: json.updatedAt, deleted: false, json });
const pull = async (env: AccountEnv, o: CallOptions & { as?: string }, since = 0, path = '/api/sync') => (await call(env, 'GET', `${path}?since=${since}`, o)).body as unknown as PullResponse;

/** What an Access user had before accounts: two teams, a match, a share to a friend, a name, a linked desktop app. */
async function legacyData(env: AccountEnv) {
  const t1 = team('Rain');
  const t2 = team('Sun');
  const m = { ...createMatch('2026-10-01'), createdAt: NOW - 4000, updatedAt: NOW - 4000 };
  const pushed = await call(env, "POST", "/api/sync", { as: ME, body: { docs: [doc(t1), doc(t2), doc(m, "match")] } });
  expect(pushed.status, pushed.text).toBe(200);
  expect((await call(env, 'PUT', '/api/shares', { as: ME, body: { kind: 'team-group', ref: t1.id, grantee: FRIEND, role: 'edit' } })).status).toBe(200);
  expect((await call(env, 'PUT', '/api/shares', { as: FRIEND, body: { kind: 'matches', ref: '*', grantee: ME, role: 'view' } })).status).toBe(200);
  await call(env, 'PUT', '/api/profile', { as: ME, body: { displayName: 'Ash K.' } });
  const code = (await call(env, 'POST', '/api/pair', { as: ME })).body.code as string;
  const token = (await call(env, 'POST', '/api/device/redeem', { body: { code: formatCode(code), name: 'Desktop' } })).body.token as string;
  const before = await pull(env, { as: ME });
  return { t1, t2, m, token, before };
}
async function signup(env: AccountEnv, username = 'ash') {
  const r = await call(env, 'POST', '/api/auth/signup', { body: { invite: env.SETUP_CODE, username, ...(await newKeyBody(PW)) } });
  expect(r.status).toBe(200);
  return { cookie: cookieOf(r)!, id: r.body.user.id as string };
}

describe('claiming', () => {
  it('a new account starts "pending"; the preview shows the Access e-mail and what it owns', async () => {
    const env = accountEnv();
    await legacyData(env);
    const { cookie } = await signup(env);
    expect((await call(env, 'GET', '/api/me', { cookie })).body).toMatchObject({ claim: 'pending', claimAvailable: true });
    const info = await call(env, 'GET', '/api/claim', { cookie, as: ME });
    expect(info.body).toMatchObject({ available: true, state: 'pending', fresh: true, email: ME, counts: { teams: 2, matches: 1, shares: 2, devices: 1 } });
    // Without the Access JWT there is nothing to preview.
    expect((await call(env, 'GET', '/api/claim', { cookie })).body.email).toBeUndefined();
  });

  it('needs the session and a verified Access JWT on the same request; the e-mail never comes from the body', async () => {
    const env = accountEnv();
    await legacyData(env);
    const { cookie } = await signup(env);
    expect((await call(env, 'POST', '/api/claim', { as: ME, body: {} })).status).toBe(401);
    expect((await call(env, 'POST', '/api/claim', { cookie, body: { email: ME } })).status).toBe(403);
    const forged = await call(env, 'POST', '/api/claim', { cookie, body: {}, headers: { 'Cf-Access-Jwt-Assertion': 'a.b.c' } });
    expect(forged.status).toBe(403);
    expect((await call(env, 'POST', '/api/claim', { cookie, as: ME, body: {}, ptb: false })).status).toBe(403); // CSRF
  });

  it('moves everything in one go and keeps every cursor valid: nothing is pulled again, no conflict copies', async () => {
    const env = accountEnv();
    const { before, token, t1 } = await legacyData(env);
    const { cookie, id } = await signup(env);
    const r = await call(env, 'POST', '/api/claim', { cookie, as: ME, body: {} });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ email: ME, counts: { teams: 2, matches: 1, shares: 2, devices: 1 } });

    // The phone keeps syncing through Access, now as the account: the old cursor brings nothing new...
    const after = await pull(env, { as: ME }, before.cursor);
    expect(after.docs).toEqual([]);
    expect(after.cursor).toBe(before.cursor);
    // ...and from the start it is the very same documents with the very same sequence numbers.
    expect((await pull(env, { as: ME })).docs).toEqual(before.docs);
    // A push continues the same sequence.
    const t3 = team('Sand');
    await call(env, 'POST', '/api/sync', { as: ME, body: { docs: [doc(t3)] } });
    const next = await pull(env, { as: ME }, before.cursor);
    expect(next.docs.map((d) => d.id)).toEqual([t3.id]);
    expect(next.docs[0].seq).toBe(before.cursor + 1);

    // The desktop app linked before keeps working, for the account.
    expect((await pull(env, { bearer: token }, 0, '/api/device/sync')).docs).toHaveLength(4);
    // Nothing is left under the e-mail.
    for (const table of ['documents', 'sync_seq', 'devices']) expect(env.DB.raw.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE owner = ?`).get(ME)).toEqual({ n: 0 });
    expect(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM shares WHERE owner = ? OR grantee = ?').get(ME, ME)).toEqual({ n: 0 });
    // The name moved to the account; the account knows where it came from.
    expect(env.DB.raw.prepare('SELECT display_name, legacy_email, claim_state FROM users WHERE id = ?').get(id)).toEqual({ display_name: 'Ash K.', legacy_email: ME, claim_state: 'claimed' });
    expect(env.DB.raw.prepare('SELECT legacy_email, docs, matches, shares, devices FROM account_claims').get()).toEqual({ legacy_email: ME, docs: 2, matches: 1, shares: 2, devices: 1 });
    expect(env.DB.raw.prepare("SELECT actor, kind, target FROM events WHERE kind = 'account.claim'").get()).toEqual({ actor: id, kind: 'account.claim', target: id });

    // The friend still sees the shared folder, now from the account (named by its display name), and can edit it.
    const shared = await call(env, 'GET', '/api/shared', { as: FRIEND });
    expect(shared.body.docs.map((d: { owner: string; id: string }) => [d.owner, d.id])).toEqual([[id, t1.id]]);
    expect(shared.body.names[id]).toBe('Ash K.');
    const edited = { ...t1, name: 'Rain (edited)', updatedAt: NOW - 100 };
    const w = await call(env, 'POST', '/api/shared', { as: FRIEND, body: { docs: [{ ...doc(edited), owner: id }] } });
    expect(w.body.results).toEqual([{ id: t1.id, kind: 'team', status: 'applied' }]);
    // And sharing with my old e-mail now reaches the account.
    const tf = team('Friend team');
    await call(env, 'POST', '/api/sync', { as: FRIEND, body: { docs: [doc(tf)] } });
    expect((await call(env, 'PUT', '/api/shares', { as: FRIEND, body: { kind: 'team-group', ref: tf.id, grantee: ME, role: 'view' } })).status).toBe(200);
    expect(env.DB.raw.prepare('SELECT grantee FROM shares WHERE ref = ?').get(tf.id)).toEqual({ grantee: id });
    // The account sees what it was given, whichever way it signs in.
    const mine = await call(env, 'GET', '/api/shares', { as: ME });
    expect(mine.body.me.email).toBe(id);
    expect(mine.body.received).toHaveLength(2);
  });

  it('refuses a second claim, an e-mail another account already claimed, and an account with data of its own', async () => {
    const env = accountEnv();
    await legacyData(env);
    const ash = await signup(env);
    expect((await call(env, 'POST', '/api/claim', { cookie: ash.cookie, as: ME, body: {} })).status).toBe(200);
    expect((await call(env, 'POST', '/api/claim', { cookie: ash.cookie, as: FRIEND, body: {} })).status).toBe(409);

    // A second account, through an invite.
    const inv = await call(env, 'POST', '/api/admin/invites', { cookie: ash.cookie, body: {} });
    const r = await call(env, 'POST', '/api/auth/signup', { body: { invite: inv.body.code, username: 'gary', ...(await newKeyBody(PW)) } });
    const gary = { cookie: cookieOf(r)!, id: r.body.user.id as string };
    const taken = await call(env, 'POST', '/api/claim', { cookie: gary.cookie, as: ME, body: {} });
    expect(taken.status).toBe(409);
    expect(taken.body.error).toMatch(/Another account/);
    // Not fresh: it has a document of its own.
    env.DB.raw.prepare("INSERT INTO documents (owner, kind, id, json, updated_at, deleted, server_seq) VALUES (?, 'team', 'x', '{}', 1, 0, 1)").run(gary.id);
    const busy = await call(env, 'POST', '/api/claim', { cookie: gary.cookie, as: FRIEND, body: {} });
    expect(busy.status).toBe(409);
    expect(busy.body.error).toMatch(/of its own/);
    expect(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM documents WHERE owner = ?').get(FRIEND)).toEqual({ n: 0 }); // the friend's empty account is untouched either way
    expect(env.DB.raw.prepare('SELECT legacy_email FROM users WHERE id = ?').get(gary.id)).toEqual({ legacy_email: null });
  });

  it('only while Access is in front (AUTH_MODE "both")', async () => {
    const env = accountEnv();
    await legacyData(env);
    const { cookie } = await signup(env);
    const later = { ...env, AUTH_MODE: 'accounts' };
    expect((await call(later, 'POST', '/api/claim', { cookie, as: ME, body: {} })).status).toBe(409);
    expect((await call(later, 'GET', '/api/claim', { cookie })).body).toMatchObject({ available: false });
    expect((await call({ ...env, AUTH_MODE: 'access' }, 'POST', '/api/claim', { cookie, as: ME, body: {} })).status).not.toBe(200);
  });

  it('skip: the account is no longer "pending" and can still claim while it is fresh', async () => {
    const env = accountEnv();
    await legacyData(env);
    const { cookie } = await signup(env);
    expect((await call(env, 'POST', '/api/claim/skip', { cookie, body: {} })).status).toBe(200);
    expect((await call(env, 'GET', '/api/me', { cookie })).body.claim).toBe('skipped');
    expect((await call(env, 'POST', '/api/claim', { cookie, as: ME, body: {} })).status).toBe(200);
  });

  it('accounts made without Access in front have nothing to bring', async () => {
    const env = accountEnv({ AUTH_MODE: 'accounts' });
    const { cookie } = await signup(env);
    expect((await call(env, 'GET', '/api/me', { cookie })).body).toMatchObject({ claim: 'skipped', claimAvailable: false });
  });

  it('a claimed account an admin disabled can’t keep syncing through Access or its old desktop link', async () => {
    const env = accountEnv();
    const { token } = await legacyData(env);
    const { cookie, id } = await signup(env);
    await call(env, 'POST', '/api/claim', { cookie, as: ME, body: {} });
    env.DB.raw.prepare('UPDATE users SET disabled = 1 WHERE id = ?').run(id);
    expect((await call(env, 'GET', '/api/sync?since=0', { as: ME })).status).toBe(403);
    expect((await call(env, 'GET', '/api/device/sync?since=0', { bearer: token })).status).toBe(401);
  });
});

describe('unclaim (npm run admin -- unclaim)', () => {
  it('puts everything back under the e-mail, with the same sequence numbers; the account can claim again', async () => {
    const env = accountEnv();
    const { before } = await legacyData(env);
    const { cookie, id } = await signup(env);
    await call(env, 'POST', '/api/claim', { cookie, as: ME, body: {} });
    // The script's SQL (bound values) does what the Worker's batch would.
    for (const q of unclaimStatements(ME, id, NOW + 1, 'cli')) env.DB.raw.exec(bindSql(q.sql, q.values));
    expect(env.DB.raw.prepare('SELECT legacy_email, claim_state FROM users WHERE id = ?').get(id)).toEqual({ legacy_email: null, claim_state: 'pending' });
    expect(env.DB.raw.prepare('SELECT undone_at FROM account_claims').get()).toEqual({ undone_at: NOW + 1 });
    expect((await pull(env, { as: ME })).docs).toEqual(before.docs);
    expect(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM devices WHERE owner = ?').get(ME)).toEqual({ n: 1 });
    const again = await call(env, 'POST', '/api/claim', { cookie, as: ME, body: {} });
    expect(again.status).toBe(200);
  });

  it('the claim SQL is the same through the script: a refused claim changes nothing', async () => {
    const env = accountEnv();
    await legacyData(env);
    const { id } = await signup(env);
    env.DB.raw.prepare("INSERT INTO documents (owner, kind, id, json, updated_at, deleted, server_seq) VALUES (?, 'team', 'x', '{}', 1, 0, 1)").run(id);
    for (const q of claimStatements(ME, id, NOW, 'cli')) env.DB.raw.exec(bindSql(q.sql, q.values));
    expect(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM documents WHERE owner = ?').get(ME)).toEqual({ n: 3 });
    expect(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM account_claims').get()).toEqual({ n: 0 });
  });
});
