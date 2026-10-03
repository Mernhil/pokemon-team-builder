import { expect, test } from '@playwright/test';
import { importTeam, openApp } from './helpers';

test('Regulation diff: what changed between two regulations, before → after, and the unconfirmed ones', async ({ page }) => {
  await openApp(page);
  await page.getByRole('link', { name: 'Regulation diff' }).click();
  await expect(page).toHaveURL(/#regdiff$/);

  // Live is M-C and it defaults to the one before it.
  await expect(page.getByRole('combobox', { name: 'From regulation' })).toHaveValue('champions-reg-mb');
  await expect(page.getByRole('combobox', { name: 'To regulation' })).toHaveValue('champions-reg-mc');
  await expect(page.getByRole('status').filter({ hasText: /Reg M-B → Reg M-C: \d+ changes/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pokémon', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Items' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Moves' })).toBeVisible();

  const patches = page.getByRole('table', { name: /Species changes between Reg M-B and Reg M-C/ });
  const row = patches.getByRole('row').filter({ hasText: 'Garchomp-Mega-Z' });
  await expect(row).toContainText('Sand Force');
  await expect(row).toContainText('Levitate');

  // Listed by one source only: shown, labelled, not counted as added.
  const unconfirmed = page.getByRole('status').filter({ hasText: 'Unconfirmed for Reg M-C' });
  await expect(unconfirmed).toContainText('single source');
  await expect(unconfirmed.getByText('Unconfirmed', { exact: true }).first()).toBeVisible();

  // Swapping reads the other way: what was added becomes what was removed, before and after swap.
  await page.getByRole('button', { name: 'Swap the two regulations' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Reg M-C → Reg M-B/ })).toBeVisible();
  await expect(page.getByText(/^− Removed \(\d+\)/).first()).toBeVisible();
  const swapped = page.getByRole('table', { name: /Species changes between Reg M-C and Reg M-B/ });
  await expect(swapped.getByRole('row').filter({ hasText: 'Garchomp-Mega-Z' })).toContainText(/Levitate.*Sand Force/);
  await expect(page.getByText('Unconfirmed for Reg M-C')).toHaveCount(0);
});

test('Banner: a team in an older regulation shows what moving to the live one does, and Copy makes a variation', async ({ page }) => {
  await openApp(page);
  const regB = await page.getByRole('combobox', { name: 'Game and format' }).locator('option', { hasText: 'Reg M-B' }).getAttribute('value');
  await page.getByRole('combobox', { name: 'Game and format' }).selectOption(regB!);
  await importTeam(page, 'Garchomp @ Garchompite\nAbility: Rough Skin\nJolly Nature\n- Earthquake\n- Protect\n');
  await expect(page.getByText('Not live').or(page.getByRole('button', { name: /Copy to Reg M-C/ }))).toBeVisible();

  await page.getByRole('button', { name: /What changes in Reg M-C/ }).click();
  const region = page.getByRole('region', { name: /What Reg M-C does to this team/ });
  await expect(region).toContainText('Moving to Reg M-C');
  await expect(region.getByText('New:').first()).toBeVisible();
  await expect(region).toContainText('Garchomp can now Mega Evolve into Garchomp-Mega-Z');

  const teamName = await page.getByRole('textbox', { name: 'Team name' }).locator('visible=true').first().inputValue();
  await page.getByRole('button', { name: /Copy to Reg M-C/ }).click();
  await expect(page.getByText(/as a variation. The original is unchanged/)).toBeVisible();
  // The copy is the active team now, in the live regulation; the original is still there, in M-B, as the folder.
  await expect(page.getByRole('combobox', { name: 'Game and format' })).toHaveValue(/reg-mc/);
  await page.getByRole('button', { name: 'Team actions' }).click();
  await page.getByRole('menuitem', { name: 'Saved teams' }).click();
  const dialog = page.getByRole('dialog', { name: 'Saved teams' });
  await expect(dialog).toContainText(teamName);
  await expect(dialog.getByText('Not live: Reg M-B').first()).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Rename Reg M-C' })).toBeVisible();
});

test('Banner: the live regulation counts down to its end', async ({ page }) => {
  await openApp(page);
  // Reg M-C is live; its end date counts down in the banner. A next regulation with a start date counts down the same way
  // ("in N days"), but none is announced yet, so only the live one is visible here.
  await expect(page.getByText(/Reg M-C is live/)).toBeVisible();
  await expect(page.getByText(/\d+ days left/)).toBeVisible();
});
