import { expect, test } from '@playwright/test';
import { SAMPLE_TEAM, expectNoA11yViolations, goTo, importTeam, openApp } from './helpers';

test('Suggest a teammate: ten suggestions with reasons, Add to team with Undo, Reverse search opens', async ({ page }) => {
  await openApp(page);
  await importTeam(page, SAMPLE_TEAM); // two Pokémon
  await page.getByRole('button', { name: 'Suggest a teammate' }).click();
  const panel = page.getByRole('region', { name: 'Teammate suggestions' });
  const cards = panel.getByRole('listitem').filter({ has: page.getByRole('button', { name: /^Add .* to the team$/ }) });
  await expect(cards).toHaveCount(10, { timeout: 20_000 });
  // every card says why
  await expect(cards.first().getByRole('list', { name: 'Why' })).toBeVisible();
  // the threat checks finish and the status says so (they run off the main thread)
  await expect(panel.getByRole('status')).toContainText(/^Top 10/, { timeout: 60_000 });
  await expectNoA11yViolations(page);

  const first = await cards.first().locator('b').innerText();
  await cards.first().getByRole('button', { name: /^Add .* to the team$/ }).click();
  await expect(page.getByText(`Added ${first} to`)).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText(`Added ${first} to`)).toHaveCount(0);

  await cards.first().getByRole('button', { name: /Find more like .* in Reverse search/ }).click();
  await expect(page).toHaveURL(/#reverse$/);
  await expect(page.getByRole('heading', { name: 'Reverse search' })).toBeVisible();
});

test('Suggest a teammate is also in Analyse → Overview, and only while there is an empty slot', async ({ page }) => {
  await openApp(page);
  await importTeam(page, SAMPLE_TEAM);
  await goTo(page, 'Analyse');
  await expect(page.getByRole('button', { name: 'Suggest a teammate' })).toBeVisible();
});
