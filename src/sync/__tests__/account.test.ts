import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KDF_ITERATIONS, KDF_MIN_ITERATIONS, deriveKey, deviceNameFor } from '@/domain/accounts';
import { AccountError, changePassword, checkAccount, login, logout, recover, revokeSession, signup } from '../account';
import { isSignedIn, sanitizeUser, useAccountStore } from '../accountStore';

const PW = 'correct horse battery';
const SALT = 'AAAAAAAAAAAAAAAAAAAAAA';
const USER = { id: 'u_abc', username: 'ash', role: 'user' as const };
const TOKEN = `ptbs_${'a'.repeat(43)}`;

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  credentials?: RequestCredentials;
  body?: string;
}
let calls: Call[] = [];
type Answer = { status?: number; body?: unknown; headers?: Record<string, string>; text?: string } | 'offline';
/** A fake server: answers by path ("/api/auth/login" or "/api/device/auth/login"). */
function serve(routes: Record<string, Answer | ((c: Call) => Answer)>) {
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const c: Call = { url, method: init.method ?? 'GET', headers: init.headers as Record<string, string>, credentials: init.credentials, body: init.body as string | undefined };
    calls.push(c);
    const path = new URL(url, 'https://app.example').pathname.replace('/api/device/', '/api/');
    const r = routes[path];
    const a = typeof r === 'function' ? r(c) : r;
    if (!a || a === 'offline') throw new TypeError('Failed to fetch');
    if (a.text !== undefined) return new Response(a.text, { status: a.status ?? 200, headers: { 'content-type': 'text/html' } });
    return new Response(JSON.stringify(a.body ?? {}), { status: a.status ?? 200, headers: { 'content-type': 'application/json', ...a.headers } });
  });
}
const desktop = (on: boolean) => {
  if (on) vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
  else vi.unstubAllGlobals();
};

beforeEach(() => {
  calls = [];
  useAccountStore.setState({ user: undefined, token: undefined, server: undefined, expiresAt: undefined, expired: false, bannerDismissed: false, cardDismissed: false, availability: 'unknown' });
});
afterEach(() => vi.unstubAllGlobals());

const loginRoutes = () => ({
  '/api/auth/params': { body: { salt: SALT, iterations: KDF_MIN_ITERATIONS } },
  '/api/auth/login': (c: Call) => (JSON.parse(c.body!).key === expected ? { body: { user: USER, expiresAt: 1 } } : { status: 401, body: { error: 'Wrong username or password.' } }),
});
let expected = '';

describe('logging in (web)', () => {
  it('asks for the salt, derives the key here and sends only the key; the password never leaves the device', async () => {
    expected = await deriveKey(PW, SALT, KDF_MIN_ITERATIONS);
    serve(loginRoutes());
    await login({ username: ' ash ', password: PW });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['POST /api/auth/params', 'POST /api/auth/login']);
    for (const c of calls) {
      expect(c.body).not.toContain(PW);
      expect(c.headers['x-ptb']).toBe('1');
      expect(c.credentials).toBe('same-origin');
      expect(c.url).not.toContain(PW);
    }
    const body = JSON.parse(calls[1].body!);
    expect(body).toMatchObject({ username: 'ash', key: expected, mode: 'cookie' });
    expect(isSignedIn()).toBe(true);
    expect(useAccountStore.getState().token).toBeUndefined(); // the web session is a cookie
  });

  it('says what the server says for a wrong password, and stays signed out', async () => {
    expected = 'nothing matches';
    serve(loginRoutes());
    await expect(login({ username: 'ash', password: 'not the password' })).rejects.toThrow('Wrong username or password.');
    expect(isSignedIn()).toBe(false);
  });

  it('turns a throttle into a message with the wait', async () => {
    serve({ '/api/auth/params': { status: 429, body: { error: 'Too many attempts. Wait a few minutes and try again.' }, headers: { 'retry-after': '600' } } });
    await expect(login({ username: 'ash', password: PW })).rejects.toThrow(/Too many attempts.*about 10 min/);
  });
});

describe('creating an account', () => {
  it('checks the rules before sending anything', async () => {
    serve({});
    await expect(signup({ invite: 'K7QM-3XWD-9PTR', username: 'ash', password: 'short' })).rejects.toThrow(/at least 10/);
    await expect(signup({ invite: 'K7QM-3XWD-9PTR', username: 'a b', password: PW })).rejects.toThrow(/letters, digits/);
    await expect(signup({ invite: ' ', username: 'ash', password: PW })).rejects.toThrow(/invite code/);
    expect(calls).toEqual([]);
  });

  it('sends a fresh salt and the key derived with the full rounds, and returns the recovery code once', async () => {
    serve({ '/api/auth/signup': { body: { user: USER, expiresAt: 1, recoveryCode: 'ABCDE-FGHJK-LMNPQ-RSTUV' } } });
    const code = await signup({ invite: 'k7qm-3xwd-9ptr', username: 'ash', password: PW });
    expect(code).toBe('ABCDE-FGHJK-LMNPQ-RSTUV');
    const body = JSON.parse(calls[0].body!);
    expect(body.iterations).toBe(KDF_ITERATIONS);
    expect(body.key).toBe(await deriveKey(PW, body.salt, KDF_ITERATIONS));
    expect(calls[0].body).not.toContain(PW);
    expect(isSignedIn()).toBe(true);
    // The code is not kept anywhere on the device.
    expect(JSON.stringify(useAccountStore.getState())).not.toContain('ABCDE');
  });
});

