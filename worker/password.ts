/**
 * What the Worker stores for a password. The slow key derivation (PBKDF2, 600,000 rounds) runs on the
 * person's device (src/domain/accounts.ts `deriveKey`), so the Worker never sees the password and spends
 * almost no CPU: it HMACs the derived key with a secret pepper and compares. That fits Workers' Free plan
 * (10 ms of CPU per request), which a server-side PBKDF2 would not. A stolen database holds only
 * pepper-keyed MACs of keys that took 600,000 rounds to derive: nothing to test guesses against without the pepper.
 *
 * Stored as `ckdf-pbkdf2-sha256$i=600000$p=1$<salt>$<mac>`: the salt and iteration count are what the client
 * needs to derive the key again, and the format can change later.
 */
import { b64url, fromB64url, timingSafeEqual } from './crypto';

/** Which pepper keyed it (so the secret can be rotated without locking anyone out). */
export const PEPPER_ID = 1;

const enc = new TextEncoder();
const FORMAT = /^ckdf-pbkdf2-sha256\$i=(\d{1,8})\$p=(\d{1,3})\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/;

async function mac(pepper: string, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
}

/** The string to store for a client-derived key (43 base64url characters). */
export async function storeKey(key: string, salt: string, iterations: number, pepper: string): Promise<string> {
  return `ckdf-pbkdf2-sha256$i=${iterations}$p=${PEPPER_ID}$${salt}$${b64url(await mac(pepper, fromB64url(key)))}`;
}

/** What the client needs to derive the key again. */
export function paramsOf(stored: string): { salt: string; iterations: number } | null {
  const m = FORMAT.exec(stored);
  return m ? { salt: m[3], iterations: Number(m[1]) } : null;
}

/** Does `key` match `stored`? Constant time. */
export async function verifyKey(key: string, stored: string, pepper: string): Promise<boolean> {
  const m = FORMAT.exec(stored);
  const got = await mac(pepper, fromB64url(key));
  return !!m && timingSafeEqual(got, fromB64url(m[4]));
}

/** The same work as a real check, for a username that doesn't exist. */
export async function dummyVerify(key: string, pepper: string): Promise<void> {
  await mac(pepper, fromB64url(key));
}

/**
 * The parameters shown for a username that doesn't exist: a salt derived from the pepper and the name, so
 * asking twice gives the same answer and it looks exactly like a real one.
 */
export async function fakeParams(usernameKey: string, pepper: string, iterations: number): Promise<{ salt: string; iterations: number }> {
  return { salt: b64url((await mac(pepper, enc.encode(`salt\u0000${usernameKey}`))).slice(0, 16)), iterations };
}
