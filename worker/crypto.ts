/** WebCrypto helpers for the account code: hashing, random tokens, constant-time comparison. */

export const bytesToHex = (bytes: Uint8Array): string => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(text: string): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
}

export const b64url = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const randomBytes = (n: number): Uint8Array<ArrayBuffer> => crypto.getRandomValues(new Uint8Array(n));
/** A random id such as "u_Ab3dE9xYz1Qw": 9 random bytes. */
export const randomId = (prefix = ''): string => prefix + b64url(randomBytes(9));
/** A session token: 32 random bytes (43 characters). */
export const randomToken = (): string => `ptbs_${b64url(randomBytes(32))}`;

/** Compares two byte strings in time that depends only on their length. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/** Compares two strings without leaking where they differ (both are hashed first, so lengths don't matter). */
export async function safeEqualText(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  return timingSafeEqual(new TextEncoder().encode(x), new TextEncoder().encode(y));
}
