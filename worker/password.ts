/**
 * Password hashing: PBKDF2-HMAC-SHA256 over HMAC-SHA256(pepper, password). Workers' WebCrypto caps PBKDF2
 * at 100,000 iterations, below OWASP's 600,000; the pepper (a Worker secret that is not in D1) is what makes
 * that acceptable: a stolen database alone can't be brute-forced. The stored string carries its parameters so
 * they can be raised later: `pbkdf2-sha256$i=100000$p=1$<salt>$<hash>`.
 */
import { b64url, fromB64url, randomBytes, timingSafeEqual } from './crypto';

export const PBKDF2_ITERATIONS = 100_000;
/** Which pepper hashed it (so the secret can be rotated without locking anyone out). */
export const PEPPER_ID = 1;

const enc = new TextEncoder();

async function derive(password: string, pepper: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const hmacKey = await crypto.subtle.importKey('raw', enc.encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const pre = await crypto.subtle.sign('HMAC', hmacKey, enc.encode(password.normalize('NFKC')));
  const key = await crypto.subtle.importKey('raw', pre, 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

export async function hashPassword(password: string, pepper: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const salt = randomBytes(16);
  return `pbkdf2-sha256$i=${iterations}$p=${PEPPER_ID}$${b64url(salt)}$${b64url(await derive(password, pepper, salt, iterations))}`;
}

const FORMAT = /^pbkdf2-sha256\$i=(\d{1,7})\$p=(\d{1,3})\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/;

/** Does `password` match `stored`? `upgrade` says the stored parameters are older than the current ones (rehash after this login). */
export async function verifyPassword(password: string, stored: string, pepper: string, iterations = PBKDF2_ITERATIONS): Promise<{ ok: boolean; upgrade: boolean }> {
  const m = FORMAT.exec(stored);
  if (!m) return { ok: false, upgrade: false };
  const [, i, p, salt, hash] = m;
  const got = await derive(password, pepper, fromB64url(salt), Number(i));
  return { ok: timingSafeEqual(got, fromB64url(hash)), upgrade: Number(i) !== iterations || Number(p) !== PEPPER_ID };
}

/** The same work as a real check, for a username that doesn't exist: an unknown user costs what a known one does. */
export async function dummyVerify(password: string, pepper: string, iterations = PBKDF2_ITERATIONS): Promise<void> {
  await derive(password, pepper, new Uint8Array(16), iterations);
}
