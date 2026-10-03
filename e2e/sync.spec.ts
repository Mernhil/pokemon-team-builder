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
  await page.getByRole('navigation', { name: 'Main' }).locator('visible=true').getByRole('button', { name: /^More|^Match log|^Meta|^Speed tiers|^Threat report|^Regulation diff/ }).click();
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
  await expect(dialog.getByRole('status').filter({ hasText: /Last sync: .*1 received, 1 sent/ })).toBeVisible();
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
  await expect(dialog.getByRole('status').filter({ hasText: /Last sync: / })).toBeVisible();
  await page.keyboard.press('Escape');
  const gets: string[] = [];
  page.on('request', (r) => r.url().includes('/api/sync') && r.method() === 'GET' && gets.push(r.url()));
  await page.reload();
  await expect.poll(() => gets.length).toBeGreaterThan(0);
  const again = await openSettings(page);
  await expect(again.getByRole('checkbox', { name: 'Sync with my account' })).toBeChecked();
});
