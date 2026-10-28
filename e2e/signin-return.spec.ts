import { readFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { expect, test, type Page } from '@playwright/test';
import { startAccessSim, type AccessSim } from './support/accessSim';

// The sign-in round trip with the production build, its real service worker and a stand-in for Cloudflare Access
// (e2e/support/accessSim.ts). docs/SYNC.md → "Sign in again".
test.use({ serviceWorkers: 'allow', storageState: { cookies: [], origins: [] } });

const version = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')) as { version: string }).version;

let sim: AccessSim;
test.beforeEach(async () => {
  const testInfo = test.info();
  // Two ports per worker (the app and the Access login), apart from the other project's, so parallel workers never meet.
  const port = 4300 + (testInfo.project.name === 'iphone' ? 100 : 0) + testInfo.parallelIndex * 2;
  sim = await startAccessSim(port, port + 1);
});
test.afterEach(async () => { await sim.close(); });

/** Cloud sync is on and this version's "What's new" has been seen, once: the page's own storage wins after that. */
async function seed(page: Page) {
  await page.addInitScript((v) => {
    if (localStorage.getItem('ptb:test-seeded')) return;
    localStorage.setItem('ptb:test-seeded', '1');
    localStorage.setItem('ptb:prefs:v1', JSON.stringify({ state: { lastSeenVersion: v }, version: 1 }));
    localStorage.setItem('ptb:sync:v1', JSON.stringify({ state: { enabled: true, deviceName: 'Test phone', cursor: 0, known: {} }, version: 1 }));
  }, version);
}

/** Sign in from a clean browser: Access login on its own origin, back through the callback, then the app. */
async function firstLogin(page: Page) {
  await page.goto(`${sim.appOrigin}/`);
  await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
  await page.locator('#continue').click();
  await expect(page.getByRole('heading', { level: 1 })).toBeAttached();
}

/** The service worker has installed (all of the precache) and controls this page. */
async function serviceWorkerInControl(page: Page) {
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
}

test('Sign in again → Access login → back through /cdn-cgi/access/callback lands in a working app', async ({ page }) => {
  await seed(page);
  await firstLogin(page);
  await serviceWorkerInControl(page);

  // The Access session ends; the app finds out on its next sync.
  sim.expireSession();
  await page.reload();
  const banner = page.getByRole('alert').filter({ hasText: 'sign-in has expired' });
  await expect(banner).toBeVisible();
  sim.reset();

  await banner.getByRole('button', { name: 'Sign in again' }).click();
  await page.waitForURL(`${sim.loginOrigin}/**`);
  await page.locator('#continue').click();
  await page.waitForURL((u) => u.origin === sim.appOrigin);
  await page.waitForLoadState('load');

  // The callback reached Access (the cookie was set), and the app is where it belongs, drawn.
  expect(sim.hits.map((h) => h.path.split('?')[0])).toContain('/cdn-cgi/access/callback');
  await expect(page.getByRole('heading', { level: 1 })).toBeAttached();
  expect(new URL(page.url()).pathname).toBe('/');
  await expect(banner).toHaveCount(0);
});

// --- helpers for the service-worker cases ---------------------------------------------------------------------------------

const DIST = new URL('../dist/', import.meta.url);
const INDEX_HTML = () => readFileSync(new URL('index.html', DIST), 'utf-8');
const html200 = (res: ServerResponse) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(INDEX_HTML()); };
const toLogin = (res: ServerResponse) => { res.writeHead(302, { location: `${sim.loginOrigin}/cdn-cgi/access/login/app` }); res.end(); };
const toHome = (res: ServerResponse) => { res.writeHead(302, { location: '/' }); res.end(); };

type WorkerState = 'none' | 'installing' | 'active';
const workerState = (page: Page) => page.evaluate(async (): Promise<WorkerState> => {
  const r = await navigator.serviceWorker.getRegistration();
  if (!r) return 'none';
  if (r.active) return 'active';
  return r.installing || r.waiting ? 'installing' : 'none';
});

/** Everything cached whose URL matches, with the content type it would be served as. */
const cachedFiles = (page: Page, pattern: string) => page.evaluate(async (src) => {
  const rx = new RegExp(src);
  const found: { url: string; type: string | null }[] = [];
  for (const name of await caches.keys()) {
    const cache = await caches.open(name);
    for (const request of await cache.keys()) if (rx.test(request.url)) found.push({ url: request.url, type: (await cache.match(request))?.headers.get('content-type') ?? null });
  }
  return found;
}, pattern);

