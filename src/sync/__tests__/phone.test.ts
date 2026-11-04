import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleApi } from '../../../worker/api';
import { NOW, goodClaims, makeEnv, makeKey, signJwt, type TestKey } from '../../../worker/__tests__/helpers';
import { PHONE_EXPIRED_MESSAGE, PHONE_UNLINKED_MESSAGE } from '@/domain/accessSession';
import { useAccountStore } from '../accountStore';
import { isPhoneLinked, useDeviceStore } from '../deviceStore';
import { SyncHttpError, request } from '../http';
import { linkThisPhone, unlinkThisPhone } from '../pairing';
import { useSyncStore } from '../syncStore';

let key: TestKey;
beforeAll(async () => {
  key = await makeKey();
});

const ORIGIN = 'https://app.example';
let env: ReturnType<typeof makeEnv>;
let seen: { url: string; headers: Record<string, string>; credentials?: string; redirect?: string }[];
/** Whether Access answers the cookie routes with its login redirect (the installed iPhone app has no cookie). */
let accessCookie: 'valid' | 'missing';

beforeEach(() => {
  env = makeEnv();
  seen = [];
  accessCookie = 'missing';
  useDeviceStore.setState({ server: undefined, token: undefined, owner: undefined, linkedAt: undefined });
  useAccountStore.setState({ user: undefined, token: undefined, server: undefined, expired: false });
  useSyncStore.setState({ enabled: false });
  vi.stubGlobal('location', { origin: ORIGIN, protocol: 'https:' });
  /**
   * The deployment as the phone sees it: /api/device/* is a Bypass path in Access (it reaches the Worker as is); every other
   * /api/* needs the Access cookie, which this phone does not have, so Access redirects it to its login.
   */
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    seen.push({ url, headers, credentials: init.credentials, redirect: init.redirect });
    const path = new URL(url, ORIGIN).pathname;
    if (!path.startsWith('/api/device/') && accessCookie === 'missing') return { type: 'opaqueredirect', status: 0, ok: false, headers: new Headers() } as unknown as Response;
    return handleApi(new Request(new URL(url, ORIGIN), { method: init.method, headers, body: init.body as string | undefined }), env, { keys: async () => [key.jwk], now: () => NOW });
  });
});
afterEach(() => vi.unstubAllGlobals());

/** A pairing code, made by a device that is signed in (Safari, or the website on a computer). */
async function codeFromSafari(): Promise<string> {
  const jwt = await signJwt(key, goodClaims('me@example.com'));
  const res = await handleApi(new Request(`${ORIGIN}/api/pair`, { method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': jwt } }), env, { keys: async () => [key.jwk], now: () => NOW });
  return ((await res.json()) as { code: string }).code;
}

describe('a phone linked with a pairing code', () => {
  it('without the code, a missing Access cookie is reported as an expired session, with no way to navigate to the login', async () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', { standalone: true });
    const err = await request('GET', '/api/sync?since=0').catch((e) => e);
    expect(err).toBeInstanceOf(SyncHttpError);
    expect(err).toMatchObject({ kind: 'signin', status: 0, message: PHONE_EXPIRED_MESSAGE });
  });

  it('links to the site it runs from, then syncs with the bearer token and no cookie', async () => {
    const owner = await linkThisPhone(await codeFromSafari(), 'iPhone');
    expect(owner).toEqual({ owner: 'me@example.com' });
    expect(isPhoneLinked()).toBe(true);
    expect(useSyncStore.getState().enabled).toBe(true);
    expect(useDeviceStore.getState().server).toBe(ORIGIN);

    const pulled = await request<{ docs: unknown[] }>('GET', '/api/sync?since=0');
    expect(pulled.docs).toEqual([]);
    const call = seen.at(-1)!;
    expect(call.url).toBe(`${ORIGIN}/api/device/sync?since=0`);
    expect(call.credentials).toBe('omit');
    expect(call.redirect).toBe('manual');
    expect(call.headers.authorization).toMatch(/^Bearer ptbd_/);
  });

  it('keeps syncing while the Access session is missing, and when it is back', async () => {
    await linkThisPhone(await codeFromSafari(), 'iPhone');
    await expect(request('GET', '/api/sync?since=0')).resolves.toBeTruthy(); // cookie missing: still fine
    accessCookie = 'valid';
    await expect(request('GET', '/api/sync?since=0')).resolves.toBeTruthy();
  });

  it('says so when the token is refused (unlinked from another device)', async () => {
    await linkThisPhone(await codeFromSafari(), 'iPhone');
    const jwt = await signJwt(key, goodClaims('me@example.com'));
    const list = await handleApi(new Request(`${ORIGIN}/api/devices`, { headers: { 'Cf-Access-Jwt-Assertion': jwt } }), env, { keys: async () => [key.jwk], now: () => NOW });
    const id = ((await list.json()) as { devices: { id: string }[] }).devices[0].id;
    await handleApi(new Request(`${ORIGIN}/api/devices`, { method: 'DELETE', headers: { 'Cf-Access-Jwt-Assertion': jwt, 'content-type': 'application/json' }, body: JSON.stringify({ id }) }), env, { keys: async () => [key.jwk], now: () => NOW });
    const err = await request('GET', '/api/sync?since=0').catch((e) => e);
    expect(err).toMatchObject({ kind: 'signin', status: 401, message: PHONE_UNLINKED_MESSAGE });
  });

  it('unlinking revokes the token on the server and goes back to the cookie, leaving sync on', async () => {
    await linkThisPhone(await codeFromSafari(), 'iPhone');
    const token = useDeviceStore.getState().token!;
    await unlinkThisPhone();
    expect(isPhoneLinked()).toBe(false);
    expect(useSyncStore.getState().enabled).toBe(true);
    const direct = await handleApi(new Request(`${ORIGIN}/api/device/sync?since=0`, { headers: { authorization: `Bearer ${token}` } }), env, { keys: async () => [key.jwk], now: () => NOW });
    expect(direct.status).toBe(401);
  });

  it('a wrong code is a plain message, not a sign-in problem', async () => {
    const err = await linkThisPhone('AAAAA-AAAAA', 'iPhone').catch((e) => e);
    expect(err).toBeInstanceOf(SyncHttpError);
    expect(err.kind).toBe('other');
    expect(isPhoneLinked()).toBe(false);
  });
});
