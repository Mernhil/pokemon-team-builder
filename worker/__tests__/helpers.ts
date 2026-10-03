import type { Jwk } from '../auth';
import type { Env } from '../types';
import { createD1 } from './d1shim';

export const TEAM = 'myteam.cloudflareaccess.com';
export const AUD = 'aud-tag-1234';

const b64url = (b: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof b === 'string' ? new TextEncoder().encode(b) : new Uint8Array(b);
  let s = '';
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export interface TestKey {
  kid: string;
  jwk: Jwk;
  privateKey: CryptoKey;
}

/** A fresh RSA key pair and its public JWK, standing in for the Access team's JWKS. */
export async function makeKey(kid = 'key-1'): Promise<TestKey> {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const pub = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as { n: string; e: string };
  return { kid, jwk: { kid, kty: 'RSA', n: pub.n, e: pub.e, alg: 'RS256' }, privateKey: pair.privateKey };
}

export async function signJwt(key: TestKey, claims: Record<string, unknown>, header: Record<string, unknown> = {}): Promise<string> {
  const h = b64url(JSON.stringify({ alg: 'RS256', kid: key.kid, typ: 'JWT', ...header }));
  const p = b64url(JSON.stringify(claims));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key.privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(sig)}`;
}

export const NOW = Date.parse('2030-01-01T12:00:00Z');

export const goodClaims = (email = 'me@example.com', over: Record<string, unknown> = {}) => ({
  iss: `https://${TEAM}`,
  aud: [AUD],
  email,
  iat: Math.floor(NOW / 1000) - 60,
  nbf: Math.floor(NOW / 1000) - 60,
  exp: Math.floor(NOW / 1000) + 3600,
  ...over,
});

export function makeEnv(): Env & { DB: ReturnType<typeof createD1> } {
  return { ASSETS: { fetch: async () => new Response('asset') }, DB: createD1(), ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
}
