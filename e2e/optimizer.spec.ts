import { expect, test } from '@playwright/test';
import { importTeam, openApp, openStatCalculator } from './helpers';

const TEAM = 'Incineroar @ Sitrus Berry\nAbility: Intimidate\nAdamant Nature\n- Flare Blitz\n- Fake Out\n';
const spUsed = (page: import('@playwright/test').Page) => page.getByRole('meter', { name: 'SP used' });

test('Optimise: add goals, see ✓/✗ and the new spread, apply and undo', async ({ page }) => {
  await openApp(page);
  await importTeam(page, TEAM);
  await openStatCalculator(page);
  await expect(spUsed(page)).toHaveAttribute('aria-valuenow', '0');

  await page.getByRole('button', { name: 'Optimise', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Optimise spread' });
  await expect(dialog).toBeVisible();

  // Survive the most-used set's first attacking move.
  await dialog.getByRole('button', { name: 'Survive a move' }).click();
  await dialog.getByRole('button', { name: 'Add goal' }).click();
  // And outspeed a Speed number.
  await dialog.getByRole('button', { name: 'Outspeed' }).click();
  await dialog.getByRole('button', { name: 'Add goal' }).click();

  const results = dialog.getByRole('list', { name: 'Goal results' });
  await expect(results.getByRole('listitem')).toHaveCount(2);
  await expect(results.getByText(/^Survive /)).toBeVisible();
  await expect(results.getByText(/^Outspeed /)).toBeVisible();
  for (const li of await results.getByRole('listitem').all()) await expect(li.locator('[aria-label="Met"], [aria-label="Not met"]')).toHaveCount(1);
  await expect(dialog.getByText(/\d+\/66 SP used/)).toBeVisible();

  // Leftover points into Attack, then apply: the spread and meter change, and Undo restores them.
  await dialog.getByRole('combobox', { name: 'Leftover SP' }).selectOption('stat:atk');
  const newAtk = await dialog.getByRole('row', { name: /^Atk / }).getByRole('cell').nth(1).textContent();
  expect(Number(newAtk)).toBeGreaterThan(0);
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/Applied a spread of \d+ SP/)).toBeVisible();
  await openStatCalculator(page);
  await expect(page.getByRole('spinbutton', { name: 'Atk SP value' })).toHaveValue(newAtk!.trim());
  await expect(spUsed(page)).not.toHaveAttribute('aria-valuenow', '0');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(spUsed(page)).toHaveAttribute('aria-valuenow', '0');
});

test('Optimise: an unreachable goal says how short it falls', async ({ page }) => {
  await openApp(page);
  await importTeam(page, TEAM);
  await openStatCalculator(page);
  await page.getByRole('button', { name: 'Optimise', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Optimise spread' });
  await dialog.getByRole('button', { name: 'Outspeed' }).click();
  await dialog.getByRole('button', { name: 'Add goal' }).click();
  await dialog.getByRole('spinbutton', { name: 'Target Speed' }).fill('900');
  await expect(dialog.getByText(/short by \d+ Speed even at max investment/)).toBeVisible();
  await expect(dialog.getByLabel('Not met')).toBeVisible();
});

test('Speed tiers → Optimise… opens the builder with the Outspeed goal filled in', async ({ page }) => {
  await openApp(page);
  await importTeam(page, TEAM);
  await page.goto('/#speed');
  const ladder = page.getByRole('list', { name: 'Speed tiers' });
  await ladder.getByRole('button', { expanded: false }).first().click();
  await page.getByRole('button', { name: /^Optimise Incineroar to outspeed / }).click();
  const dialog = page.getByRole('dialog', { name: 'Optimise spread' });
  await expect(dialog.getByRole('list', { name: 'Goal results' }).getByText(/^Outspeed /)).toBeVisible();
});

test('Threat report → Survive this… opens the builder with the Survive goal filled in', async ({ page }) => {
  await openApp(page);
  await importTeam(page, TEAM);
  await page.goto('/#threats');
  await page.getByRole('status').filter({ hasText: /threats calculated/ }).waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: /^Optimise Incineroar to survive / }).locator('visible=true').first().click();
  const dialog = page.getByRole('dialog', { name: 'Optimise spread' });
  await expect(dialog.getByRole('list', { name: 'Goal results' }).getByText(/^Survive /)).toBeVisible();
});

test('Optimise works with EVs in a Gen 9 team', async ({ page }) => {
  await openApp(page);
  const gen9 = await page.getByRole('combobox', { name: 'Game and format' }).locator('option', { hasText: /^Gen 9/ }).getAttribute('value');
  await page.getByRole('combobox', { name: 'Game and format' }).selectOption(gen9!);
  await importTeam(page, 'Garchomp @ Life Orb\nAbility: Rough Skin\nLevel: 100\nJolly Nature\n- Earthquake\n- Dragon Claw\n');
  await openStatCalculator(page);
  await page.getByRole('button', { name: 'Optimise', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Optimise spread' });
  await dialog.getByRole('button', { name: 'Outspeed' }).click();
  await dialog.getByRole('combobox', { name: 'Pokémon from' }).selectOption('any');
  await dialog.getByRole('button', { name: 'Add goal' }).click();
  await expect(dialog.getByText(/\d+\/510 EVs used/)).toBeVisible();
  await expect(dialog.getByRole('list', { name: 'Goal results' }).getByRole('listitem')).toHaveCount(1);
});
