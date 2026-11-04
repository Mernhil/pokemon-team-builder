/** Shared by the account worker tests: an env with accounts on, a request helper, and the app's side of signup and login. */
import { expect } from 'vitest';
import { KDF_MIN_ITERATIONS, deriveKey, newSalt } from '../../src/domain/accounts';
import { handleApi, type ApiDeps } from '../api';
import { makeEnv } from './helpers';

export const PEPPER = 'test-pepper-0123456789abcdef0123456789';
export const ITER = KDF_MIN_ITERATIONS;
export const ORIGIN = 'https://app.example';
export const DESKTOP = 'tauri://localhost';
export const PW = 'correct horse battery';

export type AccountEnv = ReturnType<typeof makeEnv>;
export const accountEnv = (over: Partial<AccountEnv> = {}): AccountEnv => ({ ...makeEnv(), AUTH_MODE: 'both', PASSWORD_PEPPER: PEPPER, SETUP_CODE: 'setup-code-for-the-first-admin', ...over });

export interface CallOptions {
  body?: unknown;
  cookie?: string;
  bearer?: string;
  origin?: string | null;
  ptb?: boolean;
  ip?: string;
  headers?: Record<string, string>;
  now?: number;
  deps?: ApiDeps;
}
let nextIp = 0;
export async function call(env: AccountEnv, method: string, path: string, o: CallOptions = {}) {
  const headers: Record<string, string> = { 'cf-connecting-ip': o.ip ?? `10.9.${nextIp >> 8}.${nextIp++ & 255}`, ...o.headers };
  if (o.origin !== null) headers.origin = o.origin ?? ORIGIN;
  if (o.ptb !== false) headers['x-ptb'] = '1';
  if (o.cookie) headers.cookie = o.cookie;
  if (o.bearer) headers.authorization = `Bearer ${o.bearer}`;
  const now = o.now;
  const res = await handleApi(new Request(`${ORIGIN}${path}`, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) }), env, { ...(now ? { now: () => now } : {}), ...o.deps });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, body: (text ? JSON.parse(text) : {}) as Record<string, any> };
}
export const cookieOf = (r: { headers: Headers }) => /(__Host-ptb_session=[^;]+)/.exec(r.headers.get('set-cookie') ?? '')?.[1];

/** A fresh salt and the key derived from it, as the app sends for a password it sets. */
export async function newKeyBody(password: string) {
  const salt = newSalt();
  return { key: await deriveKey(password, salt, ITER), salt, iterations: ITER };
}
/** The key for an existing account's password, as the app derives it (params first). */
export async function keyFor(env: AccountEnv, username: string, password: string) {
  const p = await call(env, 'POST', '/api/auth/params', { body: { username } });
  return deriveKey(password, p.body.salt, p.body.iterations);
}
export async function login(env: AccountEnv, username: string, password = PW) {
  const r = await call(env, 'POST', '/api/auth/login', { body: { username, key: await keyFor(env, username, password) } });
  return { r, cookie: cookieOf(r) };
}
/** The first account (an admin), through the setup code. */
export async function firstAdmin(env: AccountEnv, username = 'ash') {
  const r = await call(env, 'POST', '/api/auth/signup', { body: { invite: env.SETUP_CODE, username, ...(await newKeyBody(PW)), deviceName: 'Phone' } });
  expect(r.status).toBe(200);
  return { cookie: cookieOf(r)!, user: r.body.user as { id: string; username: string }, recovery: r.body.recoveryCode as string };
}
/** An admin makes an invite over the API; someone signs up with it. */
export async function inviteAndSignup(env: AccountEnv, adminCookie: string, username: string, password = PW) {
  const inv = await call(env, 'POST', '/api/admin/invites', { cookie: adminCookie, body: { note: `for ${username}` } });
  expect(inv.status).toBe(200);
  const r = await call(env, 'POST', '/api/auth/signup', { body: { invite: inv.body.code, username, ...(await newKeyBody(password)), deviceName: 'Laptop' } });
  expect(r.status).toBe(200);
  return { cookie: cookieOf(r)!, user: r.body.user as { id: string; username: string } };
}