/** The page has asked the server for this path (the service worker's install downloads count). */
const asked = (re: RegExp) => () => sim.hits.some((h) => re.test(h.path));

// --- a fresh load, a service worker that is installed, and Access answering with a login redirect ---------------------------

test('a first visit with the Access session over shows the Access login, then the app', async ({ page }) => {
  sim.expireSession();
  await page.goto(`${sim.appOrigin}/`);
  await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
  await page.locator('#continue').click();
  await expect(page.getByRole('heading', { level: 1 })).toBeAttached();
  expect(new URL(page.url()).pathname).toBe('/');
});

test('an installed app opens from its cache while every file answers with an Access redirect, and a service worker update check that meets the redirect changes nothing', async ({ page }) => {
  await seed(page);
  await firstLogin(page);
  await serviceWorkerInControl(page);
  const before = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.scriptURL);

  sim.expireSession(); // /sw.js, the manifest, every chunk: 302 to the Access login
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeAttached();
  const update = await page.evaluate(async () => { try { await (await navigator.serviceWorker.ready).update(); return 'updated'; } catch (e) { return String(e); } });
  expect(update).toMatch(/redirect|fetch|network/i);
  expect(await workerState(page)).toBe('active');
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.scriptURL)).toBe(before);
  // The lazy screens come from the precache, not from the redirecting network.
  await page.goto(`${sim.appOrigin}/#matches`);
  await expect(page.getByRole('heading', { level: 1 })).toBeAttached();
  await expect(page.getByRole('alert').filter({ hasText: 'needs a newer version' })).toHaveCount(0);
});

// --- the precache never keeps a redirect or a web page in place of a file ------------------------------------------------------

const BAD_ANSWERS: Record<string, (res: ServerResponse) => void> = {
  'index.html with a 200 (the single-page-app fallback of a file that is gone)': html200,
  'a redirect to the site itself, which ends in index.html': toHome,
  'a redirect to the Access login': toLogin,
};
for (const [what, answer] of Object.entries(BAD_ANSWERS)) {
  test(`a screen's script answered with ${what} while installing is never precached`, async ({ page }) => {
    await seed(page);
    sim.override(/^\/assets\/MatchesView-.*\.js$/, answer);
    await firstLogin(page);
    await expect.poll(asked(/^\/assets\/MatchesView-/), { timeout: 30_000 }).toBe(true);
    await expect.poll(() => workerState(page), { timeout: 15_000 }).not.toBe('installing');
    expect((await cachedFiles(page, 'MatchesView-')).filter((f) => !/javascript/.test(f.type ?? ''))).toEqual([]);

    // Once the server answers properly the next visit installs, and the screen works.
    sim.override(/^\/assets\/MatchesView-.*\.js$/, null);
    await page.reload();
    await expect.poll(() => workerState(page), { timeout: 30_000 }).toBe('active');
    await serviceWorkerInControl(page);
    expect((await cachedFiles(page, 'MatchesView-')).map((f) => f.type)).toEqual([expect.stringMatching(/javascript/)]);
    await page.goto(`${sim.appOrigin}/#matches`);
    await expect(page.getByRole('heading', { level: 1 })).toBeAttached();
    await expect(page.getByRole('alert').filter({ hasText: 'needs a newer version' })).toHaveCount(0);
  });
}

test('an update that cannot download all its files leaves the running version and its precache as they were', async ({ page, context }) => {
  await seed(page);
  await firstLogin(page);
  await serviceWorkerInControl(page);
  const before = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.scriptURL);

  // "A new deploy": the worker file differs and lists favicon.png under a new revision; the favicon now comes back as a web page.
  const sw = readFileSync(new URL('sw.js', DIST), 'utf-8');
  const next = sw.replace(/("revision":")[0-9a-f]+(","url":"favicon\.png")/, '$1bumped0000$2');
  expect(next).not.toBe(sw);
  sim.override(/^\/sw\.js$/, (res) => { res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-cache' }); res.end(next); });
  sim.override(/^\/favicon\.png$/, html200);
  await page.evaluate(async () => { try { await (await navigator.serviceWorker.ready).update(); } catch { /* the install failing may reject */ } });
  await expect.poll(asked(/^\/favicon\.png/), { timeout: 20_000 }).toBe(true);
  await expect.poll(() => page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return !!(r?.installing || r?.waiting); }), { timeout: 15_000 }).toBe(false);

  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.scriptURL)).toBe(before);
  const favicons = await cachedFiles(page, '/favicon\\.png');
  expect(favicons.length).toBeGreaterThan(0);
  expect(favicons.every((f) => /^image\//.test(f.type ?? ''))).toBe(true);
  expect(favicons.some((f) => f.url.includes('bumped0000'))).toBe(false);

  // And the app still opens from that precache with the network gone.
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeAttached();
});

