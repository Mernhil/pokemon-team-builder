import { describe, expect, it, vi } from 'vitest';
import { RESET_TTL_MS } from '../../src/domain/accounts';
import { PW, accountEnv, call, cookieOf, firstAdmin, inviteAndSignup, keyFor, login, newKeyBody, type AccountEnv } from './accountHelpers';

const events = async (env: AccountEnv) => (await env.DB.prepare('SELECT actor, kind, target FROM events ORDER BY id').all<{ actor: string; kind: string; target: string | null }>()).results;

describe('only admins', () => {
  it('every admin route refuses a normal user, and a signed-out request', async () => {
    const env = accountEnv();
    const admin = await firstAdmin(env);
    const misty = await inviteAndSignup(env, admin.cookie, 'misty');
    const routes: [string, string][] = [
      ['GET', '/api/admin/invites'],
      ['POST', '/api/admin/invites'],
      ['DELETE', '/api/admin/invites'],
      ['GET', '/api/admin/users'],
      ['POST', '/api/admin/users/disable'],
      ['POST', '/api/admin/users/enable'],
      ['POST', '/api/admin/users/role'],
      ['POST', '/api/admin/users/reset'],
    ];
    for (const [method, path] of routes) {
      const body = method === 'GET' ? undefined : { id: admin.user.id, role: 'user' };
      expect((await call(env, method, path, { cookie: misty.cookie, body })).status, `${method} ${path}`).toBe(403);
      expect((await call(env, method, path, { body })).status, `${method} ${path}`).toBe(401);
    }
    // Off in access mode, like every account route.
    expect((await call({ ...env, AUTH_MODE: 'access' }, 'GET', '/api/admin/users', { cookie: admin.cookie })).status).not.toBe(200);
  });

  it('a demoted admin loses the rights on the very next request', async () => {
    const env = accountEnv();
    const ash = await firstAdmin(env);
    const misty = await inviteAndSignup(env, ash.cookie, 'misty');
    expect((await call(env, 'POST', '/api/admin/users/role', { cookie: ash.cookie, body: { id: misty.user.id, role: 'admin' } })).status).toBe(200);
    expect((await call(env, 'GET', '/api/admin/users', { cookie: misty.cookie })).status).toBe(200);
    expect((await call(env, 'POST', '/api/admin/users/role', { cookie: ash.cookie, body: { id: misty.user.id, role: 'user' } })).status).toBe(200);
    expect((await call(env, 'GET', '/api/admin/users', { cookie: misty.cookie })).status).toBe(403);
  });

  it('admin calls need the CSRF header and our origin, like every cookie request', async () => {
    const env = accountEnv();
    const { cookie } = await firstAdmin(env);
    expect((await call(env, 'POST', '/api/admin/invites', { cookie, body: {}, ptb: false })).status).toBe(403);
    expect((await call(env, 'POST', '/api/admin/invites', { cookie, body: {}, origin: 'https://evil.example' })).status).toBe(403);
  });
});

