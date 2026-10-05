import { expect, test, type Page } from '@playwright/test';
import { openApp, pickOption } from './helpers';

const checked = (page: Page) => page.getByRole('status').filter({ hasText: /Checked \d+ Pokémon/ });
const count = async (page: Page) => Number((await page.getByRole('heading', { name: / match(es)?$/ }).innerText()).split(' ')[0]);

async function addCondition(page: Page, kind: string, species: string) {
  await page.getByRole('combobox', { name: 'Condition type' }).selectOption({ label: kind });
  await pickOption(page, 'Species', species);
}

test('Reverse search: every condition has to hold, and a match can be added to the team', async ({ page }) => {
  await openApp(page, '#reverse');
  await expect(page.getByText('Nothing to search for yet')).toBeVisible();

  await addCondition(page, 'One-shots', 'Rillaboom');
  await expect(checked(page)).toBeVisible({ timeout: 30_000 });
  const one = await count(page);
  expect(one).toBeGreaterThan(0);
  await expect(page.getByRole('list').getByText('One-shots Rillaboom').first()).toBeVisible();

  await addCondition(page, 'Survives', 'Incineroar');
  await expect(page.getByRole('heading', { name: / match(es)?$/ })).toBeVisible();
  await expect(checked(page)).toBeVisible({ timeout: 30_000 });
  const two = await count(page);
  expect(two).toBeLessThanOrEqual(one);

  await addCondition(page, 'Resists', 'Garchomp');
  await expect(checked(page)).toBeVisible({ timeout: 30_000 });
  expect(await count(page)).toBeLessThanOrEqual(two);

  // Removing a condition widens the answer again.
  await page.getByRole('button', { name: /^Remove: Resists Garchomp/ }).click();
  await expect(checked(page)).toBeVisible({ timeout: 30_000 });
  expect(await count(page)).toBe(two);

  if (two > 0) {
    await page.getByRole('button', { name: /^Add .* to team$/ }).first().click();
    await expect(page.getByText(/^Added .* to /)).toBeVisible();
  }
});

test('Reverse search: a required move narrows the answers to Pokémon that know it, with the other conditions', async ({ page }) => {
  await openApp(page, '#reverse');
  await addCondition(page, 'One-shots', 'Sylveon');
  await expect(checked(page)).toBeVisible({ timeout: 30_000 });
  const any = await count(page);

  // "A Fake Out user that one-shots Sylveon".
  await pickOption(page, 'Add a required move', 'Fake Out');
  await expect(page.getByRole('list', { name: 'Required moves' }).getByText('Fake Out')).toBeVisible();
  await expect(checked(page)).toBeVisible({ timeout: 30_000 });
  const withFakeOut = await count(page);
  expect(withFakeOut).toBeGreaterThan(0);
  expect(withFakeOut).toBeLessThan(any);
  // Every answer says it knows the move.
  const cards = page.getByRole('list').filter({ hasText: 'Knows Fake Out' });
  await expect(cards.first()).toBeVisible();

  // Removing the move widens the search again.
  await page.getByRole('button', { name: 'Remove Fake Out' }).click();
  await expect(checked(page)).toBeVisible({ timeout: 30_000 });
  expect(await count(page)).toBe(any);

  // A move on its own works too: everything that can learn it.
  await page.getByRole('button', { name: /^Remove: One-shots Sylveon/ }).click();
  await pickOption(page, 'Add a required move', 'Fake Out');
  await expect(checked(page)).toBeVisible({ timeout: 30_000 });
  expect(await count(page)).toBeGreaterThan(withFakeOut);
});
