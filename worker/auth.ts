/**
 * Cloudflare Access JWT verification. The Worker never trusts a plain e-mail header: it checks the
 * signature of `Cf-Access-Jwt-Assertion` against the Access team's published keys (JWKS), then its
 * issuer, audience and time, and only then uses the e-mail inside it.
 */

export interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
}

export class AuthError extends Error {}

export interface AccessConfig {
  teamDomain: string;
  audience: string;
}

/** Fetches the team's signing keys. `force` skips any cache (a key that wasn't there may have just been rotated in). */
export type KeyProvider = (force?: boolean) => Promise<Jwk[]>;

const b64urlToBytes = (s: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='));
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
};
const decodeJson = (s: string): Record<string, unknown> => {
  try {
    const v = JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  throw new AuthError('malformed token');
};

/** "myteam.cloudflareaccess.com", with or without https://, as the issuer URL. */
export const issuerOf = (teamDomain: string) => `https://${teamDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;

const LEEWAY_S = 30;

/** Verifies an Access JWT and returns the signed-in e-mail (lower case). Throws AuthError for anything wrong with it. */
export async function verifyAccessJwt(token: string, cfg: AccessConfig, keys: KeyProvider, nowMs = Date.now()): Promise<{ email: string }> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new AuthError('malformed token');
  const [h, p, sig] = parts;
  const header = decodeJson(h);
  const claims = decodeJson(p);
  if (header.alg !== 'RS256') throw new AuthError('unsupported algorithm');
  if (typeof header.kid !== 'string') throw new AuthError('no key id');

  let jwk = (await keys()).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await keys(true)).find((k) => k.kid === header.kid);
  if (!jwk || jwk.kty !== 'RSA') throw new AuthError('unknown signing key');

  const key = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(sig), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new AuthError('bad signature');

  const now = Math.floor(nowMs / 1000);
  if (typeof claims.exp !== 'number' || claims.exp + LEEWAY_S < now) throw new AuthError('token expired');
  if (typeof claims.nbf === 'number' && claims.nbf - LEEWAY_S > now) throw new AuthError('token not valid yet');
  if (claims.iss !== issuerOf(cfg.teamDomain)) throw new AuthError('wrong issuer');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(cfg.audience)) throw new AuthError('wrong audience');
  if (typeof claims.email !== 'string' || !claims.email.includes('@')) throw new AuthError('no e-mail in token');
  return { email: claims.email.trim().toLowerCase() };
}

/** The team's keys from https://<team>/cdn-cgi/access/certs, cached for an hour (a forced refresh at most once a minute). */
export function jwksProvider(teamDomain: string, fetchImpl: typeof fetch = fetch, now: () => number = Date.now): KeyProvider {
  let cache: { keys: Jwk[]; at: number } | undefined;
  return async (force = false) => {
    const age = cache ? now() - cache.at : Infinity;
    if (cache && age < 3_600_000 && !(force && age > 60_000)) return cache.keys;
    const res = await fetchImpl(`${issuerOf(teamDomain)}/cdn-cgi/access/certs`);
    if (!res.ok) throw new AuthError(`could not load the Access keys (HTTP ${res.status})`);
    const body = (await res.json()) as { keys?: Jwk[] };
    cache = { keys: Array.isArray(body.keys) ? body.keys : [], at: now() };
    return cache.keys;
  };
}