// --- the blank-screen guard (src/bootGuard.js, inlined in index.html) -------------------------------------------------------------

const ENTRY = /^\/assets\/index-.*\.js$/;
const guardPanel = (page: Page) => page.locator('#boot-guard');

test('a build that cannot load its script says so, and Reset app cache keeps the teams', async ({ page }) => {
  await seed(page);
  await firstLogin(page);
  await serviceWorkerInControl(page);
  await page.evaluate(() => localStorage.setItem('ptb:test-team', 'kept'));

  // A cache gone bad: the cached copy of the entry script is lost and the server cannot serve it either.
  await page.evaluate(async () => {
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) if (/\/assets\/index-.*\.js/.test(request.url)) await cache.delete(request);
    }
  });
  sim.override(ENTRY, (res) => { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('gone'); });
  await page.reload();
  await expect(guardPanel(page)).toBeVisible();
  await expect(guardPanel(page)).toContainText("didn't start");
  for (const name of ['Reload', 'Reset app cache', 'Sign in again']) await expect(guardPanel(page).getByRole('button', { name })).toBeVisible();

  await Promise.all([page.waitForEvent('load'), guardPanel(page).getByRole('button', { name: 'Reset app cache' }).click()]);
  // The page comes back at the root with no service worker and no caches; the app is still down (the server still refuses the script) ...
  await expect(guardPanel(page)).toBeVisible();
  expect(await page.evaluate(async () => ({ workers: (await navigator.serviceWorker.getRegistrations()).length, caches: (await caches.keys()).length }))).toEqual({ workers: 0, caches: 0 });
  // ... and what the player made is untouched.
  expect(await page.evaluate(() => localStorage.getItem('ptb:test-team'))).toBe('kept');

  // The server is back: Reload brings the app up.
  sim.override(ENTRY, null);
  await guardPanel(page).getByRole('button', { name: 'Reload' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeAttached();
  await expect(guardPanel(page)).toHaveCount(0);
});

test('a page that draws nothing for 8 seconds gets the guard, which goes away if the app draws after all', async ({ page }) => {
  await page.clock.install();
  await seed(page);
  await firstLogin(page);
  sim.override(ENTRY, (res) => { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end('/* nothing */'); });
  // No service worker yet on this visit (the first login's own installs are not awaited), so the server answer is what loads.
  await page.evaluate(async () => { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); for (const k of await caches.keys()) await caches.delete(k); });
  await page.goto(`${sim.appOrigin}/`);
  await page.clock.fastForward(7000);
  await expect(guardPanel(page)).toHaveCount(0);
  await page.clock.fastForward(2000);
  await expect(guardPanel(page)).toBeVisible();
  await expect(guardPanel(page)).toContainText('Nothing was drawn');

  await page.evaluate(() => document.getElementById('root')!.append(document.createElement('main')));
  await expect(guardPanel(page)).toHaveCount(0);
});

test('the guard offers Sign in again, which goes through the Access login back to the app', async ({ page }) => {
  await seed(page);
  await firstLogin(page);
  sim.override(ENTRY, (res) => { res.writeHead(404); res.end(); });
  await page.evaluate(async () => { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); for (const k of await caches.keys()) await caches.delete(k); });
  await page.goto(`${sim.appOrigin}/`);
  await expect(guardPanel(page)).toBeVisible();
  sim.expireSession();
  await guardPanel(page).getByRole('button', { name: 'Sign in again' }).click();
  await page.waitForURL(`${sim.loginOrigin}/**`);
  sim.override(ENTRY, null);
  await page.locator('#continue').click();
  await expect(page.getByRole('heading', { level: 1 })).toBeAttached();
  expect(new URL(page.url()).pathname).toBe('/');
});

test('a healthy start never shows the guard', async ({ page }) => {
  await page.clock.install();
  await seed(page);
  await firstLogin(page);
  await page.clock.fastForward(20_000);
  await expect(page.getByRole('heading', { level: 1 })).toBeAttached();
  await expect(guardPanel(page)).toHaveCount(0);
});
