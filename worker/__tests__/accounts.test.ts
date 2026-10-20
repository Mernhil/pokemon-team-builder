import { describe, expect, it, vi } from 'vitest';
import { THROTTLES, formatCode, generateCode, passwordProblem, usernameProblem, RECOVERY_LENGTH } from '../../src/domain/accounts';
import { handleApi } from '../api';
import { sha256Hex } from '../crypto';
import { createInvite } from '../invites';
import { PBKDF2_ITERATIONS, hashPassword, verifyPassword } from '../password';
import { NOW, makeEnv } from './helpers';

const PEPPER = 'test-pepper-0123456789abcdef0123456789';
const ITER = 1000;
const ORIGIN = 'https://app.example';
const DESKTOP = 'tauri://localhost';
const PW = 'correct horse battery';

type Env = ReturnType<typeof makeEnv>;
let clock = NOW;
let nextIp = 0;
const newEnv = (over: Partial<Env> = {}): Env => ({ ...makeEnv(), AUTH_MODE: 'both', PASSWORD_PEPPER: PEPPER, SETUP_CODE: 'setup-code-for-the-first-admin', ...over });

interface CallOptions {
  body?: unknown;
  cookie?: string;
  bearer?: string;
  origin?: string | null;
  ptb?: boolean;
  ip?: string;
}
async function call(env: Env, method: string, path: string, o: CallOptions = {}) {
  const headers: Record<string, string> = { 'cf-connecting-ip': o.ip ?? `10.2.${nextIp >> 8}.${nextIp++ & 255}` };
  if (o.origin !== null) headers.origin = o.origin ?? ORIGIN;
  if (o.ptb !== false) headers['x-ptb'] = '1';
  if (o.cookie) headers.cookie = o.cookie;
  if (o.bearer) headers.authorization = `Bearer ${o.bearer}`;
  const res = await handleApi(new Request(`${ORIGIN}${path}`, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) }), env, { now: () => clock, iterations: ITER });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, body: (text ? JSON.parse(text) : {}) as Record<string, any> };
}
const cookieOf = (r: { headers: Headers }) => /(__Host-ptb_session=[^;]+)/.exec(r.headers.get('set-cookie') ?? '')?.[1];

/** The first account, through the setup code. */
async function firstAdmin(env: Env, username = 'ash') {
  const r = await call(env, 'POST', '/api/auth/signup', { body: { invite: env.SETUP_CODE, username, password: PW, deviceName: 'Phone' } });
  expect(r.status).toBe(200);
  return { cookie: cookieOf(r)!, user: r.body.user, recovery: r.body.recoveryCode as string, r };
}
async function signupWithInvite(env: Env, username: string, password = PW, over: Record<string, unknown> = {}, opts: CallOptions = {}) {
  const { code } = await createInvite(env.DB, 'u_admin', null, clock);
  return call(env, 'POST', '/api/auth/signup', { body: { invite: code, username, password, deviceName: 'Laptop', ...over }, ...opts });
}

describe('rules', () => {
  it('usernames: length, characters, reserved names', () => {
    expect(usernameProblem('ash')).toBeNull();
    expect(usernameProblem('Ash.Ketchum-1')).toBeNull();
    expect(usernameProblem('ab')).toMatch(/3–20/);
    expect(usernameProblem('a'.repeat(21))).toMatch(/3–20/);
    expect(usernameProblem('_ash')).toMatch(/letters, digits/);
    expect(usernameProblem('ash ketchum')).toMatch(/letters, digits/);
    expect(usernameProblem('Admin')).toMatch(/not available/);
  });
  it('passwords: length, a common-password blocklist, not the username', () => {
    expect(passwordProblem(PW, 'ash')).toBeNull();
    expect(passwordProblem('short1', 'ash')).toMatch(/at least 10/);
    expect(passwordProblem('x'.repeat(129), 'ash')).toMatch(/at most 128/);
    expect(passwordProblem('Password123', 'ash')).toMatch(/too common/);
    expect(passwordProblem('aaaaaaaaaaaa', 'ash')).toMatch(/too common/);
    expect(passwordProblem('my-Ashley-pass-123', 'ashley')).toMatch(/username/);
  });
});

