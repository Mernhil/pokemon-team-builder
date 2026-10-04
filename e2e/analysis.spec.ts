import { expect, test } from '@playwright/test';
import { FIRE_TEAM, SAMPLE_TEAM, importTeam, openApp } from './helpers';

test('Team check shows both type matrices and suggestions for a weak team', async ({ page }) => {
  await openApp(page);
  await importTeam(page, FIRE_TEAM);

  await expect(page.getByRole('heading', { name: 'Defensive type matrix' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Offensive type matrix' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Team check', exact: true })).toBeVisible();
  // Three Fire types leave danger rows, which come with suggestions (a count, then the chips).
  await expect(page.getByText(/\d+ suggestions?/).first()).toBeAttached();
});

test('Damage Calc loads the team and shows a range and KO text for every move', async ({ page }) => {
  await openApp(page);
  await importTeam(page, SAMPLE_TEAM);
  await page.getByRole('navigation', { name: 'Main' }).locator('visible=true').getByRole('button', { name: 'Calc', exact: true }).click();

  await page.getByRole('button', { name: 'Garchomp sprite' }).first().click();
  await page.getByRole('button', { name: 'Incineroar sprite' }).last().click();

  const results = page.getByRole('list').filter({ hasText: 'Earthquake' }).first();
  const row = (move: string) => results.getByRole('listitem').filter({ hasText: move }).first();
  for (const move of ['Earthquake', 'Dragon Claw']) {
    await expect(row(move)).toContainText(/\d+(\.\d+)?–\d+(\.\d+)?%/);
    await expect(row(move)).toContainText(/(guaranteed|possible|chance to) [OHKO\d]+|\dHKO/);
  }
  const defender = page.getByRole('list').filter({ hasText: 'Flare Blitz' }).first();
  await expect(defender.getByRole('listitem').filter({ hasText: 'Flare Blitz' })).toContainText(/\d+(\.\d+)?–\d+(\.\d+)?%/);

  // A Mega Stone holder gets the Base / Mega / Both control.
  const forme = page.getByRole('radiogroup', { name: 'Forme' });
  await expect(forme.getByRole('radio', { name: 'Base' })).toBeVisible();
  await expect(forme.getByRole('radio', { name: 'Mega' })).toBeVisible();
  await expect(forme.getByRole('radio', { name: 'Both' })).toBeVisible();
});

test('The defensive matrix says "immune" for a Pokémon that takes no damage (Aegislash vs Fighting)', async ({ page }) => {
  await openApp(page);
  await importTeam(page, "Aegislash @ Spooky Plate\nAbility: Stance Change\nModest Nature\n- Shadow Ball\n- Flash Cannon\n- King's Shield\n- Shadow Sneak\n");

  // Steel's weakness to Fighting is cancelled by Ghost: it must not count as weak, and must be called out as immune.
  const fighting = page.locator('[title^="Aegislash: immune (×0)"]').filter({ hasText: 'FIGH' });
  await expect(fighting).toBeVisible();
  await expect(fighting.getByLabel('0 weak')).toBeVisible();
  await expect(fighting.getByLabel('1 immune')).toBeVisible();
  await expect(fighting.getByLabel('0 resist')).toBeVisible();
  // A real weakness still counts.
  const ground = page.locator('[title^="Aegislash: ×2"]').filter({ hasText: 'GROU' });
  await expect(ground.getByLabel('1 weak')).toBeVisible();
  await expect(page.getByText('immune (no effect)').first()).toBeVisible();
});