describe('recovery and the password', () => {
  it('recovery sends a new salt and key with the code, and signs this device in', async () => {
    serve({ '/api/auth/recover': { body: { user: USER, expiresAt: 1, recoveryCode: 'NEWNE-WNEWN-EWNEW-NEWNE' } } });
    expect(await recover({ username: 'ash', code: 'abcde fghjk lmnpq rstuv', password: PW })).toBe('NEWNE-WNEWN-EWNEW-NEWNE');
    expect(calls[0].body).not.toContain(PW);
    expect(isSignedIn()).toBe(true);
  });

  it('a password change derives the current key from the stored salt and a new one from a fresh salt', async () => {
    useAccountStore.getState().signIn({ user: USER });
    serve({ '/api/auth/params': { body: { salt: SALT, iterations: KDF_MIN_ITERATIONS } }, '/api/me/password': { body: { ok: true } } });
    await changePassword(PW, 'a brand new passphrase');
    const body = JSON.parse(calls[1].body!);
    expect(body.current).toBe(await deriveKey(PW, SALT, KDF_MIN_ITERATIONS));
    expect(body.next.salt).not.toBe(SALT);
    expect(calls.every((c) => !c.body?.includes(PW) && !c.body?.includes('a brand new passphrase'))).toBe(true);
  });
});

describe('the session ending', () => {
  it('a 401 from the server marks a signed-in device as expired (the banner offers to sign in again)', async () => {
    useAccountStore.getState().signIn({ user: USER });
    serve({ '/api/me': { status: 401, body: { error: 'not signed in' } } });
    expect(await checkAccount()).toBe('signedOut');
    const s = useAccountStore.getState();
    expect(s.expired).toBe(true);
    expect(s.user?.username).toBe('ash'); // kept, to fill in the login form
    expect(isSignedIn()).toBe(false);
  });

  it('a server without accounts (404, or the app’s own page) is "off"', async () => {
    serve({ '/api/me': { status: 404, body: { error: 'not found' } } });
    expect(await checkAccount()).toBe('off');
    serve({ '/api/me': { text: '<!doctype html>' } });
    expect(await checkAccount()).toBe('off');
    expect(useAccountStore.getState().availability).toBe('off');
  });

  it('logging out forgets the session even when the server can’t be reached', async () => {
    useAccountStore.getState().signIn({ user: USER });
    serve({ '/api/auth/logout': 'offline' });
    await expect(logout()).rejects.toBeInstanceOf(AccountError);
    expect(useAccountStore.getState().user).toBeUndefined();
  });

  it('revoking this device’s own session logs it out; another one doesn’t', async () => {
    useAccountStore.getState().signIn({ user: USER });
    serve({ '/api/sessions': { body: { sessions: [] } } });
    await revokeSession('other', false);
    expect(isSignedIn()).toBe(true);
    await revokeSession('mine', true);
    expect(isSignedIn()).toBe(false);
  });
});

describe('the desktop app', () => {
  it('needs the server address, logs in under /api/device/ with token mode, keeps the token and sends it as a bearer', async () => {
    desktop(true);
    expected = await deriveKey(PW, SALT, KDF_MIN_ITERATIONS);
    serve({ ...loginRoutes(), '/api/auth/login': { body: { user: USER, expiresAt: 1, token: TOKEN } }, '/api/me': { body: { user: USER } } });
    await expect(login({ username: 'ash', password: PW })).rejects.toThrow(/address of your app/);
    expect(calls).toEqual([]);
    await login({ username: 'ash', password: PW, server: 'app.example' });
    expect(calls[1].url).toBe('https://app.example/api/device/auth/login');
    expect(calls[1].credentials).toBe('omit');
    expect(JSON.parse(calls[1].body!).mode).toBe('token');
    expect(useAccountStore.getState()).toMatchObject({ server: 'https://app.example', token: TOKEN });
    await checkAccount();
    expect(calls[2].headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(calls[2].url).not.toContain(TOKEN);
  });
});

describe('ptb:session:v1', () => {
  it('keeps a valid user, server and token, and drops anything malformed', () => {
    const merge = useAccountStore.persist.getOptions().merge!;
    const current = useAccountStore.getState();
    const ok = merge({ user: USER, server: 'https://app.example/x', token: TOKEN, expired: true, cardDismissed: true }, current) as typeof current;
    expect(ok).toMatchObject({ user: USER, server: 'https://app.example', token: TOKEN, expired: true, cardDismissed: true });
    const bad = merge({ user: { id: 5 }, server: 'javascript:alert(1)', token: 'ptbd_old', expired: true }, current) as typeof current;
    expect(bad).toMatchObject({ user: undefined, server: undefined, token: undefined, expired: false, cardDismissed: false });
    expect(sanitizeUser({ ...USER, role: 'root', displayName: 'x'.repeat(80) })).toEqual({ ...USER, role: 'user', displayName: 'x'.repeat(40) });
  });

  it('names the device for the devices list', () => {
    expect(deviceNameFor('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1', false)).toBe('iPhone');
    expect(deviceNameFor('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', false)).toBe('Chrome on Windows');
    expect(deviceNameFor('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', true)).toBe('Desktop app on Mac');
    expect(deviceNameFor('', false)).toBe('Browser');
  });
});
