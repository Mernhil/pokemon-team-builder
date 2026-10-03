import { describe, expect, it } from 'vitest';
import { AuthError, issuerOf, jwksProvider, verifyAccessJwt } from '../auth';
import { AUD, NOW, TEAM, goodClaims, makeKey, signJwt } from './helpers';

const cfg = { teamDomain: TEAM, audience: AUD };

describe('Access JWT verification', () => {
  it('accepts a valid token and returns the lower-cased e-mail', async () => {
    const key = await makeKey();
    const token = await signJwt(key, goodClaims('Me@Example.COM'));
    expect(await verifyAccessJwt(token, cfg, async () => [key.jwk], NOW)).toEqual({ email: 'me@example.com' });
  });

  it('rejects an expired token (beyond the small leeway)', async () => {
    const key = await makeKey();
    const expired = await signJwt(key, goodClaims('me@example.com', { exp: Math.floor(NOW / 1000) - 3600 }));
    await expect(verifyAccessJwt(expired, cfg, async () => [key.jwk], NOW)).rejects.toThrow('token expired');
    const justExpired = await signJwt(key, goodClaims('me@example.com', { exp: Math.floor(NOW / 1000) - 5 }));
    await expect(verifyAccessJwt(justExpired, cfg, async () => [key.jwk], NOW)).resolves.toBeDefined();
  });

  it('rejects the wrong audience (a string or a list), the wrong issuer and a token not yet valid', async () => {
    const key = await makeKey();
    const keys = async () => [key.jwk];
    await expect(verifyAccessJwt(await signJwt(key, goodClaims('a@b.c', { aud: ['someone-else'] })), cfg, keys, NOW)).rejects.toThrow('wrong audience');
    await expect(verifyAccessJwt(await signJwt(key, goodClaims('a@b.c', { aud: 'someone-else' })), cfg, keys, NOW)).rejects.toThrow('wrong audience');
    await expect(verifyAccessJwt(await signJwt(key, goodClaims('a@b.c', { aud: AUD })), cfg, keys, NOW)).resolves.toBeDefined();
    await expect(verifyAccessJwt(await signJwt(key, goodClaims('a@b.c', { iss: 'https://evil.cloudflareaccess.com' })), cfg, keys, NOW)).rejects.toThrow('wrong issuer');
    await expect(verifyAccessJwt(await signJwt(key, goodClaims('a@b.c', { nbf: Math.floor(NOW / 1000) + 3600 })), cfg, keys, NOW)).rejects.toThrow('not valid yet');
  });

  it('rejects a bad signature, an unknown key, another algorithm and garbage', async () => {
    const key = await makeKey('k1');
    const other = await makeKey('k1'); // same id, different key
    const token = await signJwt(key, goodClaims());
    await expect(verifyAccessJwt(token, cfg, async () => [other.jwk], NOW)).rejects.toThrow('bad signature');
    await expect(verifyAccessJwt(await signJwt(key, goodClaims(), { kid: 'missing' }), cfg, async () => [key.jwk], NOW)).rejects.toThrow('unknown signing key');
    await expect(verifyAccessJwt(await signJwt(key, goodClaims(), { alg: 'none' }), cfg, async () => [key.jwk], NOW)).rejects.toThrow('unsupported algorithm');
    await expect(verifyAccessJwt(await signJwt(key, goodClaims('not-an-email')), cfg, async () => [key.jwk], NOW)).rejects.toThrow('no e-mail');
    for (const junk of ['', 'a.b', 'a.b.c', 'x.y.z.w']) await expect(verifyAccessJwt(junk, cfg, async () => [key.jwk], NOW)).rejects.toBeInstanceOf(AuthError);
  });

  it('tampering with the claims breaks the signature', async () => {
    const key = await makeKey();
    const token = await signJwt(key, goodClaims('me@example.com'));
    const [h, , s] = token.split('.');
    const forged = `${h}.${btoa(JSON.stringify(goodClaims('admin@example.com'))).replace(/=+$/, '')}.${s}`;
    await expect(verifyAccessJwt(forged, cfg, async () => [key.jwk], NOW)).rejects.toThrow('bad signature');
  });

  it('refreshes the key list once when the key id is new (a rotated key)', async () => {
    const key = await makeKey('rotated');
    const calls: boolean[] = [];
    const keys = async (force?: boolean) => {
      calls.push(!!force);
      return force ? [key.jwk] : [];
    };
    await verifyAccessJwt(await signJwt(key, goodClaims()), cfg, keys, NOW);
    expect(calls).toEqual([false, true]);
  });
});

describe('JWKS provider', () => {
  it('fetches the team certs URL and caches them for an hour', async () => {
    const key = await makeKey();
    let fetches = 0;
    let clock = 1_000_000;
    const fake = (async (url: string) => {
      fetches++;
      expect(url).toBe(`https://${TEAM}/cdn-cgi/access/certs`);
      return new Response(JSON.stringify({ keys: [key.jwk] }));
    }) as unknown as typeof fetch;
    const provider = jwksProvider(`https://${TEAM}/`, fake, () => clock);
    expect(await provider()).toHaveLength(1);
    await provider();
    expect(fetches).toBe(1);
    clock += 30_000;
    await provider(true); // too soon to refresh again
    expect(fetches).toBe(1);
    clock += 31_000;
    await provider(true);
    expect(fetches).toBe(2);
    clock += 3_700_000;
    await provider();
    expect(fetches).toBe(3);
  });

  it('turns a failed fetch into an auth error', async () => {
    const provider = jwksProvider(TEAM, (async () => new Response('no', { status: 500 })) as unknown as typeof fetch);
    await expect(provider()).rejects.toBeInstanceOf(AuthError);
  });

  it('normalises the issuer', () => {
    expect(issuerOf('myteam.cloudflareaccess.com')).toBe('https://myteam.cloudflareaccess.com');
    expect(issuerOf('https://myteam.cloudflareaccess.com/')).toBe('https://myteam.cloudflareaccess.com');
  });
});
