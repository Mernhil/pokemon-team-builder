import { expect, test, type Page } from '@playwright/test';
import { openApp } from './helpers';
import { expectNoOverflow, LONG_NAME, seedRealistic } from './overflow';

/**
 * No element may stick out of its card or the viewport on a phone (docs/UI.md, "No overflow on phones").
 * Realistic data: three variations, a very long team name, several chips, sync on with a long device name,
 * a team shared with me, a share with a long e-mail address, a long match log and a started run.
 */
test.beforeEach(({ browserName }, info) => {
  void browserName;
  test.skip(info.project.name !== 'iphone', 'phone widths only');
});

const WIDTHS = [320, 390, 430];

async function openSaved(page: Page) {
  await page.getByRole('button', { name: 'Team actions' }).click();
  await page.getByRole('menuitem', { name: 'Saved teams' }).click();
  const dialog = page.getByRole('dialog', { name: 'Saved teams' });
  await expect(dialog.getByText('Shared with me')).toBeVisible();
  return dialog;
}

async function openSettings(page: Page) {
  await page.getByRole('navigation', { name: 'Main' }).locator('visible=true').getByRole('button').last().click();
  await page.getByRole('menuitem', { name: /Settings/ }).click();
  return page.getByRole('dialog', { name: 'Settings & credits' });
}

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await seedRealistic(page);
    });

    for (const hash of ['#builder', '#calc', '#analyse/overview', '#analyse/speed', '#analyse/threats', '#analyse/compare', '#dex', '#atlas', '#matches', '#gameday', '#meta', '#reverse', '#regdiff']) {
      test(`${hash} stays inside its cards and the screen`, async ({ page }) => {
        await openApp(page, hash);
        await page.waitForTimeout(600);
        await expectNoOverflow(page, hash);
      });
    }

    test('Saved teams: every card, variation row and the shared folder', async ({ page }) => {
      await openApp(page);
      const dialog = await openSaved(page);
      await expectNoOverflow(page, 'Saved teams');
      // Delete asks first, inline: the question and its two buttons must fit too.
      await dialog.getByRole('button', { name: `Delete ${LONG_NAME.slice(0, 100)}`, exact: true }).click();
      await expect(dialog.getByRole('button', { name: 'Keep' }).first()).toBeVisible();
      await expectNoOverflow(page, 'Saved teams, delete confirmation');
      await dialog.getByRole('button', { name: 'Keep' }).first().click();
      // The delete icon of a variation row.
      await dialog.getByRole('button', { name: 'Delete Variation 3' }).click();
      await expectNoOverflow(page, 'Saved teams, variation delete confirmation');
    });

    test('Saved teams: the share dialog with a long address', async ({ page }) => {
      await openApp(page);
      const dialog = await openSaved(page);
      await dialog.getByRole('button', { name: /^Share My very long/ }).click();
      await expect(page.getByRole('dialog', { name: /Share/ }).last()).toBeVisible();
      await page.waitForTimeout(300);
      await expectNoOverflow(page, 'Share dialog');
    });

    test('Settings → Sync and Sharing', async ({ page }) => {
      await openApp(page);
      const dialog = await openSettings(page);
      await expect(dialog.getByRole('checkbox', { name: 'Sync with my account' })).toBeChecked();
      await expect(dialog.getByTestId('server-health')).toBeVisible();
      await dialog.getByText('Sync diagnostics').click();
      await page.waitForTimeout(300);
      await expectNoOverflow(page, 'Settings → Sync');
    });

    test('Match log rows', async ({ page }) => {
      await openApp(page, '#matches');
      await expect(page.getByText('Regional Championship Top Cut Round 3').first()).toBeVisible();
      await expectNoOverflow(page, 'Match log');
    });

    test('Run tracker', async ({ page }) => {
      await openApp(page, '#atlas');
      await page.getByRole('tab', { name: 'Run', exact: true }).click();
      await page.getByRole('textbox', { name: 'Run name' }).fill('My Nuzlocke run with a really long name that goes on and on');
      await page.getByRole('button', { name: 'Start run' }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Next cap' })).toBeVisible();
      await expectNoOverflow(page, 'Run');
      for (const tab of ['Encounters', 'Party', 'Next boss']) {
        await page.getByRole('tab', { name: tab, exact: true }).click();
        await expectNoOverflow(page, `Run → ${tab}`);
      }
    });

    test('Banners: sign-in expired, and the sync problem chip', async ({ page }) => {
      await seedRealistic(page, { signedOut: true });
      await openApp(page);
      await expect(page.getByRole('alert').filter({ hasText: 'Your sign-in has expired' })).toBeVisible();
      await expectNoOverflow(page, 'Sign-in banner');
    });
  });
}
