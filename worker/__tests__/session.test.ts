import { readFileSync, readdirSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { EXPECTED_MIGRATIONS, healthLine, type HealthResponse } from '../../src/domain/syncHealth';
import { handleApi } from '../api';
import { NOW, goodClaims, makeEnv, makeKey, signJwt, type TestKey } from './helpers';

let key: TestKey;
beforeAll(async () => {
  key = await makeKey();
});

const deps = () => ({ keys: async () => [key.jwk], now: () => NOW });
const get = async (env: ReturnType<typeof makeEnv>, path: string, token?: string | null, method = 'GET') =>
  handleApi(new Request(`https://app.example${path}`, { method, headers: token === null ? {} : { 'Cf-Access-Jwt-Assertion': token ?? (await signJwt(key, goodClaims('me@example.com'))) } }), env, deps());

describe('GET /api/session/renew', () => {
  it('sends a signed-in browser back to the app', async () => {
    const res = await get(makeEnv(), '/api/session/renew');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('needs a valid Access JWT: none, forged, expired, wrong audience or issuer all get 401, never a redirect', async () => {
    const env = makeEnv();
    for (const token of [null, 'a.b.c', await signJwt(key, goodClaims('me@example.com', { exp: Math.floor(NOW / 1000) - 3600 })), await signJwt(key, goodClaims('me@example.com', { aud: ['x'] })), await signJwt(key, goodClaims('me@example.com', { iss: 'https://evil.example' }))]) {
      const res = await get(env, '/api/session/renew', token);
      expect(res.status).toBe(401);
      expect(res.headers.get('location')).toBeNull();
    }
    // Only the Access login-bearing header counts, not an e-mail header.
    const header = await handleApi(new Request('https://app.example/api/session/renew', { headers: { 'Cf-Access-Authenticated-User-Email': 'me@example.com' } }), env, deps());
    expect(header.status).toBe(401);
  });

  it('with accounts on and no Access login, sends the browser to the account login instead of a bare error', async () => {
    const res = await get({ ...makeEnv(), AUTH_MODE: 'both' }, '/api/session/renew', null);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/#account');
    // A forged token is still refused.
    expect((await get({ ...makeEnv(), AUTH_MODE: 'both' }, '/api/session/renew', 'a.b.c')).status).toBe(401);
  });

  it('is GET only, and works without a database (it only needs the Access settings)', async () => {
    const env = makeEnv();
    expect((await get(env, '/api/session/renew', undefined, 'POST')).status).toBe(405);
    expect((await get({ ...env, DB: undefined }, '/api/session/renew')).status).toBe(302);
    expect((await get({ ...env, ACCESS_AUD: undefined }, '/api/session/renew')).status).toBe(501);
  });

  it('is a route the service worker leaves to the network and Cloudflare serves from the Worker first', () => {
    const vite = readFileSync(new URL('../../vite.config.ts', import.meta.url), 'utf8');
    expect(vite).toContain('navigateFallbackDenylist: [/^\\/api\\//]');
    const wrangler = readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8');
    expect(wrangler).toMatch(/"run_worker_first":\s*\["\/api\/\*"\]/);
    expect(/^\/api\//.test('/api/session/renew')).toBe(true);
  });
});

describe('GET /api/health', () => {
  const health = async (env: ReturnType<typeof makeEnv>, token?: string | null) => {
    const res = await get(env, '/api/health', token);
    return { status: res.status, body: (await res.json()) as HealthResponse };
  };

  it('keeps the expected migration list in step with the migrations folder', () => {
    const files = readdirSync(new URL('../../migrations/', import.meta.url)).filter((f) => f.endsWith('.sql')).map((f) => f.replace(/\.sql$/, '')).sort();
    expect([...EXPECTED_MIGRATIONS]).toEqual(files);
  });

  it('reports a ready deployment, without any user data', async () => {
    const env = makeEnv();
    env.DB.raw.exec('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT)');
    for (const m of EXPECTED_MIGRATIONS) env.DB.raw.exec(`INSERT INTO d1_migrations (name) VALUES ('${m}.sql')`);
    const { status, body } = await health(env);
    expect(status).toBe(200);
    expect(body).toEqual({ database: true, migrations: [...EXPECTED_MIGRATIONS], missing: [], access: { teamDomain: true, audience: true }, accounts: { mode: 'access', pepper: false, setupCode: false }, time: NOW });
    expect(healthLine(body)).toEqual({ ok: true, text: 'Server ready' });
    expect(JSON.stringify(body)).not.toContain('@');
  });

  it('names a migration that was not applied', async () => {
    const env = makeEnv();
    env.DB.raw.exec('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT)');
    for (const m of EXPECTED_MIGRATIONS.slice(0, 3)) env.DB.raw.exec(`INSERT INTO d1_migrations (name) VALUES ('${m}.sql')`);
    const { body } = await health(env);
    expect(body.missing).toEqual(['0004_redeem_attempts', '0005_accounts', '0006_claims', '0007_friends']);
    expect(healthLine(body)).toEqual({ ok: false, text: 'Database migration missing: 0004, 0005, 0006, 0007' });
  });

  it('reads the tables when the migrations were pasted into the console (no d1_migrations table)', async () => {
    const env = makeEnv();
    env.DB.raw.exec('DROP TABLE redeem_attempts');
    const { body } = await health(env);
    expect(body.migrations).toEqual(['0001_init', '0002_shares', '0003_devices', '0005_accounts', '0006_claims', '0007_friends']);
    expect(body.missing).toEqual(['0004_redeem_attempts']);
  });

  it('says what is not set up instead of refusing', async () => {
    const env = makeEnv();
    const noDb = (await health({ ...env, DB: undefined })).body;
    expect(noDb).toMatchObject({ database: false, migrations: null });
    expect(healthLine(noDb).text).toContain('Database not bound');
    const noAccess = (await health({ ...env, ACCESS_AUD: undefined }, null)).body; // nothing to verify a token against
    expect(noAccess.access).toEqual({ teamDomain: true, audience: false });
    expect(healthLine(noAccess).text).toContain('ACCESS_AUD');
  });

  it('needs the Access login once Access is configured, until accounts are on (then it is public, as Access may be on Bypass)', async () => {
    expect((await health(makeEnv(), null)).status).toBe(401);
    expect((await health(makeEnv(), 'a.b.c')).status).toBe(401);
    const open = await health({ ...makeEnv(), AUTH_MODE: 'both' }, null);
    expect(open.status).toBe(200);
    expect(Object.keys(open.body).sort()).toEqual(['access', 'accounts', 'database', 'migrations', 'missing', 'time']);
  });
});
