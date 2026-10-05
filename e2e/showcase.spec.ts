import { expect, test } from '@playwright/test';
import { SAMPLE_TEAM, importTeam, openApp } from './helpers';

test('Team overview: sets with stats, Megas and moves on one tab, the team as a whole on the other', async ({ page }) => {
  await openApp(page);
  await importTeam(page, SAMPLE_TEAM);
  await page.goto('/#showcase');

  // One card per Pokémon, with its moves and finished stats; Mega Stone holders show their Mega.
  const garchomp = page.getByRole('article', { name: 'Garchomp' });
  await expect(garchomp).toBeVisible();
  await expect(garchomp.getByText('Garchompite')).toBeVisible();
  await expect(garchomp.getByRole('list', { name: 'Moves' })).toBeVisible();
  await expect(garchomp.getByRole('table')).toBeVisible();
  await expect(garchomp.getByText('Mega').first()).toBeVisible();

  // The Team tab: speed order and the two type matrices.
  await page.getByRole('tab', { name: 'Team' }).click();
  await expect(page.getByRole('list', { name: 'Speed, fastest first' })).toBeVisible();
  await expect(page.getByText('Defensive type matrix')).toBeVisible();
  await expect(page.getByText('Offensive type matrix')).toBeVisible();
});

test('Team overview: Saved teams opens it on the chosen team', async ({ page }) => {
  await openApp(page);
  await importTeam(page, SAMPLE_TEAM);
  await page.getByRole('button', { name: 'Team actions' }).click();
  await page.getByRole('menuitem', { name: 'Saved teams' }).click();
  await page.getByRole('button', { name: /^Overview of / }).first().click();
  await expect(page).toHaveURL(/#showcase$/);
  await expect(page.getByRole('combobox', { name: 'Team to show' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Garchomp' })).toBeVisible();
});
