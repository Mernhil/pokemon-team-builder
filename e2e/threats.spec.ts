import { expect, test } from '@playwright/test';
import { SAMPLE_TEAM, importTeam, openApp } from './helpers';

test('Threat report: Team check links to it, cells show both directions, a cell opens the Damage Calc', async ({ page }) => {
  await openApp(page);
  await importTeam(page, SAMPLE_TEAM);

  // Team check has a "Top threats" line with the worst few, and a link.
  await expect(page.getByText('Top threats', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: /Threat report/ }).click();
  await expect(page).toHaveURL(/#analyse\/threats$/);

  await expect(page.getByRole('status').filter({ hasText: /\d+ threats calculated against 2 of your Pokémon/ })).toBeVisible({ timeout: 30_000 });
  // The live regulation always has numbers of its own (Smogon's, or provisional ones), so no fallback.
  await expect(page.getByText(/No usage data for .* yet/)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Biggest threats' })).toBeVisible();

  // Cells carry the same story in words: your best move, its best move and who moves first.
  const cells = page.getByRole('button', { name: /(you move first|it moves first|speed tie)/ }).locator('visible=true');
  await expect(cells.first()).toBeVisible();
  expect(await cells.count()).toBeGreaterThanOrEqual(20);
  await expect(cells.first()).toContainText(/You: .*\n?.*It: /s);
  const before = await cells.first().getAttribute('aria-label');

  // The field changes everything at once.
  await page.getByRole('group', { name: 'Weather' }).getByRole('button', { name: 'Rain' }).click();
  await expect(page.getByRole('status').filter({ hasText: /threats calculated/ })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('group', { name: 'Battle' }).getByRole('button', { name: 'Trick Room' }).click();
  await expect(page.getByRole('status').filter({ hasText: /threats calculated/ })).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => cells.first().getAttribute('aria-label')).not.toBe(before);

  // Tapping a cell opens the Damage Calc pre-filled with that attacker, defender and field.
  await cells.first().click();
  await expect(page).toHaveURL(/#calc$/);
  await expect(page.getByRole('heading', { name: /Attacker from .* · slot \d/ })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Rain' })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Trick Room' })).toHaveAttribute('aria-pressed', 'true');
});

test('Threat report: the count selector and the non-Champions empty state', async ({ page }) => {
  await openApp(page);
  await importTeam(page, SAMPLE_TEAM);
  await page.goto('/#threats');
  await page.getByRole('combobox', { name: 'Threats shown' }).selectOption('10');
  await expect(page.getByRole('status').filter({ hasText: /10 threats calculated/ })).toBeVisible({ timeout: 30_000 });

  const gen9 = await page.getByRole('combobox', { name: 'Game and format' }).locator('option', { hasText: /^Gen 9/ }).getAttribute('value');
  await page.getByRole('combobox', { name: 'Game and format' }).selectOption(gen9!);
  await expect(page.getByText('The Threat report needs meta usage data, which only exists for Champions')).toBeVisible();
});

test('Threat report: still works without Web Workers (main-thread fallback)', async ({ page }) => {
  await page.addInitScript(() => {
    // @ts-expect-error simulate a browser with no Worker
    delete window.Worker;
  });
  await openApp(page);
  await importTeam(page, SAMPLE_TEAM);
  await page.goto('/#threats');
  await expect(page.getByRole('status').filter({ hasText: /\d+ threats calculated against 2 of your Pokémon/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: /(you move first|it moves first|speed tie)/ }).locator('visible=true').first()).toBeVisible();
});

test('OHKO reports: Team check links to both, each lists who can OHKO whom, a row opens the Damage Calc', async ({ page }) => {
  await openApp(page);
  await importTeam(page, SAMPLE_TEAM);

  await page.getByRole('link', { name: /OHKO’d by/ }).click();
  await expect(page).toHaveURL(/#analyse\/ohko\/by$/);
  await expect(page.getByRole('status').filter({ hasText: /\d+ Pokémon calculated against 2 of yours/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('list', { name: 'Can be OHKO’d by' }).getByRole('listitem').first()).toBeVisible();

  // The tabs switch between the two reports.
  await page.getByRole('tab', { name: 'Can OHKO' }).click();
  await expect(page).toHaveURL(/#analyse\/ohko\/to$/);
  await expect(page.getByRole('status').filter({ hasText: /\d+ Pokémon calculated against 2 of yours/ })).toBeVisible({ timeout: 30_000 });
  const rows = page.getByRole('button', { name: /Open in the Damage Calc/ }).locator('visible=true');
  if (await rows.count()) {
    await rows.first().click();
    await expect(page).toHaveURL(/#calc$/);
  }
});

test('Threat report: the table is one Tab stop and arrow keys move between its cells', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the table is the wide-screen layout');
  await openApp(page);
  await importTeam(page, SAMPLE_TEAM);
  await page.evaluate(() => { location.hash = '#analyse/threats'; });
  await expect(page.getByRole('status').filter({ hasText: /threats calculated/ })).toBeVisible({ timeout: 30_000 });
  const table = page.getByRole('table').first();
  const cells = table.locator('[data-cell]');
  // Only the active cell (and its two actions) are in the tab order.
  const stops = await table.locator('button[tabindex="0"]').count();
  expect(stops).toBeGreaterThanOrEqual(1);
  expect(stops).toBeLessThanOrEqual(3);
  await cells.first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(table.locator('[data-cell="0:1"]')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(table.locator('[data-cell="1:1"]')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(table.locator('[data-cell="1:0"]')).toBeFocused();
  await expect(table.locator('[data-cell="1:0"]')).toHaveAttribute('tabindex', '0');
});
