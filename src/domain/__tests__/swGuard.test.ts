import { describe, expect, it } from 'vitest';
import { checkPrecacheResponse, NETWORK_ONLY_PATHS } from '@/domain/swGuard';

const ok = { status: 200, type: 'basic', redirected: false };
const check = (url: string, contentType: string | null, over: Partial<typeof ok> = {}, html?: string) => checkPrecacheResponse(url, { ...ok, ...over, contentType }, html);

describe('what the service worker may precache', () => {
  it('accepts each kind of file with its own content type', () => {
    expect(check('https://app.test/assets/index-abc.js', 'text/javascript; charset=utf-8').ok).toBe(true);
    expect(check('https://app.test/assets/index-abc.css', 'text/css').ok).toBe(true);
    expect(check('https://app.test/assets/gen1-abc.json', 'application/json').ok).toBe(true);
    expect(check('https://app.test/sprites/a.webp', 'image/webp').ok).toBe(true);
    expect(check('https://app.test/index.html?__WB_REVISION__=1', 'text/html; charset=utf-8', {}, '<div id="root"></div>').ok).toBe(true);
  });

  it('refuses a web page where a script, stylesheet or data file should be (a login page, or the single-page-app fallback)', () => {
    for (const url of ['https://app.test/assets/a.js', 'https://app.test/assets/a.css', 'https://app.test/assets/a.json', 'https://app.test/sprites/a.png']) {
      expect(check(url, 'text/html; charset=utf-8').ok, url).toBe(false);
    }
    expect(check('https://app.test/assets/a.js', 'text/css').ok).toBe(false);
    expect(check('https://app.test/assets/a.js', null).ok).toBe(false);
  });

  it('refuses a redirect, an opaque answer and any status but 200', () => {
    expect(check('https://app.test/assets/a.js', 'text/javascript', { redirected: true }).ok).toBe(false);
    expect(check('https://app.test/assets/a.js', 'text/javascript', { type: 'opaqueredirect' }).ok).toBe(false);
    expect(check('https://app.test/assets/a.js', 'text/javascript', { type: 'opaque' }).ok).toBe(false);
    expect(check('https://app.test/assets/a.js', 'text/javascript', { status: 304 }).ok).toBe(false);
    expect(check('https://app.test/assets/a.js', 'text/javascript', { status: 404 }).ok).toBe(false);
  });

  it('accepts index.html only if it is the app, not another HTML page', () => {
    const login = '<html><title>Cloudflare Access</title><h1>Sign in</h1></html>';
    expect(check('https://app.test/index.html', 'text/html', {}, login)).toMatchObject({ ok: false, reason: expect.stringContaining('not the app') });
    expect(check('https://app.test/index.html', 'text/html', {}, "<body><div id='root'></div>").ok).toBe(true);
  });

  it('only insists an unknown extension is not a web page', () => {
    expect(check('https://app.test/data.bin', 'application/octet-stream').ok).toBe(true);
    expect(check('https://app.test/data.bin', 'text/html').ok).toBe(false);
  });
});

describe('where the service worker leaves navigations to the network', () => {
  const owned = (path: string) => NETWORK_ONLY_PATHS.some((re) => re.test(path));
  it('covers the Worker (/api) and everything Cloudflare owns (/cdn-cgi, Access\'s callback included)', () => {
    expect(owned('/api/session/renew')).toBe(true);
    expect(owned('/cdn-cgi/access/callback?code=x&state=y')).toBe(true);
    expect(owned('/cdn-cgi/access/logout')).toBe(true);
  });
  it('leaves the app itself to the cache', () => {
    expect(owned('/')).toBe(false);
    expect(owned('/index.html')).toBe(false);
    expect(owned('/apiary')).toBe(false);
  });
});