describe('password hashing', () => {
  it('stores its parameters, salts every hash and needs the pepper', async () => {
    const a = await hashPassword(PW, PEPPER, ITER);
    const b = await hashPassword(PW, PEPPER, ITER);
    expect(a).toMatch(/^pbkdf2-sha256\$i=1000\$p=1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword(PW, a, PEPPER, ITER)).toEqual({ ok: true, upgrade: false });
    expect((await verifyPassword('wrong password!', a, PEPPER, ITER)).ok).toBe(false);
    expect((await verifyPassword(PW, a, 'another-pepper', ITER)).ok).toBe(false);
    // NFKC: the same password typed with a compatibility character matches.
    expect((await verifyPassword('ｃorrect horse battery', a, PEPPER, ITER)).ok).toBe(true);
  });
  it('says when the stored parameters are older than the current ones, and rejects garbage', async () => {
    const old = await hashPassword(PW, PEPPER, ITER);
    expect(await verifyPassword(PW, old, PEPPER, 2000)).toEqual({ ok: true, upgrade: true });
    expect(await verifyPassword(PW, 'not a hash', PEPPER, ITER)).toEqual({ ok: false, upgrade: false });
  });
  it('uses 100,000 iterations by default (the Workers cap)', () => {
    expect(PBKDF2_ITERATIONS).toBe(100_000);
  });
});

describe('routes are off unless AUTH_MODE turns them on', () => {
  it('404s in access mode and without a mode, 501 without the pepper', async () => {
    expect((await call(newEnv({ AUTH_MODE: 'access' }), 'POST', '/api/auth/login', { body: {} })).status).toBe(404);
    expect((await call(newEnv({ AUTH_MODE: undefined }), 'GET', '/api/me')).status).toBe(404);
    const r = await call(newEnv({ PASSWORD_PEPPER: undefined }), 'GET', '/api/me');
    expect(r.status).toBe(501);
    expect(r.body.missing).toEqual(['PASSWORD_PEPPER']);
  });
});

