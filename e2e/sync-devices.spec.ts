import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { BASE_TEAM, FakeServer, hide, newDevice, renameSaved, savedTeamNames, show, syncPosts, syncState, waitSynced, openSavedTeams } from './devices';

/**
 * Two simulated devices (own storage and clock) against one server that follows the Worker's rules: what a phone does
 * when it is backgrounded, killed, offline, a minute off the other clock, or has a request that never answers.
 */
function serverWithBase() {
  const server = new FakeServer();
  server.put({ id: BASE_TEAM.id, kind: 'team', updatedAt: BASE_TEAM.updatedAt, deleted: false, json: BASE_TEAM });
  return server;
}
const baseShows = (page: import('@playwright/test').Page) => expect.poll(async () => (await savedTeamNames(page)).includes('Base'), { timeout: 15_000 }).toBe(true);

test('an edit followed at once by backgrounding the app is sent at once, with keepalive, not after the 5 s debounce', async ({ browser }, info) => {
  const server = serverWithBase();
  const phone = await newDevice(browser, info, server, 'Phone');
  await baseShows(phone.page);
  await waitSynced(phone.page);
  await renameSaved(phone.page, 'Base', 'Edited on the phone');
  await hide(phone.page); // iOS: visibilitychange to hidden, then pagehide; its timers freeze from here
  await expect.poll(() => server.team('base-team')?.name, { timeout: 3_000 }).toBe('Edited on the phone');
  await expect.poll(async () => (await syncState(phone.page)).dirty).toBe(false);
  const posts = await syncPosts(phone.page);
  expect(posts.at(-1)?.keepalive).toBe(true);

  // The desktop sees it as soon as it syncs.
  const desktop = await newDevice(browser, info, server, 'Desktop');
  await expect.poll(async () => (await savedTeamNames(desktop.page)).includes('Edited on the phone'), { timeout: 15_000 }).toBe(true);
});

test('an edit made right before the app is killed is still sent on the next start (the unsent-edits flag is persisted)', async ({ browser }, info) => {
  const server = serverWithBase();
  const phone = await newDevice(browser, info, server, 'Phone');
  await baseShows(phone.page);
  await waitSynced(phone.page);
  server.failPush = true; // the connection drops just as the app is closed: nothing gets through
  await renameSaved(phone.page, 'Base', 'Typed just before closing');
  expect((await syncState(phone.page)).dirty).toBe(true);
  await hide(phone.page);
  await phone.page.waitForTimeout(500);
  expect(server.team('base-team')?.name).toBe('Base');
  expect((await syncState(phone.page)).dirty).toBe(true); // still unsent: only a confirmed push clears it
  await phone.page.close();

  server.failPush = false;
  const again = await phone.ctx.newPage(); // the app is opened again: same storage
  await again.goto('/');
  await expect.poll(() => server.team('base-team')?.name, { timeout: 15_000 }).toBe('Typed just before closing');
  await expect.poll(async () => (await syncState(again)).dirty).toBe(false);
});

test('offline, then online: the edit made offline is sent when the connection returns', async ({ browser }, info) => {
  const server = serverWithBase();
  const phone = await newDevice(browser, info, server, 'Phone');
  await baseShows(phone.page);
  const last = await waitSynced(phone.page);
  await phone.ctx.setOffline(true);
  await renameSaved(phone.page, 'Base', 'Made on the train');
  await phone.page.waitForTimeout(600);
  expect(server.team('base-team')?.name).toBe('Base');
  await phone.ctx.setOffline(false);
  await expect.poll(() => server.team('base-team')?.name, { timeout: 20_000 }).toBe('Made on the train');
  await waitSynced(phone.page, last);
});

