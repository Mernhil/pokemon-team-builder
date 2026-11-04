import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow, openApp } from './helpers';

// The installed iPhone app can't sign back in to Cloudflare Access (its cookies are separate from Safari's), so an expired
// session must be said in words, never navigated to, and a pairing code must bring sync back (docs/SYNC.md). Phone project only.
test.beforeEach(({ isMobile }) => {
  test.skip(!isMobile, 'phone app');
});

const LOGIN = 'https://myteam.cloudflareaccess.com/cdn-cgi/access/login/app.example?kid=1';
const TOKEN = `ptbd_${'a'.repeat(43)}`;
const MESSAGE = 'Session expired: link this phone with a code, or sign in from Safari.';

/** Sync is on and the Home Screen app is "standalone"; Access has no session for it, so it redirects every /api/ call to the login. */
async function expiredPhoneApp(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { get: () => true });
    localStorage.setItem('ptb:sync:v1', JSON.stringify({ state: { enabled: true }, version: 1 }));
  });
  const navigations: string[] = [];
  page.on('framenavigated', (f) => f === page.mainFrame() && navigations.push(f.url()));
  const hits: string[] = [];
  await page.route(/\/api\/(sync|shares|shared|profile|health)/, (route) => {
    hits.push(route.request().url());
    return route.fulfill({ status: 302, headers: { location: LOGIN } });
  });
  return { navigations, hits };
}

async function openSettings(page: Page) {
  await page.getByRole('navigation', { name: 'Main' }).locator('visible=true').getByRole('button').last().click();
  await page.getByRole('menuitem', { name: /Settings/ }).click();
  return page.getByRole('dialog', { name: 'Settings & credits' });
}

test('an Access redirect on the installed phone app says the session expired, keeps the app usable and never navigates to the login', async ({ page }) => {
  const { navigations, hits } = await expiredPhoneApp(page);
  await openApp(page);
  const banner = page.getByRole('alert').filter({ hasText: MESSAGE });
  await expect(banner).toBeVisible();
  expect(hits.length).toBeGreaterThan(0);

  // The app is still there and works: the builder, the menus and Saved teams.
  await expect(page.getByRole('button', { name: 'Team actions' })).toBeEnabled();
  await page.getByRole('button', { name: 'Team actions' }).click();
  await page.getByRole('menuitem', { name: 'Saved teams' }).click();
  await expect(page.getByRole('dialog', { name: 'Saved teams' })).toBeVisible();
  await page.keyboard.press('Escape');

  // The banner's button goes to Settings → Sync (no navigation), which says the same and offers the code.
  await expect(banner.getByRole('button', { name: 'Sign in again' })).toHaveCount(0);
  await banner.getByRole('button', { name: 'Open Settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings & credits' });
  await expect(settings.getByRole('alert').filter({ hasText: MESSAGE })).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Sign in again' })).toHaveCount(0);
  await expect(settings.getByText('Link this phone with a pairing code')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // Not once did the app leave its own page for the login.
  expect(navigations.filter((u) => u.includes('cloudflareaccess') || u.includes('/api/'))).toEqual([]);
  expect(new URL(page.url()).origin).toBe(new URL((await page.context().storageState()).origins[0].origin).origin);
});

test('linking the phone with a pairing code brings sync back without the Access cookie', async ({ page }) => {
  await expiredPhoneApp(page);
  const bearer: (string | undefined)[] = [];
  let redeemed: unknown;
  await page.route('**/api/device/redeem', (route) => {
    redeemed = route.request().postDataJSON();
    return route.fulfill({ json: { token: TOKEN, owner: 'me@example.com' } });
  });
  await page.route('**/api/device/shares', (route) => route.fulfill({ json: { me: { email: 'me@example.com' }, granted: [], received: [], names: {} } }));
  await page.route('**/api/device/shared', (route) => route.fulfill({ json: { docs: [], names: {} } }));
  await page.route('**/api/device/sync**', (route) => {
    const req = route.request();
    bearer.push(req.headers().authorization);
    return route.fulfill(req.method() === 'GET' ? { json: { docs: [], cursor: 0, more: false } } : { json: { results: [] } });
  });

  await openApp(page);
  await expect(page.getByRole('alert').filter({ hasText: MESSAGE })).toBeVisible();
  const settings = await openSettings(page);
  // The form is already open: the session expired, and the app says so.
  await settings.getByRole('textbox', { name: 'Pairing code' }).fill('abcde-fghjk');
  await settings.getByRole('button', { name: 'Link this phone' }).click();

  await expect(settings.getByRole('status').filter({ hasText: /Last synced/ })).toBeVisible();
  await expect(settings.getByText(/This phone is linked with a pairing code/)).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: MESSAGE })).toHaveCount(0);
  expect(redeemed).toMatchObject({ code: 'ABCDEFGHJK', name: expect.any(String) });
  expect(bearer.length).toBeGreaterThan(0);
  expect(bearer.every((b) => b === `Bearer ${TOKEN}`)).toBe(true);

  // The link survives a reload: the next launch syncs with the token, still without any cookie.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Team actions' })).toBeEnabled();
  await expect.poll(() => bearer.length).toBeGreaterThan(1);
  await expect(page.getByRole('alert').filter({ hasText: MESSAGE })).toHaveCount(0);
});

test.describe('the app shell without a network or a sign-in', () => {
  test.use({ serviceWorkers: 'allow' });

  test('opens from the service worker cache when the network is gone (what an expired Access session looks like to a navigation)', async ({ page, context }) => {
    await openApp(page);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    // Reload until the page is controlled by the worker (the first load installs it).
    await expect.poll(async () => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 30_000 }).toBe(true);
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeAttached();
    await expect(page.getByRole('button', { name: 'Team actions' })).toBeEnabled();
    await context.setOffline(false);
  });
});
