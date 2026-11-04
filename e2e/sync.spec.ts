import { expect, test, type Page } from '@playwright/test';
import { openApp } from './helpers';

const REMOTE_TEAM = {
  id: 'remote-team-1',
  name: 'From my other device',
  formatId: 'champions-vgc-reg-mc',
  slots: [null, null, null, null, null, null],
  createdAt: 1_790_000_000_000,
  updatedAt: 1_790_000_000_000,
};

/** A fake /api/sync: serves the given documents on pull, accepts every push, and records what was pushed. */
async function fakeServer(page: Page, docs: unknown[] = [], status = 200) {
  const pushed: { id: string; kind: string; deleted: boolean }[] = [];
  // Sharing endpoints: nothing shared with this account.
  await page.route('**/api/shares', (route) => route.fulfill(status !== 200 ? { status, contentType: 'application/json', body: JSON.stringify({ error: 'nope' }) } : { json: { me: { email: 'me@example.com' }, granted: [], received: [], names: {} } }));
  await page.route('**/api/shared', (route) => route.fulfill({ json: { docs: [], names: {} } }));
  await page.route('**/api/sync**', async (route) => {
    const req = route.request();
    if (status !== 200) return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: 'nope' }) });
    if (req.method() === 'GET') {
      const url = new URL(req.url());
      const since = Number(url.searchParams.get('since'));
      return route.fulfill({ json: { docs: since === 0 ? docs : [], cursor: since === 0 ? docs.length : since, more: false } });
    }
    const body = req.postDataJSON() as { docs: { id: string; kind: string; deleted: boolean }[] };
    pushed.push(...body.docs);
    return route.fulfill({ json: { results: body.docs.map((d) => ({ id: d.id, kind: d.kind, status: 'applied' })) } });
  });
  return pushed;
}

async function openSettings(page: Page) {
  await page.getByRole('navigation', { name: 'Main' }).locator('visible=true').getByRole('button').last().click();
  await page.getByRole('menuitem', { name: /Settings/ }).click();
  return page.getByRole('dialog', { name: 'Settings & credits' });
}

test('Sync is off by default; turning it on pulls the account\'s teams, pushes ours and shows the result', async ({ page }) => {
  const calls: string[] = [];
  page.on('request', (r) => r.url().includes('/api/sync') && calls.push(r.method()));
  await openApp(page);
  const pushed = await fakeServer(page, [{ id: REMOTE_TEAM.id, kind: 'team', updatedAt: REMOTE_TEAM.updatedAt, deleted: false, json: REMOTE_TEAM, seq: 1 }]);
  const dialog = await openSettings(page);
  await expect(dialog.getByRole('checkbox', { name: 'Sync with my account' })).not.toBeChecked();
  expect(calls).toEqual([]); // nothing was sent before opting in

  await dialog.getByRole('checkbox', { name: 'Sync with my account' }).check();
  await expect(dialog.getByRole('status').filter({ hasText: /Last synced .*1 received, 1 sent/ })).toBeVisible();
  expect(pushed.some((d) => d.kind === 'team')).toBe(true);
  await expect(dialog.getByRole('textbox', { name: 'Device name' })).toHaveValue(/^Device /);

  // The pulled team is among the saved teams now.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Team actions' }).click();
  await page.getByRole('menuitem', { name: 'Saved teams' }).click();
  await expect(page.getByRole('dialog', { name: 'Saved teams' })).toContainText('From my other device');
});

test('Sync errors say what to do', async ({ page }) => {
  await openApp(page);
  await fakeServer(page, [], 501);
  const dialog = await openSettings(page);
  await dialog.getByRole('checkbox', { name: 'Sync with my account' }).check();
  await expect(dialog.getByRole('alert').filter({ hasText: /isn.t set up on this deployment/ })).toBeVisible();

  await page.unroute('**/api/sync**');
  await fakeServer(page, [], 401);
  await dialog.getByRole('button', { name: 'Sync now' }).click();
  await expect(dialog.getByRole('alert').filter({ hasText: /sign-in has expired/ })).toBeVisible();
});

test('Turning sync off keeps everything on the device and stops talking to the server', async ({ page }) => {
  await openApp(page);
  const pushed = await fakeServer(page, [{ id: REMOTE_TEAM.id, kind: 'team', updatedAt: REMOTE_TEAM.updatedAt, deleted: false, json: REMOTE_TEAM, seq: 1 }]);
  const dialog = await openSettings(page);
  await dialog.getByRole('checkbox', { name: 'Sync with my account' }).check();
  await expect(dialog.getByRole('status').filter({ hasText: /1 received/ })).toBeVisible();

  const before = pushed.length;
  await dialog.getByRole('checkbox', { name: 'Sync with my account' }).click(); // asks first
  await expect(dialog.getByRole('alert').filter({ hasText: /keeps everything on this device/ })).toBeVisible();
  await dialog.getByRole('button', { name: 'Turn sync off' }).click();
  await expect(dialog.getByRole('checkbox', { name: 'Sync with my account' })).not.toBeChecked();
  await expect(dialog.getByRole('button', { name: 'Sync now' })).toHaveCount(0);

  await page.keyboard.press('Escape');
  await page.reload();
  await page.getByRole('button', { name: 'Team actions' }).click();
  await page.getByRole('menuitem', { name: 'Saved teams' }).click();
  await expect(page.getByRole('dialog', { name: 'Saved teams' })).toContainText('From my other device');
  expect(pushed.length).toBe(before);
});