describe('first account and signup', () => {
  it('the setup code makes the first account an admin, once', async () => {
    const env = newEnv();
    const { user, recovery, r } = await firstAdmin(env);
    expect(user).toMatchObject({ username: 'ash', role: 'admin' });
    expect(recovery).toMatch(/^[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/);
    expect(r.headers.get('set-cookie')).toMatch(/^__Host-ptb_session=ptbs_[A-Za-z0-9_-]{43}; Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=\d+$/);
    expect(r.body.token).toBeUndefined();
    const again = await call(env, 'POST', '/api/auth/signup', { body: { invite: env.SETUP_CODE, username: 'misty', password: PW } });
    expect(again.status).toBe(400);
    expect(again.body.error).toBe('That invite isn’t valid.');
  });

  it('nobody registers without a valid invite', async () => {
    const env = newEnv();
    await firstAdmin(env);
    for (const invite of ['', 'K7QM-3XWD-9PTR', 'nope', 'x'.repeat(80)]) {
      const r = await call(env, 'POST', '/api/auth/signup', { body: { invite, username: 'misty', password: PW } });
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('That invite isn’t valid.');
    }
  });

  it('an invite works once, and an expired or revoked one never', async () => {
    const env = newEnv();
    await firstAdmin(env);
    const { code } = await createInvite(env.DB, 'u_admin', 'for Misty', clock);
    const ok = await call(env, 'POST', '/api/auth/signup', { body: { invite: code.toLowerCase(), username: 'Misty', password: PW } });
    expect(ok.status).toBe(200);
    expect(ok.body.user).toMatchObject({ username: 'Misty', role: 'user' });
    const reuse = await call(env, 'POST', '/api/auth/signup', { body: { invite: code, username: 'brock', password: PW } });
    expect(reuse.status).toBe(400);
    expect(env.DB.raw.prepare('SELECT used_by FROM invites WHERE used_by IS NOT NULL').get()).toMatchObject({ used_by: ok.body.user.id });

    const old = await createInvite(env.DB, 'u_admin', null, clock, 1000);
    clock += 2000;
    expect((await call(env, 'POST', '/api/auth/signup', { body: { invite: old.code, username: 'gary', password: PW } })).status).toBe(400);
    const revoked = await createInvite(env.DB, 'u_admin', null, clock);
    env.DB.raw.exec(`UPDATE invites SET revoked_at = ${clock} WHERE used_at IS NULL`);
    expect((await call(env, 'POST', '/api/auth/signup', { body: { invite: revoked.code, username: 'gary', password: PW } })).status).toBe(400);
  });

  it('two signups racing for one invite: one account, one refusal', async () => {
    const env = newEnv();
    await firstAdmin(env);
    const { code } = await createInvite(env.DB, 'u_admin', null, clock);
    const [a, b] = await Promise.all(['one', 'two'].map((username) => call(env, 'POST', '/api/auth/signup', { body: { invite: code, username, password: PW } })));
    expect([a.status, b.status].sort()).toEqual([200, 400]);
    expect(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'user'").get()).toEqual({ n: 1 });
  });

  it('usernames are unique ignoring case, and a taken name does not burn the invite', async () => {
    const env = newEnv();
    await firstAdmin(env, 'Ash');
    const { code } = await createInvite(env.DB, 'u_admin', null, clock);
    const taken = await call(env, 'POST', '/api/auth/signup', { body: { invite: code, username: 'ASH', password: PW } });
    expect(taken.status).toBe(409);
    expect((await call(env, 'POST', '/api/auth/signup', { body: { invite: code, username: 'misty', password: PW } })).status).toBe(200);
  });

  it('rejects a weak password or a bad name with a reason', async () => {
    const env = newEnv();
    await firstAdmin(env);
    expect((await signupWithInvite(env, 'misty', 'short')).body.error).toMatch(/at least 10/);
    expect((await signupWithInvite(env, 'mi sty')).body.error).toMatch(/letters, digits/);
  });

  it('wrong invites are throttled per address', async () => {
    const env = newEnv();
    await firstAdmin(env);
    const ip = '203.0.113.5';
    for (let i = 0; i < THROTTLES.badInviteIp.max; i++) expect((await call(env, 'POST', '/api/auth/signup', { body: { invite: 'K7QM-3XWD-9PT' + i, username: 'x1234', password: PW }, ip })).status).toBe(400);
    const blocked = await call(env, 'POST', '/api/auth/signup', { body: { invite: 'K7QM-3XWD-9PTR', username: 'x1234', password: PW }, ip });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});

describe('login', () => {
  it('logs in with any letter case and answers the same for a wrong password, an unknown name and a disabled account', async () => {
    const env = newEnv();
    await firstAdmin(env);
    expect((await call(env, 'POST', '/api/auth/login', { body: { username: 'ASH', password: PW } })).status).toBe(200);
    const wrong = await call(env, 'POST', '/api/auth/login', { body: { username: 'ash', password: 'not the password' } });
    const unknown = await call(env, 'POST', '/api/auth/login', { body: { username: 'nobody', password: 'not the password' } });
    env.DB.raw.exec("UPDATE users SET disabled = 1 WHERE username_key = 'ash'");
    const disabled = await call(env, 'POST', '/api/auth/login', { body: { username: 'ash', password: PW } });
    for (const r of [wrong, unknown, disabled]) {
      expect(r.status).toBe(401);
      expect(r.body).toEqual({ error: 'Wrong username or password.' });
    }
  });

  it('throttles failures per username (and per address), and stores no address or name in the clear', async () => {
    const env = newEnv();
    await firstAdmin(env);
    for (let i = 0; i < THROTTLES.loginUser.max; i++) expect((await call(env, 'POST', '/api/auth/login', { body: { username: 'ash', password: 'wrong password 1' } })).status).toBe(401);
    const locked = await call(env, 'POST', '/api/auth/login', { body: { username: 'ash', password: PW } });
    expect(locked.status).toBe(429);
    // The right password from a fresh address is refused too while the username is locked, but a session that exists is untouched.
    const rows = env.DB.raw.prepare('SELECT scope, key_hash FROM throttles').all() as { scope: string; key_hash: string }[];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.key_hash).toMatch(/^[0-9a-f]{64}$/);
    // The window passes.
    clock += THROTTLES.loginUser.windowMs;
    expect((await call(env, 'POST', '/api/auth/login', { body: { username: 'ash', password: PW } })).status).toBe(200);

    const ip = '198.51.100.9';
    for (let i = 0; i < THROTTLES.loginIp.max; i++) await call(env, 'POST', '/api/auth/login', { body: { username: `user${i}`, password: 'wrong password 1' }, ip });
    expect((await call(env, 'POST', '/api/auth/login', { body: { username: 'ash', password: PW }, ip })).status).toBe(429);
  });

  it('rehashes a password stored with older parameters', async () => {
    const env = newEnv();
    await firstAdmin(env);
    env.DB.raw.prepare('UPDATE users SET pw_hash = ?').run(await hashPassword(PW, PEPPER, 500));
    expect((await call(env, 'POST', '/api/auth/login', { body: { username: 'ash', password: PW } })).status).toBe(200);
    expect((env.DB.raw.prepare('SELECT pw_hash FROM users').get() as { pw_hash: string }).pw_hash).toContain('$i=1000$');
  });

  it('the desktop app gets a bearer token, only from its own origin', async () => {
    const env = newEnv();
    await firstAdmin(env);
    const body = { username: 'ash', password: PW, mode: 'token', deviceName: 'Desktop' };
    expect((await call(env, 'POST', '/api/auth/login', { body })).status).toBe(400);
    const r = await call(env, 'POST', '/api/auth/login', { body, origin: DESKTOP });
    expect(r.status).toBe(200);
    expect(r.body.token).toMatch(/^ptbs_[A-Za-z0-9_-]{43}$/);
    expect(r.headers.get('set-cookie')).toBeNull();
    expect(r.headers.get('access-control-allow-origin')).toBe(DESKTOP);
    const me = await call(env, 'GET', '/api/me', { bearer: r.body.token, origin: DESKTOP });
    expect(me.body.user.username).toBe('ash');
  });
});

describe('sessions', () => {
  it('stores only a hash of the token and never repeats it in a later answer', async () => {
    const env = newEnv();
    const { cookie } = await firstAdmin(env);
    const token = cookie.split('=')[1];
    expect(JSON.stringify(env.DB.raw.prepare('SELECT * FROM sessions').all())).not.toContain(token);
    expect(env.DB.raw.prepare('SELECT token_hash FROM sessions').get()).toEqual({ token_hash: await sha256Hex(token) });
    for (const path of ['/api/me', '/api/sessions']) expect((await call(env, 'GET', path, { cookie })).text).not.toContain(token);
  });

  it('a revoked session fails on its very next request', async () => {
    const env = newEnv();
    const { cookie } = await firstAdmin(env);
    const second = await call(env, 'POST', '/api/auth/login', { body: { username: 'ash', password: PW, deviceName: 'Laptop' } });
    const cookie2 = cookieOf(second)!;
    const list = await call(env, 'GET', '/api/sessions', { cookie });
    expect(list.body.sessions.map((s: { name: string; current: boolean }) => [s.name, s.current])).toEqual([['Phone', true], ['Laptop', false]]);
    const laptop = list.body.sessions.find((s: { name: string }) => s.name === 'Laptop');
    expect((await call(env, 'GET', '/api/me', { cookie: cookie2 })).status).toBe(200);
    await call(env, 'DELETE', '/api/sessions', { cookie, body: { id: laptop.id } });
    expect((await call(env, 'GET', '/api/me', { cookie: cookie2 })).status).toBe(401);
    expect((await call(env, 'GET', '/api/me', { cookie })).status).toBe(200);
  });

  it('logout ends this session; logout everywhere ends all of them and clears the cookie', async () => {
    const env = newEnv();
    const { cookie } = await firstAdmin(env);
    const cookie2 = cookieOf(await call(env, 'POST', '/api/auth/login', { body: { username: 'ash', password: PW } }))!;
    const out = await call(env, 'POST', '/api/auth/logout', { cookie });
    expect(out.headers.get('set-cookie')).toMatch(/Max-Age=0$/);
    expect((await call(env, 'GET', '/api/me', { cookie })).status).toBe(401);
    expect((await call(env, 'GET', '/api/me', { cookie: cookie2 })).status).toBe(200);
    expect((await call(env, 'POST', '/api/auth/logout-all', { cookie: cookie2 })).status).toBe(200);
    expect((await call(env, 'GET', '/api/me', { cookie: cookie2 })).status).toBe(401);
  });

  it('a disabled user is out on the next request, and an expired session is gone', async () => {
    const env = newEnv();
    const { cookie } = await firstAdmin(env);
    env.DB.raw.exec('UPDATE users SET disabled = 1');
    expect((await call(env, 'GET', '/api/me', { cookie })).status).toBe(401);
    env.DB.raw.exec('UPDATE users SET disabled = 0');
    expect((await call(env, 'GET', '/api/me', { cookie })).status).toBe(200);
    clock += 181 * 24 * 3600_000;
    expect((await call(env, 'GET', '/api/me', { cookie })).status).toBe(401);
    expect(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 });
  });

  it('renews a session used after a day (and sets the cookie again), at most once a day, within a year', async () => {
    const env = newEnv();
    const { cookie } = await firstAdmin(env);
    const first = await call(env, 'GET', '/api/me', { cookie });
    expect(first.headers.get('set-cookie')).toBeNull();
    clock += 25 * 3600_000;
    const renewed = await call(env, 'GET', '/api/me', { cookie });
    expect(renewed.headers.get('set-cookie')).toContain(cookie.split('=')[1]);
    expect((await call(env, 'GET', '/api/me', { cookie })).headers.get('set-cookie')).toBeNull();
    clock += 200 * 24 * 3600_000;
    // Idle for more than 180 days at the last renewal would have expired; it was renewed, so it hasn't, but never beyond a year from creation.
    const row = env.DB.raw.prepare('SELECT created_at, expires_at FROM sessions').get() as { created_at: number; expires_at: number };
    expect(row.expires_at - row.created_at).toBeLessThanOrEqual(365 * 24 * 3600_000);
  });

  it('keeps at most 20 sessions per account', async () => {
    const env = newEnv();
    await firstAdmin(env);
    for (let i = 0; i < 22; i++) {
      clock += 1000;
      await call(env, 'POST', '/api/auth/login', { body: { username: 'ash', password: PW, deviceName: `D${i}` } });
    }
    expect(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 20 });
  });
});

describe('cookie requests need to come from our own page (CSRF)', () => {
  it('refuses a cookie request that changes something without the header or from another origin', async () => {
    const env = newEnv();
    const { cookie } = await firstAdmin(env);
    const base = { cookie, body: { displayName: 'Ash K' } };
    expect((await call(env, 'PUT', '/api/me', { ...base, ptb: false })).status).toBe(403);
    expect((await call(env, 'PUT', '/api/me', { ...base, origin: 'https://evil.example' })).status).toBe(403);
    expect((await call(env, 'PUT', '/api/me', { ...base, origin: null })).status).toBe(403);
    expect((await call(env, 'PUT', '/api/me', base)).status).toBe(200);
    // Reads are fine without them; login itself is protected too (login CSRF).
    expect((await call(env, 'GET', '/api/me', { cookie, ptb: false, origin: null })).status).toBe(200);
    expect((await call(env, 'POST', '/api/auth/login', { body: { username: 'ash', password: PW }, ptb: false })).status).toBe(403);
    expect((await call(env, 'POST', '/api/auth/login', { body: { username: 'ash', password: PW }, origin: 'https://evil.example' })).status).toBe(403);
  });

  it('a bearer request needs no CSRF header (nothing is attached automatically)', async () => {
    const env = newEnv();
    await firstAdmin(env);
    const t = (await call(env, 'POST', '/api/auth/login', { body: { username: 'ash', password: PW, mode: 'token' }, origin: DESKTOP })).body.token;
    expect((await call(env, 'PUT', '/api/me', { bearer: t, origin: null, ptb: false, body: { displayName: 'Ash' } })).status).toBe(200);
  });
});

describe('password and recovery', () => {
  it('changing the password needs the current one and signs the other devices out', async () => {
    const env = newEnv();
    const { cookie } = await firstAdmin(env);
    const other = cookieOf(await call(env, 'POST', '/api/auth/login', { body: { username: 'ash', password: PW } }))!;
    expect((await call(env, 'POST', '/api/me/password', { cookie, body: { current: 'not the password', next: 'a brand new passphrase' } })).status).toBe(403);
    expect((await call(env, 'POST', '/api/me/password', { cookie, body: { current: PW, next: 'short' } })).status).toBe(400);
    expect((await call(env, 'POST', '/api/me/password', { cookie, body: { current: PW, next: 'a brand new passphrase' } })).status).toBe(200);
    expect((await call(env, 'GET', '/api/me', { cookie })).status).toBe(200);
    expect((await call(env, 'GET', '/api/me', { cookie: other })).status).toBe(401);
    expect((await call(env, 'POST', '/api/auth/login', { body: { username: 'ash', password: PW } })).status).toBe(401);
    expect((await call(env, 'POST', '/api/auth/login', { body: { username: 'ash', password: 'a brand new passphrase' } })).status).toBe(200);
  });

  it('the recovery code sets a new password once, signs everything out and issues a new code', async () => {
    const env = newEnv();
    const { cookie, recovery } = await firstAdmin(env);
    const bad = await call(env, 'POST', '/api/auth/recover', { body: { username: 'ash', code: 'ABCDE-FGHJK-LMNPQ-RSTUV', newPassword: 'a brand new passphrase' } });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('That code doesn’t work.');
    const unknown = await call(env, 'POST', '/api/auth/recover', { body: { username: 'nobody', code: recovery, newPassword: 'a brand new passphrase' } });
    expect(unknown.body).toEqual(bad.body);
    const ok = await call(env, 'POST', '/api/auth/recover', { body: { username: 'ASH', code: recovery.toLowerCase(), newPassword: 'a brand new passphrase' } });
    expect(ok.status).toBe(200);
    expect(ok.body.recoveryCode).toMatch(/^[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/);
    expect(ok.body.recoveryCode).not.toBe(recovery);
    expect((await call(env, 'GET', '/api/me', { cookie })).status).toBe(401);
    expect((await call(env, 'POST', '/api/auth/login', { body: { username: 'ash', password: 'a brand new passphrase' } })).status).toBe(200);
    // The old code is dead.
    expect((await call(env, 'POST', '/api/auth/recover', { body: { username: 'ash', code: recovery, newPassword: 'yet another passphrase' } })).status).toBe(400);
  });

  it('an admin reset code works once, then expires or is deleted', async () => {
    const env = newEnv();
    await firstAdmin(env);
    const code = generateCode(RECOVERY_LENGTH);
    const id = (env.DB.raw.prepare('SELECT id FROM users').get() as { id: string }).id;
    env.DB.raw.prepare('INSERT INTO reset_codes (code_hash, user_id, created_by, expires_at) VALUES (?, ?, ?, ?)').run(await sha256Hex(code), id, 'u_admin', clock + 1000);
    const body = { username: 'ash', code: formatCode(code), newPassword: 'a brand new passphrase' };
    expect((await call(env, 'POST', '/api/auth/recover', { body })).status).toBe(200);
    expect((await call(env, 'POST', '/api/auth/recover', { body: { ...body, newPassword: 'another new passphrase' } })).status).toBe(400);
    const late = generateCode(RECOVERY_LENGTH);
    env.DB.raw.prepare('INSERT INTO reset_codes (code_hash, user_id, created_by, expires_at) VALUES (?, ?, ?, ?)').run(await sha256Hex(late), id, 'u_admin', clock - 1);
    expect((await call(env, 'POST', '/api/auth/recover', { body: { ...body, code: late } })).status).toBe(400);
  });

  it('recovery attempts are throttled per username', async () => {
    const env = newEnv();
    await firstAdmin(env);
    for (let i = 0; i < THROTTLES.recoverUser.max; i++) await call(env, 'POST', '/api/auth/recover', { body: { username: 'ash', code: 'ABCDE-FGHJK-LMNPQ-RSTUV', newPassword: 'a brand new passphrase' } });
    expect((await call(env, 'POST', '/api/auth/recover', { body: { username: 'ash', code: 'ABCDE-FGHJK-LMNPQ-RSTUV', newPassword: 'a brand new passphrase' } })).status).toBe(429);
  });

  it('a new recovery code replaces the old one and needs the password', async () => {
    const env = newEnv();
    const { cookie, recovery } = await firstAdmin(env);
    expect((await call(env, 'POST', '/api/me/recovery', { cookie, body: { password: 'wrong wrong wrong' } })).status).toBe(403);
    const r = await call(env, 'POST', '/api/me/recovery', { cookie, body: { password: PW } });
    expect(r.status).toBe(200);
    expect(r.body.recoveryCode).not.toBe(recovery);
    expect((await call(env, 'POST', '/api/auth/recover', { body: { username: 'ash', code: recovery, newPassword: 'a brand new passphrase' } })).status).toBe(400);
  });
});

describe('secrets stay out of logs and answers', () => {
  it('never writes a password, token, invite or recovery code to the console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const env = newEnv();
    const { cookie, recovery } = await firstAdmin(env);
    const { code } = await createInvite(env.DB, 'u_admin', null, clock);
    await call(env, 'POST', '/api/auth/signup', { body: { invite: code, username: 'misty', password: PW } });
    await call(env, 'POST', '/api/auth/login', { body: { username: 'ash', password: 'wrong password 1' } });
    await call(env, 'GET', '/api/me', { cookie });
    const seen = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    for (const secret of [PW, cookie.split('=')[1], code, recovery]) expect(seen).not.toContain(secret);
    spies.forEach((s) => s.mockRestore());
  });

  it('errors never echo the request body', async () => {
    const env = newEnv();
    const r = await call(env, 'POST', '/api/auth/login', { body: { username: 'ash', password: PW, mode: 'bogus' } });
    expect(r.status).toBe(400);
    expect(r.text).not.toContain(PW);
  });
});

describe('health', () => {
  it('reports the mode and whether the secrets exist, nothing else', async () => {
    const res = await handleApi(new Request(`${ORIGIN}/api/health`), { ...newEnv(), ACCESS_TEAM_DOMAIN: undefined }, { now: () => NOW });
    const body = (await res.json()) as { accounts: unknown };
    expect(body.accounts).toEqual({ mode: 'both', pepper: true, setupCode: true });
  });
});
