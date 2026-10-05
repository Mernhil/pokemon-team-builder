import { expect, test } from '@playwright/test';
import { SAMPLE_TEAM, importTeam, openApp } from './helpers';

test('Team overview: sets with stats, Megas and moves on one tab, the team as a whole on the other', async ({ page }) => {
  await openApp(page);
  await importTeam(page, SAMPLE_TEAM);
  await page.goto('/#showcase');

  // "Moves & More": a card per Pokémon with its ability, item and moves.
  const garchomp = page.getByRole('article', { name: 'Garchomp, moves' });
  await expect(garchomp).toBeVisible();
  await expect(garchomp.getByText('Garchompite')).toBeVisible();
  await expect(garchomp.getByRole('list', { name: 'Moves' })).toBeVisible();

  // "Stats": finished stats with their SP; Megas switch the numbers to the Mega forme.
  await page.getByRole('tab', { name: 'Stats' }).click();
  const stats = page.getByRole('article', { name: 'Garchomp, stats' });
  await expect(stats.getByRole('table')).toBeVisible();
  const before = await stats.getByRole('table').innerText();
  await page.getByLabel('Show Megas').check();
  const mega = page.getByRole('table', { name: /Finished stats of Garchomp-Mega/ });
  await expect(mega).toBeVisible();
  expect(await mega.innerText()).not.toBe(before); // the Mega's stats differ

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
  await expect(page).toHaveURL(/#analyse\/overview$/);
  await expect(page.getByRole('combobox', { name: 'Team to analyse' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Garchomp, moves' })).toBeVisible();
});
