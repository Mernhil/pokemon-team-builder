import { beforeAll, describe, expect, it } from 'vitest';
import { createTeam } from '../../src/domain/team';
import { CODE_TTL_MS, MAX_DEVICES, MAX_LIVE_CODES, formatCode } from '../../src/domain/pairing';
import { handleApi } from '../api';
import { NOW, goodClaims, makeEnv, makeKey, signJwt, type TestKey } from './helpers';

let key: TestKey;
beforeAll(async () => {
  key = await makeKey();
});

type Env = ReturnType<typeof makeEnv>;
let clock = NOW;
const deps = () => ({ keys: async () => [key.jwk], now: () => clock });

async function access(env: Env, method: string, path: string, who: string, body?: unknown) {
  const headers = { 'Cf-Access-Jwt-Assertion': await signJwt(key, goodClaims(who)) };
  const res = await handleApi(new Request(`https://app.example${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, deps());
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}
async function device(env: Env, method: string, path: string, token: string | null, body?: unknown, origin?: string) {
  const headers: Record<string, string> = { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(origin ? { origin } : {}) };
  const res = await handleApi(new Request(`https://app.example/api/device${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, deps());
  return { status: res.status, res, body: (await res.json().catch(() => ({}))) as Record<string, any> };
}
const pair = async (env: Env, who = 'me@example.com') => (await access(env, 'POST', '/api/pair', who)).body.code as string;
const link = async (env: Env, who = 'me@example.com', name = 'Desktop') => {
  const r = await device(env, 'POST', '/redeem', null, { code: formatCode(await pair(env, who)), name });
  return r.body.token as string;
};
const team = () => ({ ...createTeam('gen9ou' as never), id: 'team-1', name: 'Rain', updatedAt: NOW });

describe('pairing codes', () => {
  it('turns a code into a token for the account that made it, once', async () => {
    clock = NOW;
    const env = makeEnv();
    const code = await pair(env);
    expect(code).toMatch(/^[A-Z2-9]{10}$/);
    const r = await device(env, 'POST', '/redeem', null, { code: formatCode(code).toLowerCase(), name: 'Desktop' });
    expect(r.status).toBe(200);
    expect(r.body.owner).toBe('me@example.com');
    expect(r.body.token).toMatch(/^ptbd_/);
    const again = await device(env, 'POST', '/redeem', null, { code, name: 'Desktop' });
    expect(again.status).toBe(400);
  });

  it('refuses an expired, unknown or malformed code', async () => {
    clock = NOW;
    const env = makeEnv();
    const code = await pair(env);
    expect((await device(env, 'POST', '/redeem', null, { code: 'AAAAAAAAAA', name: 'x' })).status).toBe(400);
    expect((await device(env, 'POST', '/redeem', null, { code: 'short', name: 'x' })).status).toBe(400);
    expect((await device(env, 'POST', '/redeem', null, { code, name: '' })).status).toBe(400);
    clock = NOW + CODE_TTL_MS + 1;
    expect((await device(env, 'POST', '/redeem', null, { code, name: 'x' })).status).toBe(400);
    clock = NOW;
  });

  it('stores only hashes', async () => {
    clock = NOW;
    const env = makeEnv();
    const code = await pair(env);
    const token = await link(env);
    const dump = JSON.stringify([env.DB.raw.prepare('SELECT * FROM pair_codes').all(), env.DB.raw.prepare('SELECT * FROM devices').all()]);
    expect(dump).not.toContain(code);
    expect(dump).not.toContain(token);
  });

  it('keeps at most a few live codes per account, and the pairing endpoint needs Access', async () => {
    clock = NOW;
    const env = makeEnv();
    for (let i = 0; i < MAX_LIVE_CODES + 3; i++) await pair(env);
    expect(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM pair_codes').get()).toEqual({ n: MAX_LIVE_CODES });
    const res = await handleApi(new Request('https://app.example/api/pair', { method: 'POST' }), env, deps());
    expect(res.status).toBe(401);
  });

  it('limits the devices per account', async () => {
    clock = NOW;
    const env = makeEnv();
    for (let i = 0; i < MAX_DEVICES; i++) await link(env, 'me@example.com', `D${i}`);
    const r = await device(env, 'POST', '/redeem', null, { code: await pair(env), name: 'one too many' });
    expect(r.status).toBe(409);
  });
});

describe('a linked device', () => {
  it('syncs as the account that linked it, and sees what the account\'s other devices wrote', async () => {
    clock = NOW;
    const env = makeEnv();
    const token = await link(env);
    const push = await device(env, 'POST', '/sync', token, { docs: [{ id: 'team-1', kind: 'team', updatedAt: NOW, json: team() }] });
    expect(push.status).toBe(200);
    expect(push.body.results[0].status).toBe('applied');
    const viaAccess = await access(env, 'GET', '/api/sync?since=0', 'me@example.com');
    expect(viaAccess.body.docs.map((d: { id: string }) => d.id)).toEqual(['team-1']);
    const stranger = await access(env, 'GET', '/api/sync?since=0', 'other@example.com');
    expect(stranger.body.docs).toEqual([]);
    const pulled = await device(env, 'GET', '/sync?since=0', token);
    expect(pulled.body.docs).toHaveLength(1);
  });

  it('is one account only', async () => {
    clock = NOW;
    const env = makeEnv();
    const mine = await link(env, 'me@example.com');
    const theirs = await link(env, 'other@example.com');
    await device(env, 'POST', '/sync', mine, { docs: [{ id: 'team-1', kind: 'team', updatedAt: NOW, json: team() }] });
    expect((await device(env, 'GET', '/sync?since=0', theirs)).body.docs).toEqual([]);
  });

  it('is refused without a valid token, and cannot pair or list devices', async () => {
    clock = NOW;
    const env = makeEnv();
    const token = await link(env);
    expect((await device(env, 'GET', '/sync?since=0', null)).status).toBe(401);
    expect((await device(env, 'GET', '/sync?since=0', 'ptbd_' + 'A'.repeat(43))).status).toBe(401);
    expect((await device(env, 'GET', '/sync?since=0', 'garbage')).status).toBe(401);
    expect((await device(env, 'POST', '/pair', token)).status).toBe(404);
    expect((await device(env, 'GET', '/devices', token)).status).toBe(404);
    expect((await device(env, 'PUT', '/sync', token)).status).toBe(405);
  });

  it('stops working once revoked from the account, or unlinked from the device', async () => {
    clock = NOW;
    const env = makeEnv();
    const a = await link(env, 'me@example.com', 'Desktop A');
    const b = await link(env, 'me@example.com', 'Desktop B');
    const list = await access(env, 'GET', '/api/devices', 'me@example.com');
    expect(list.body.devices.map((d: { name: string }) => d.name)).toEqual(['Desktop A', 'Desktop B']);
    const idA = list.body.devices[0].id as string;
    // Someone else can't revoke it.
    await access(env, 'DELETE', '/api/devices', 'other@example.com', { id: idA });
    expect((await device(env, 'GET', '/sync?since=0', a)).status).toBe(200);
    const after = await access(env, 'DELETE', '/api/devices', 'me@example.com', { id: idA });
    expect(after.body.devices).toHaveLength(1);
    expect((await device(env, 'GET', '/sync?since=0', a)).status).toBe(401);
    expect((await device(env, 'DELETE', '/self', b)).status).toBe(200);
    expect((await device(env, 'GET', '/sync?since=0', b)).status).toBe(401);
  });

  it('answers the desktop webview\'s origin only', async () => {
    clock = NOW;
    const env = makeEnv();
    const token = await link(env);
    const ok = await device(env, 'GET', '/sync?since=0', token, undefined, 'tauri://localhost');
    expect(ok.res.headers.get('access-control-allow-origin')).toBe('tauri://localhost');
    const other = await device(env, 'GET', '/sync?since=0', token, undefined, 'https://evil.example');
    expect(other.res.headers.get('access-control-allow-origin')).toBeNull();
    const pre = await handleApi(new Request('https://app.example/api/device/sync', { method: 'OPTIONS', headers: { origin: 'tauri://localhost' } }), env, deps());
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-headers')).toContain('authorization');
  });
});