describe('invites', () => {
  it('makes a code once, lists it without the code, and the code signs someone up once', async () => {
    const env = accountEnv();
    const { cookie, user } = await firstAdmin(env);
    const made = await call(env, 'POST', '/api/admin/invites', { cookie, body: { note: 'for Sam', ttlHours: 48 } });
    expect(made.status).toBe(200);
    expect(made.body.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(made.body.invites).toHaveLength(1);
    expect(made.body.invites[0]).toMatchObject({ note: 'for Sam', status: 'open' });
    const list = await call(env, 'GET', '/api/admin/invites', { cookie });
    expect(list.text).not.toContain(made.body.code);
    expect(list.text).not.toContain(made.body.code.replace(/-/g, ''));
    expect(list.body.invites[0].expiresAt - list.body.invites[0].createdAt).toBe(48 * 3600_000);

    const sam = await call(env, 'POST', '/api/auth/signup', { body: { invite: made.body.code, username: 'sam', ...(await newKeyBody(PW)) } });
    expect(sam.status).toBe(200);
    const again = await call(env, 'POST', '/api/auth/signup', { body: { invite: made.body.code, username: 'sam2', ...(await newKeyBody(PW)) } });
    expect(again.status).toBe(400);
    const after = await call(env, 'GET', '/api/admin/invites', { cookie });
    expect(after.body.invites[0]).toMatchObject({ status: 'used', usedBy: 'sam' });
    const u = await call(env, 'GET', '/api/admin/users', { cookie });
    expect(u.body.users.find((x: { username: string }) => x.username === 'sam').invitedBy).toBe('ash');
    expect((await events(env)).map((e) => e.kind)).toEqual(['invite.create']);
    expect((await events(env))[0]).toMatchObject({ actor: user.id });
    // Notes are plain text, short.
    expect((await call(env, 'POST', '/api/admin/invites', { cookie, body: { note: 'x'.repeat(81) } })).status).toBe(400);
    expect((await call(env, 'POST', '/api/admin/invites', { cookie, body: { ttlHours: 0 } })).status).toBe(400);
    expect((await call(env, 'POST', '/api/admin/invites', { cookie, body: { ttlHours: 24 * 31 } })).status).toBe(400);
  });

  it('a revoked invite stops working; a used one can’t be revoked', async () => {
    const env = accountEnv();
    const { cookie } = await firstAdmin(env);
    const made = await call(env, 'POST', '/api/admin/invites', { cookie, body: {} });
    const id = made.body.invites[0].id;
    const revoked = await call(env, 'DELETE', '/api/admin/invites', { cookie, body: { id } });
    expect(revoked.status).toBe(200);
    expect(revoked.body.invites[0].status).toBe('revoked');
    expect((await call(env, 'POST', '/api/auth/signup', { body: { invite: made.body.code, username: 'sam', ...(await newKeyBody(PW)) } })).status).toBe(400);
    expect((await call(env, 'DELETE', '/api/admin/invites', { cookie, body: { id } })).status).toBe(404);
    expect((await call(env, 'DELETE', '/api/admin/invites', { cookie, body: { id: "' OR 1=1 --" } })).status).toBe(404);
    expect((await events(env)).map((e) => e.kind)).toEqual(['invite.create', 'invite.revoke']);
  });

  it('an invite expires after its time', async () => {
    const env = accountEnv();
    const { cookie } = await firstAdmin(env);
    const t0 = Date.now();
    const made = await call(env, 'POST', '/api/admin/invites', { cookie, body: { ttlHours: 1 }, now: t0 });
    expect((await call(env, 'GET', '/api/admin/invites', { cookie, now: t0 + 3600_001 })).body.invites[0].status).toBe('expired');
    expect((await call(env, 'POST', '/api/auth/signup', { body: { invite: made.body.code, username: 'sam', ...(await newKeyBody(PW)) }, now: t0 + 3600_001 })).status).toBe(400);
  });
});

describe('users', () => {
  it('lists every account with its role, state, devices and who invited it; nothing secret', async () => {
    const env = accountEnv();
    const ash = await firstAdmin(env);
    await inviteAndSignup(env, ash.cookie, 'misty');
    const r = await call(env, 'GET', '/api/admin/users', { cookie: ash.cookie });
    expect(r.body.users.map((u: { username: string; role: string; devices: number; disabled: boolean }) => [u.username, u.role, u.devices, u.disabled])).toEqual([
      ['ash', 'admin', 1, false],
      ['misty', 'user', 1, false],
    ]);
    expect(r.text).not.toMatch(/pw_hash|recovery|ckdf|token/);
  });

  it('disable signs the user out everywhere at once; enable lets them log in again', async () => {
    const env = accountEnv();
    const ash = await firstAdmin(env);
    const misty = await inviteAndSignup(env, ash.cookie, 'misty');
    expect((await call(env, 'POST', '/api/admin/users/disable', { cookie: ash.cookie, body: { id: misty.user.id } })).status).toBe(200);
    expect((await call(env, 'GET', '/api/me', { cookie: misty.cookie })).status).toBe(401);
    expect((await login(env, 'misty')).r.status).toBe(401);
    const list = await call(env, 'GET', '/api/admin/users', { cookie: ash.cookie });
    expect(list.body.users[1]).toMatchObject({ disabled: true, devices: 0 });
    expect((await call(env, 'POST', '/api/admin/users/enable', { cookie: ash.cookie, body: { id: misty.user.id } })).status).toBe(200);
    expect((await login(env, 'misty')).r.status).toBe(200);
    expect((await events(env)).map((e) => [e.kind, e.target])).toEqual([
      ['invite.create', expect.any(String)],
      ['user.disable', misty.user.id],
      ['user.enable', misty.user.id],
    ]);
  });

  it('never yourself, never the last admin', async () => {
    const env = accountEnv();
    const ash = await firstAdmin(env);
    const misty = await inviteAndSignup(env, ash.cookie, 'misty');
    // Yourself.
    expect((await call(env, 'POST', '/api/admin/users/disable', { cookie: ash.cookie, body: { id: ash.user.id } })).status).toBe(409);
    // The last admin can't be demoted, not even by themselves.
    const demote = await call(env, 'POST', '/api/admin/users/role', { cookie: ash.cookie, body: { id: ash.user.id, role: 'user' } });
    expect(demote.status).toBe(409);
    expect(demote.body.error).toMatch(/last admin/);
    // With a second admin, the first can step down; then the second is the last one.
    await call(env, 'POST', '/api/admin/users/role', { cookie: ash.cookie, body: { id: misty.user.id, role: 'admin' } });
    expect((await call(env, 'POST', '/api/admin/users/role', { cookie: ash.cookie, body: { id: ash.user.id, role: 'user' } })).status).toBe(200);
    expect((await call(env, 'POST', '/api/admin/users/role', { cookie: misty.cookie, body: { id: misty.user.id, role: 'user' } })).status).toBe(409);
    expect((await call(env, 'POST', '/api/admin/users/role', { cookie: misty.cookie, body: { id: 'u_nobody', role: 'admin' } })).status).toBe(404);
    const admins = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").first<{ n: number }>();
    expect(admins?.n).toBe(1);
  });

  it('a disabled admin doesn’t count as the other admin', async () => {
    const env = accountEnv();
    const ash = await firstAdmin(env);
    const misty = await inviteAndSignup(env, ash.cookie, 'misty');
    await call(env, 'POST', '/api/admin/users/role', { cookie: ash.cookie, body: { id: misty.user.id, role: 'admin' } });
    expect((await call(env, 'POST', '/api/admin/users/disable', { cookie: ash.cookie, body: { id: misty.user.id } })).status).toBe(200);
    expect((await call(env, 'POST', '/api/admin/users/role', { cookie: ash.cookie, body: { id: ash.user.id, role: 'user' } })).status).toBe(409);
  });
});

describe('password reset by an admin', () => {
  it('needs the admin’s password, makes a 24-hour code that works once, and the user sets their own password', async () => {
    const env = accountEnv();
    const ash = await firstAdmin(env);
    const misty = await inviteAndSignup(env, ash.cookie, 'misty');
    const wrong = await call(env, 'POST', '/api/admin/users/reset', { cookie: ash.cookie, body: { id: misty.user.id, key: await keyFor(env, 'ash', 'not my password') } });
    expect(wrong.status).toBe(403);
    const t0 = Date.now();
    const made = await call(env, 'POST', '/api/admin/users/reset', { cookie: ash.cookie, body: { id: misty.user.id, key: await keyFor(env, 'ash', PW) }, now: t0 });
    expect(made.status).toBe(200);
    expect(made.body.code).toMatch(/^([A-Z2-9]{5}-){3}[A-Z2-9]{5}$/);
    expect(made.body.expiresAt).toBe(t0 + RESET_TTL_MS);
    const stored = await env.DB.prepare('SELECT code_hash FROM reset_codes').all<{ code_hash: string }>();
    expect(JSON.stringify(stored.results)).not.toContain(made.body.code.replace(/-/g, ''));

    const fresh = await newKeyBody('a brand new passphrase');
    const used = await call(env, 'POST', '/api/auth/recover', { body: { username: 'misty', code: made.body.code, ...fresh }, now: t0 + 1000 });
    expect(used.status).toBe(200);
    expect((await call(env, 'GET', '/api/me', { cookie: misty.cookie })).status).toBe(401); // every old session ended
    expect((await call(env, 'POST', '/api/auth/recover', { body: { username: 'misty', code: made.body.code, ...fresh }, now: t0 + 2000 })).status).toBe(400);
    expect((await login(env, 'misty', 'a brand new passphrase')).r.status).toBe(200);
    expect((await events(env)).map((e) => e.kind)).toContain('user.reset');
  });

  it('expires after 24 hours; a newer code replaces the older one; none for a disabled account', async () => {
    const env = accountEnv();
    const ash = await firstAdmin(env);
    const misty = await inviteAndSignup(env, ash.cookie, 'misty');
    const key = await keyFor(env, 'ash', PW);
    const t0 = Date.now();
    const first = await call(env, 'POST', '/api/admin/users/reset', { cookie: ash.cookie, body: { id: misty.user.id, key }, now: t0 });
    const second = await call(env, 'POST', '/api/admin/users/reset', { cookie: ash.cookie, body: { id: misty.user.id, key }, now: t0 + 1 });
    const body = await newKeyBody('a brand new passphrase');
    expect((await call(env, 'POST', '/api/auth/recover', { body: { username: 'misty', code: first.body.code, ...body }, now: t0 + 2 })).status).toBe(400);
    expect((await call(env, 'POST', '/api/auth/recover', { body: { username: 'misty', code: second.body.code, ...body }, now: t0 + RESET_TTL_MS + 2 })).status).toBe(400);
    await call(env, 'POST', '/api/admin/users/disable', { cookie: ash.cookie, body: { id: misty.user.id } });
    expect((await call(env, 'POST', '/api/admin/users/reset', { cookie: ash.cookie, body: { id: misty.user.id, key } })).status).toBe(409);
  });

  it('never writes a code or key to the console', async () => {
    const env = accountEnv();
    const seen: string[] = [];
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation((...a) => void seen.push(a.join(' '))));
    const ash = await firstAdmin(env);
    const misty = await inviteAndSignup(env, ash.cookie, 'misty');
    const key = await keyFor(env, 'ash', PW);
    const inv = await call(env, 'POST', '/api/admin/invites', { cookie: ash.cookie, body: {} });
    const reset = await call(env, 'POST', '/api/admin/users/reset', { cookie: ash.cookie, body: { id: misty.user.id, key } });
    for (const s of spies) s.mockRestore();
    for (const secret of [key, inv.body.code, reset.body.code, ash.cookie.split('=')[1]]) expect(seen.join('\n')).not.toContain(secret);
    expect(JSON.stringify(await events(env))).not.toMatch(new RegExp(`${inv.body.code}|${reset.body.code}`));
  });
});

describe('the desktop app', () => {
  it('reaches the admin routes under /api/device/ with its bearer token', async () => {
    const env = accountEnv();
    await firstAdmin(env);
    const p = await call(env, 'POST', '/api/device/auth/params', { body: { username: 'ash' }, origin: 'tauri://localhost' });
    expect(p.status).toBe(200);
    const r = await call(env, 'POST', '/api/device/auth/login', { body: { username: 'ash', key: await keyFor(env, 'ash', PW), mode: 'token' }, origin: 'tauri://localhost' });
    expect(cookieOf(r)).toBeUndefined();
    expect((await call(env, 'GET', '/api/device/admin/users', { bearer: r.body.token, origin: 'tauri://localhost' })).status).toBe(200);
  });
});