test('Sync is remembered across a reload and syncs again on start', async ({ page }) => {
  await openApp(page);
  await fakeServer(page);
  const dialog = await openSettings(page);
  await dialog.getByRole('checkbox', { name: 'Sync with my account' }).check();
  await expect(dialog.getByRole('status').filter({ hasText: /Last synced / })).toBeVisible();
  await page.keyboard.press('Escape');
  const gets: string[] = [];
  page.on('request', (r) => r.url().includes('/api/sync') && r.method() === 'GET' && gets.push(r.url()));
  await page.reload();
  await expect.poll(() => gets.length).toBeGreaterThan(0);
  const again = await openSettings(page);
  await expect(again.getByRole('checkbox', { name: 'Sync with my account' })).toBeChecked();
});

test('The phone/web app makes a pairing code and lists and unlinks desktop apps', async ({ page }) => {
  await openApp(page);
  await fakeServer(page);
  let devices = [{ id: 'dev1', name: 'My laptop', createdAt: 1_790_000_000_000, lastSeenAt: 1_790_000_000_000 }];
  await page.route('**/api/pair', (route) => route.fulfill({ json: { code: 'ABCDEFGHJK', expiresAt: Date.now() + 600_000 } }));
  await page.route('**/api/devices', (route) => {
    if (route.request().method() === 'DELETE') devices = [];
    return route.fulfill({ json: { devices } });
  });
  const dialog = await openSettings(page);
  await dialog.getByRole('checkbox', { name: 'Sync with my account' }).check();
  await expect(dialog.getByText('My laptop')).toBeVisible();
  await dialog.getByRole('button', { name: 'Make a pairing code' }).click();
  await expect(dialog.getByText('ABCDE-FGHJK')).toBeVisible();
  await dialog.getByRole('button', { name: 'Unlink My laptop' }).click();
  await expect(dialog.getByText('My laptop')).toHaveCount(0);
});

test('The desktop app links with a pasted pairing link, then syncs with its token', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  });
  const server = 'https://ptb.example.workers.dev';
  let redeemed: unknown;
  let auth: string | undefined;
  await page.route(`${server}/api/device/redeem`, (route) => {
    redeemed = route.request().postDataJSON();
    return route.fulfill({ json: { token: `ptbd_${'A'.repeat(43)}`, owner: 'me@example.com' }, headers: { 'access-control-allow-origin': '*' } });
  });
  await page.route(`${server}/api/device/shares`, (route) => route.fulfill({ json: { me: { email: 'me@example.com' }, granted: [], received: [], names: {} }, headers: { 'access-control-allow-origin': '*' } }));
  await page.route(`${server}/api/device/shared`, (route) => route.fulfill({ json: { docs: [], names: {} }, headers: { 'access-control-allow-origin': '*' } }));
  await page.route(`${server}/api/device/sync**`, (route) => {
    auth = route.request().headers().authorization;
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
    return route.fulfill({ json: route.request().method() === 'GET' ? { docs: [], cursor: 0, more: false } : { results: [] }, headers: { 'access-control-allow-origin': '*' } });
  });
  await openApp(page);
  const dialog = await openSettings(page);
  await expect(dialog.getByRole('checkbox', { name: 'Sync with my account' })).toHaveCount(0); // not linked yet
  await dialog.getByRole('textbox', { name: 'Pairing code' }).fill(`${server}/#pair=abcde-fghjk`);
  await expect(dialog.getByRole('textbox', { name: 'Server address' })).toHaveValue(server);
  await dialog.getByRole('button', { name: 'Link this desktop app' }).click();
  await expect(dialog.getByText('Unlink this desktop app')).toBeVisible();
  expect(redeemed).toMatchObject({ code: 'ABCDE-FGHJK'.replace('-', '') });
  await expect(dialog.getByRole('status').filter({ hasText: /Last synced/ })).toBeVisible();
  expect(auth).toBe(`Bearer ptbd_${'A'.repeat(43)}`);
});

test('An expired sign-in shows a banner at the top with Sign in again, and the header light turns red', async ({ page }) => {
  await openApp(page);
  await fakeServer(page, [], 200);
  const dialog = await openSettings(page);
  await dialog.getByRole('checkbox', { name: 'Sync with my account' }).check();
  await expect(dialog.getByRole('status').filter({ hasText: /Last synced/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /Sync status: synced recently/i })).toBeVisible();

  await page.unroute('**/api/sync**');
  await fakeServer(page, [], 401);
  // "Sign in again" is a full navigation to the renewal route, which Access answers with its login.
  await page.route('**/api/session/renew', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>renewed</title>' }));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const banner = page.getByRole('alert').filter({ hasText: 'Your sign-in has expired. Tap Sign in again.' });
  await expect(banner).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sync status: sync problem' })).toBeVisible();

  await banner.getByRole('button', { name: 'Dismiss' }).click();
  await expect(banner).toBeHidden();

  await page.getByRole('button', { name: 'Sync status: sync problem' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings & credits' });
  await expect(settings.getByRole('button', { name: 'Sign in again' })).toBeVisible();
  await Promise.all([page.waitForURL('**/api/session/renew'), settings.getByRole('button', { name: 'Sign in again' }).click()]);
});

test('Sync diagnostics and the server line in Settings → Sync', async ({ page }) => {
  await openApp(page);
  await fakeServer(page, [], 200);
  await page.route('**/api/health', (route) => route.fulfill({ json: { database: true, migrations: ['0001_init', '0002_shares', '0003_devices'], missing: ['0004_redeem_attempts'], access: { teamDomain: true, audience: true }, time: 1 } }));
  const dialog = await openSettings(page);
  await dialog.getByRole('checkbox', { name: 'Sync with my account' }).check();
  await expect(dialog.getByTestId('server-health')).toHaveText('Database migration missing: 0004');
  await dialog.getByText('Sync diagnostics').click();
  await expect(dialog.getByText('Known documents')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Copy diagnostics' })).toBeVisible();
});