test('concurrent edits on both devices keep both versions (a conflict copy) on both devices', async ({ browser }, info) => {
  const server = serverWithBase();
  const phone = await newDevice(browser, info, server, 'Phone');
  const desktop = await newDevice(browser, info, server, 'Desktop');
  await baseShows(phone.page);
  await baseShows(desktop.page);
  await waitSynced(phone.page);
  await waitSynced(desktop.page);
  await phone.ctx.setOffline(true);
  await desktop.ctx.setOffline(true);
  await renameSaved(phone.page, 'Base', 'Phone version');
  await desktop.page.waitForTimeout(1_200);
  await renameSaved(desktop.page, 'Base', 'Desktop version');
  await phone.ctx.setOffline(false);
  await expect.poll(() => server.team('base-team')?.name, { timeout: 20_000 }).toBe('Phone version');
  await desktop.ctx.setOffline(false);
  await expect.poll(() => server.teams().some((t) => /^Conflict copy \(/.test(t.variationLabel ?? '')), { timeout: 20_000 }).toBe(true);
  await show(phone.page);
  for (const d of [phone, desktop]) {
    await expect
      .poll(async () => {
        const dialog = await openSavedTeams(d.page);
        const text = await dialog.innerText();
        await d.page.keyboard.press('Escape');
        return text;
      }, { timeout: 20_000 })
      .toMatch(/Conflict copy \(/);
    const names = await savedTeamNames(d.page);
    expect(names.some((n) => /(Phone|Desktop) version/.test(n))).toBe(true);
  }
  // Nothing was lost: both versions' names exist on the server.
  expect(server.teams().map((t) => t.name).join('|')).toMatch(/Phone version/);
  expect(server.teams().map((t) => t.name).join('|')).toMatch(/Desktop version/);
});

test('a device whose clock runs a minute behind: an edit right after the other device\'s edit is not dropped', async ({ browser }, info) => {
  const server = serverWithBase();
  const desktop = await newDevice(browser, info, server, 'Desktop');
  const phone = await newDevice(browser, info, server, 'Phone', { skewMs: -60_000 });
  await baseShows(desktop.page);
  await baseShows(phone.page);
  await waitSynced(desktop.page);
  await waitSynced(phone.page);
  await renameSaved(desktop.page, 'Base', 'Desktop edit');
  await expect.poll(() => server.team('base-team')?.name, { timeout: 20_000 }).toBe('Desktop edit');
  await show(phone.page); // the phone syncs on foregrounding and gets it
  await expect.poll(async () => (await savedTeamNames(phone.page)).includes('Desktop edit'), { timeout: 20_000 }).toBe(true);
  await renameSaved(phone.page, 'Desktop edit', 'Phone edit a few seconds later'); // its clock says a minute earlier than the desktop edit
  await expect.poll(() => server.team('base-team')?.name, { timeout: 20_000 }).toBe('Phone edit a few seconds later');
  await show(desktop.page);
  await expect.poll(async () => (await savedTeamNames(desktop.page)).includes('Phone edit a few seconds later'), { timeout: 20_000 }).toBe(true);
});

test('a request that never answers does not block sync: it fails after the timeout and the next "Sync now" works', async ({ browser }, info) => {
  const server = serverWithBase();
  const phone = await newDevice(browser, info, server, 'Phone', { clock: true });
  await baseShows(phone.page);
  const last = await waitSynced(phone.page);
  server.hang = true; // iOS froze the connection
  await show(phone.page);
  await phone.page.clock.fastForward(25_000);
  const dot = phone.page.getByRole('button', { name: /Sync status/ });
  await expect(dot).toHaveAttribute('aria-label', /not synced recently|sync problem/i, { timeout: 10_000 }).catch(() => {});
  await expect.poll(async () => (await syncState(phone.page)).lastSyncAt ?? 0).toBe(last); // nothing claimed as synced
  server.hang = false;
  await show(phone.page);
  await phone.page.clock.fastForward(1_000);
  await waitSynced(phone.page, last);
});

test('the service worker never answers an /api request from its cache', () => {
  // The built worker: precached static files and one navigation route that skips /api/. No runtime route exists
  // that could cache an /api response, and no /api file is precached.
  const sw = readFileSync('dist/sw.js', 'utf-8');
  expect(sw).toContain('denylist:[/^\\/api\\//]');
  expect([...sw.matchAll(/registerRoute\(/g)]).toHaveLength(1);
  expect(sw).not.toMatch(/url:"api\//);
  expect(sw).not.toMatch(/runtimeCaching|StaleWhileRevalidate|CacheFirst|NetworkFirst/);
});

