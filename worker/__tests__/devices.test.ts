import { beforeAll, describe, expect, it } from 'vitest';
import { createTeam } from '../../src/domain/team';
import { CODE_TTL_MS, MAX_DEVICES, MAX_LIVE_CODES, MAX_REDEEMS_PER_WINDOW, REDEEM_WINDOW_MS, formatCode } from '../../src/domain/pairing';
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
let nextClient = 0;
async function device(env: Env, method: string, path: string, token: string | null, body?: unknown, origin?: string) {
  // Each call comes from its own client address, so the redeem throttle only bites in the tests about it.
  const headers: Record<string, string> = { 'cf-connecting-ip': `10.1.${nextClient >> 8}.${nextClient++ & 255}`, ...(token ? { authorization: `Bearer ${token}` } : {}), ...(origin ? { origin } : {}) };
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

/** A request with the path exactly as written (no helper prefix) and any headers. */
async function raw(env: Env, method: string, path: string, headers: Record<string, string> = {}, body?: unknown) {
  const res = await handleApi(new Request(`https://app.example${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, deps());
  return { status: res.status, res, body: (await res.json().catch(() => ({}))) as Record<string, any> };
}

describe('what /api/device/* can reach (the Access Bypass path)', () => {
  it('only the listed sub-routes, whatever the path looks like', async () => {
    clock = NOW;
    const env = makeEnv();
    const token = await link(env);
    const auth = { authorization: `Bearer ${token}` };
    // The intended routes work, a query string is just a query string.
    expect((await raw(env, 'GET', '/api/device/sync?since=0', auth)).status).toBe(200);
    expect((await raw(env, 'GET', '/api/device/sync?since=0&x=/pair', auth)).status).toBe(200);
    // Everything else under the prefix is a 404, even with a valid token.
    for (const path of [
      '/api/device/',
      '/api/device/pair',
      '/api/device/devices',
      '/api/device/sync/',
      '/api/device//sync',
      '/api/device/sync%2F..%2Fpair',
      '/api/device/..%2Fpair',
      '/api/device/%73ync',
      '/api/device/redeem/extra',
      '/api/device/self/x',
    ]) {
      expect((await raw(env, 'GET', path, auth)).status, path).toBe(404);
    }
    // A dot-dot path is normalised by the URL parser to a path outside the prefix: it gets no device
    // treatment at all, so without an Access login it is a 401 even with a valid device token.
    expect((await raw(env, 'POST', '/api/device/../pair', auth)).status).toBe(401);
    expect((await raw(env, 'GET', '/api/device/../devices', auth)).status).toBe(401);
    expect((await raw(env, 'GET', '/api/device/../sync?since=0', auth)).status).toBe(401);
  });

  it('every route but redeem needs a device token: an Access login or an e-mail header means nothing here', async () => {
    clock = NOW;
    const env = makeEnv();
    const jwt = await signJwt(key, goodClaims('me@example.com'));
    const sneaky = { 'Cf-Access-Jwt-Assertion': jwt, 'Cf-Access-Authenticated-User-Email': 'me@example.com', 'X-Forwarded-User': 'me@example.com' };
    for (const [method, path] of [
      ['GET', '/api/device/sync?since=0'],
      ['POST', '/api/device/sync'],
      ['GET', '/api/device/shared'],
      ['GET', '/api/device/shares'],
      ['PUT', '/api/device/profile'],
      ['DELETE', '/api/device/self'],
    ]) {
      expect((await raw(env, method, path, sneaky)).status, `${method} ${path}`).toBe(401);
    }
    // Pairing and the device list are not device routes at all, even for a signed-in account.
    expect((await raw(env, 'POST', '/api/device/pair', sneaky)).status).toBe(404);
    expect((await raw(env, 'GET', '/api/device/devices', sneaky)).status).toBe(404);
  });

  it('never hands a token out again: the device list has none', async () => {
    clock = NOW;
    const env = makeEnv();
    const token = await link(env);
    const list = await access(env, 'GET', '/api/devices', 'me@example.com');
    expect(JSON.stringify(list.body)).not.toContain(token);
    expect(Object.keys(list.body.devices[0]).sort()).toEqual(['createdAt', 'id', 'lastSeenAt', 'name']);
  });
});

describe('redeem throttle, limits and input', () => {
  const redeem = (env: Env, ip: string | null, code = 'AAAAAAAAAA') =>
    raw(env, 'POST', '/api/device/redeem', ip ? { 'cf-connecting-ip': ip } : {}, { code, name: 'x' });

  it('answers 429 after too many attempts from one address, per address and per window', async () => {
    clock = NOW;
    const env = makeEnv();
    for (let i = 0; i < MAX_REDEEMS_PER_WINDOW; i++) expect((await redeem(env, '203.0.113.7')).status).toBe(400);
    const blocked = await redeem(env, '203.0.113.7');
    expect(blocked.status).toBe(429);
    expect(blocked.res.headers.get('retry-after')).toBe('600');
    // Even the right code is refused while blocked, and another address is unaffected.
    const code = await pair(env);
    expect((await redeem(env, '203.0.113.7', code)).status).toBe(429);
    expect((await redeem(env, '203.0.113.8', code)).status).toBe(200);
    // A new window starts afresh and the old rows are deleted.
    clock = NOW + REDEEM_WINDOW_MS;
    expect((await redeem(env, '203.0.113.7')).status).toBe(400);
    expect(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM redeem_attempts WHERE bucket < ?').get(Math.floor(clock / REDEEM_WINDOW_MS))).toEqual({ n: 0 });
    clock = NOW;
  });

  it('stores only a hash of the address', async () => {
    clock = NOW;
    const env = makeEnv();
    await redeem(env, '198.51.100.23');
    expect(JSON.stringify(env.DB.raw.prepare('SELECT * FROM redeem_attempts').all())).not.toContain('198.51.100.23');
  });

  it('cannot exceed the device limit even when codes are redeemed at the same moment', async () => {
    clock = NOW;
    const env = makeEnv();
    for (let i = 0; i < MAX_DEVICES - 1; i++) await link(env, 'me@example.com', `D${i}`);
    const codes = await Promise.all([pair(env), pair(env), pair(env)]);
    const results = await Promise.all(codes.map((c, i) => raw(env, 'POST', '/api/device/redeem', { 'cf-connecting-ip': `192.0.2.${i}` }, { code: c, name: `late ${i}` })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM devices').get()).toEqual({ n: MAX_DEVICES });
  });

  it('strips control and invisible characters from the device name, and refuses an empty one', async () => {
    clock = NOW;
    const env = makeEnv();
    const ok = await raw(env, 'POST', '/api/device/redeem', {}, { code: await pair(env), name: '  My\u202E PC\u200B\u0007  ' });
    expect(ok.status).toBe(200);
    expect((await access(env, 'GET', '/api/devices', 'me@example.com')).body.devices[0].name).toBe('My PC');
    expect((await raw(env, 'POST', '/api/device/redeem', {}, { code: await pair(env), name: '\u200B\u202E' })).status).toBe(400);
    expect((await raw(env, 'POST', '/api/device/redeem', {}, { code: await pair(env), name: 'x'.repeat(41) })).status).toBe(400);
    expect((await raw(env, 'POST', '/api/device/redeem', {}, { code: await pair(env), name: 'x'.repeat(5000) })).status).toBe(413);
  });
});

describe('CORS for the device routes', () => {
  it('does not answer the Tauri dev server in production, only when DEVICE_EXTRA_ORIGINS lists it', async () => {
    clock = NOW;
    const env = makeEnv();
    const token = await link(env);
    const dev = 'http://localhost:1420';
    expect((await device(env, 'GET', '/sync?since=0', token, undefined, dev)).res.headers.get('access-control-allow-origin')).toBeNull();
    const local = { ...env, DEVICE_EXTRA_ORIGINS: ' http://localhost:1420 , http://127.0.0.1:1420' };
    expect((await device(local, 'GET', '/sync?since=0', token, undefined, dev)).res.headers.get('access-control-allow-origin')).toBe(dev);
    expect((await device(local, 'GET', '/sync?since=0', token, undefined, 'https://evil.example')).res.headers.get('access-control-allow-origin')).toBeNull();
  });
});
