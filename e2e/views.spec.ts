import { expect, test } from '@playwright/test';
import { openApp, setTheme } from './helpers';

test('Meta tab lists the most used Pokémon with where the numbers come from', async ({ page }) => {
  await openApp(page, '#meta');
  // Reg M-C is live but has no published usage yet; the previous regulation does.
  await page.getByRole('combobox', { name: 'Regulation' }).selectOption({ label: 'Champions · Reg M-B' });
  const list = page.getByRole('list', { name: /Most used Pokémon in Reg M-B/ });
  await expect(list.getByRole('listitem').first()).toBeVisible();
  await expect(list.getByRole('heading', { level: 2 }).first()).toContainText('Kingambit');
  // Source, month, sample size and when the app's copy was last updated.
  await expect(page.getByRole('link', { name: /Smogon usage statistics/ })).toBeVisible();
  await expect(page.getByText(/rating \d+\+ · [\d,]+ battles · updated /)).toBeVisible();
});

test('Match log: log a match with a result and two opponent Pokémon', async ({ page }) => {
  await openApp(page, '#matches');
  await page.getByRole('button', { name: 'Log your first match' }).click();
  await page.getByRole('combobox', { name: 'Result' }).selectOption({ label: 'Loss' });

  for (const species of ['Kingambit', 'Sneasler']) {
    await page.getByRole('button', { name: 'Add Pokémon' }).last().click();
    const emptyPhone = page.getByRole('button', { name: /^Species: Species seen at Team Preview/ });
    if (await emptyPhone.isVisible()) {
      await emptyPhone.click();
      await page.getByRole('dialog').getByRole('combobox', { name: 'Search Species' }).fill(species);
    } else {
      await page.getByPlaceholder(/Species seen at Team Preview/).fill(species);
    }
    await page.getByRole('listbox', { name: 'Species', exact: true }).getByRole('option').first().click();
  }

  await expect(page.getByRole('heading', { name: 'Overall: 0-1 (0%)' })).toBeVisible();
  const snapshot = page.getByText('Most-seen opponent species').locator('xpath=following-sibling::*[1]');
  await expect(snapshot).toContainText('Kingambit');
  await expect(snapshot).toContainText('Sneasler');
  await expect(page.getByRole('heading', { name: 'Losses (1)' })).toBeVisible();
});

test('Pokédex opens an entry and its Area tab', async ({ page }) => {
  await openApp(page, '#dex');
  await page.getByRole('button', { name: /Kanto/ }).click();
  await page.getByRole('listbox', { name: 'Pokémon' }).getByRole('option', { name: /Pikachu/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Pikachu', level: 2 })).toBeVisible();
  await page.getByRole('button', { name: 'Area', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Where to find Pikachu' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Region map' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Viridian Forest/ })).toBeVisible();
});

test('Pokénav: open Platinum, click a place on the map, the location panel opens', async ({ page }) => {
  await openApp(page, '#atlas');
  await page.getByRole('radio', { name: 'Pokémon Platinum' }).check();
  await expect(page.getByRole('tab', { name: 'Map' })).toHaveAttribute('aria-selected', 'true');
  // The place markers sit under the map image, which takes the real pointer events: force the click
  // onto the marker's position and let the map's own hit-testing pick the place.
  await page.getByRole('group', { name: /Sinnoh map/ }).getByRole('button', { name: 'Route 201', exact: true }).click({ force: true });
  // A side panel on desktop, a sheet on phones.
  const panel = page.getByRole('complementary', { name: 'Location details' }).or(page.getByRole('dialog', { name: 'Route 201' }));
  await expect(panel.getByRole('heading', { name: 'Route 201', level: 2 }).first()).toBeVisible();
  await expect(panel.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
});

test('theme toggle switches between light and dark', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('html')).toHaveClass(/dark/);
  await setTheme(page, 'light');
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await setTheme(page, 'dark');
  await expect(page.locator('html')).toHaveClass(/dark/);
});
