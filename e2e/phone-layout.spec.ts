import { expect, test, type Page } from '@playwright/test';
import { SIX_TEAM, expectNoHorizontalOverflow, importTeam, openApp } from './helpers';

// Layout checks for the installed phone app: nothing may stick out of the screen (docs/UI.md). Phone project only.
test.beforeEach(({ isMobile }) => {
  test.skip(!isMobile, 'phone layout');
});

const LONG_NAME = 'A very long team name that keeps going and going for the overflow check';

/** The Share buttons only exist once sync is on; the fake server keeps the app quiet. */
async function syncOn(page: Page) {
  await page.addInitScript(() => localStorage.setItem('ptb:sync:v1', JSON.stringify({ state: { enabled: true }, version: 1 })));
  await page.route('**/api/shares', (route) => route.fulfill({ json: { me: { email: 'me@example.com' }, granted: [], received: [], names: {} } }));
  await page.route('**/api/shared', (route) => route.fulfill({ json: { docs: [], names: {} } }));
  await page.route('**/api/sync**', (route) => route.fulfill(route.request().method() === 'GET' ? { json: { docs: [], cursor: 0, more: false } } : { json: { results: [] } }));
}

async function teamActions(page: Page, item: string) {
  await page.getByRole('button', { name: 'Team actions' }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

async function openMore(page: Page, item: RegExp | string) {
  await page.getByRole('navigation', { name: 'Main' }).locator('visible=true').getByRole('button').last().click();
  await page.getByRole('menuitem', { name: item }).click();
}

/** A long-named team with two variations: the case that overflowed. */
async function longTeamWithVariations(page: Page) {
  await importTeam(page, SIX_TEAM);
  await teamActions(page, 'Saved teams');
  const dialog = page.getByRole('dialog', { name: 'Saved teams' });
  await dialog.getByRole('button', { name: /^Rename / }).first().click();
  await dialog.getByRole('textbox', { name: 'Saved team name' }).fill(LONG_NAME);
  await dialog.getByRole('textbox', { name: 'Saved team name' }).press('Enter');
  for (let i = 0; i < 2; i++) {
    await dialog.getByRole('button', { name: 'Add variation' }).first().click(); // closes the dialog
    await teamActions(page, 'Saved teams');
  }
  return dialog;
}

test('Saved teams: a long name, two variations and every action fit the screen, also while confirming a delete', async ({ page }) => {
  await syncOn(page);
  await openApp(page);
  const dialog = await longTeamWithVariations(page);
  await expect(dialog.getByRole('button', { name: new RegExp(`^Share ${LONG_NAME}`) })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // The primary action keeps a 44 pt target, on a row of its own.
  const edit = dialog.getByRole('button', { name: `Edit team ${LONG_NAME}`, exact: true });
  expect((await edit.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  // Confirming a delete adds buttons to the row: it wraps instead of widening the sheet.
  await dialog.getByRole('button', { name: `Delete ${LONG_NAME}`, exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Keep', exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await dialog.getByRole('button', { name: 'Keep', exact: true }).click();

  await dialog.getByRole('button', { name: /^Delete Variation/ }).first().click();
  await expect(dialog.getByRole('button', { name: 'Keep', exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('the dialogs and sheets behind the menus fit the screen', async ({ page }) => {
  await syncOn(page);
  await openApp(page);
  await longTeamWithVariations(page);
  await page.keyboard.press('Escape');

  // Share (from Saved teams)
  await teamActions(page, 'Saved teams');
  await page.getByRole('dialog', { name: 'Saved teams' }).getByRole('button', { name: /^Share / }).first().click();
  await expect(page.getByRole('dialog', { name: /^Share/ })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // Save team, Import / Export (every tab)
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Save team' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.keyboard.press('Escape');
  await teamActions(page, 'Import / Export');
  const io = page.getByRole('dialog', { name: /Import/ });
  for (const tab of await io.getByRole('tab').all()) {
    await tab.click();
    await expectNoHorizontalOverflow(page);
  }
  await page.keyboard.press('Escape');

  // Settings & credits (every tab), from the More menu
  await openMore(page, /Settings/);
  const settings = page.getByRole('dialog', { name: 'Settings & credits' });
  for (const tab of await settings.getByRole('tab').all()) {
    await tab.click();
    await expectNoHorizontalOverflow(page);
  }
  await page.keyboard.press('Escape');

  // Team overview
  await page.evaluate(() => { location.hash = '#analyse/overview'; });
  await expect(page.getByRole('combobox', { name: 'Team to analyse' })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // The destinations of the More menu
  for (const hash of ['#matches', '#meta', '#dex']) {
    await page.evaluate((h) => { location.hash = h; }, hash);
    await expect(page.locator('main')).toBeVisible();
    await page.waitForTimeout(800); // lazy views and their data settle
    await expectNoHorizontalOverflow(page);
  }
});
