import { expect, test } from '@playwright/test';
import { FIRE_TEAM, SIX_TEAM, importTeam, openApp, renameTeam } from './helpers';

const OPPONENT = `Sneasler @ Focus Sash
Ability: Poison Touch
Jolly Nature
- Close Combat
- Dire Claw
- Fake Out
- Protect

Basculegion @ Choice Scarf
Ability: Swift Swim
Adamant Nature
- Wave Crash
- Last Respects
- Aqua Jet
- Protect

Charizard @ Charizardite Y
Ability: Blaze
Timid Nature
- Heat Wave
- Air Slash
- Solar Beam
- Protect
`;

test('Plan vs this team from a logged match: three plans, then Use this plan fills in what I brought and led', async ({ page }) => {
  await openApp(page);
  await importTeam(page, SIX_TEAM);
  await page.goto('/#matches');
  await page.getByRole('button', { name: 'Log your first match' }).click();
  await page.getByRole('button', { name: 'Saved team', exact: true }).click();
  await page.getByRole('combobox').filter({ hasText: 'pick a saved team' }).selectOption({ index: 1 });

  // Opponent: a pasted Showdown team (full sets), then plan.
  await page.getByRole('button', { name: 'Plan vs this team' }).click();
  await page.getByRole('textbox', { name: 'Their team as Showdown text' }).fill(OPPONENT);
  await page.getByRole('button', { name: 'Load pasted team' }).click();
  await expect(page.getByText('Loaded 3 Pokémon.')).toBeVisible();

  await expect(page.getByRole('heading', { name: 'Plan 1' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Plan 3' })).toBeVisible();
  await expect(page.getByText('A suggestion, not a prediction')).toBeVisible();
  await expect(page.getByText(/Lead .* \+ /).first()).toBeVisible();
  await expect(page.getByText('Main risk:').first()).toBeVisible();

  await page.getByRole('button', { name: 'Use plan 1' }).click();
  await expect(page.getByText('Saved what you bring and lead onto this match.')).toBeVisible();
  await expect(page.getByText('Brought 4/4 · Lead 2/2').first()).toBeVisible();
  await expect(page.getByRole('list', { name: 'I brought' }).getByRole('button', { name: /lead\./ })).toHaveCount(2);
});

test('Plan vs this team in the Matchup tab uses the enemy team as built and saves a new match', async ({ page }) => {
  await openApp(page);
  await importTeam(page, SIX_TEAM);
  await renameTeam(page, 'Mine');
  await importTeam(page, FIRE_TEAM);
  await renameTeam(page, 'Theirs');
  await page.goto('/#matches');
  await page.getByRole('tab', { name: 'Your team vs. theirs' }).click();
  await page.getByLabel('Your Team: load a saved team').selectOption({ label: 'Mine' });
  await page.getByLabel('Enemy Team: load a saved team').selectOption({ label: 'Theirs' });

  await page.getByRole('button', { name: 'Plan vs this team' }).click();
  await expect(page.getByRole('heading', { name: 'Plan 1' })).toBeVisible();
  await expect(page.getByText('full set').first()).toBeVisible();
  await page.getByRole('button', { name: 'Use plan 2' }).click();
  await expect(page.getByText('Saved a new match with this plan to your match log.')).toBeVisible();
  await page.getByRole('tab', { name: 'Match log' }).click();
  await expect(page.getByRole('list', { name: 'Logged matches' }).getByRole('listitem')).toHaveCount(1);
});

test('Other formats get an explanation instead of a plan', async ({ page }) => {
  await openApp(page);
  const gen9 = await page.getByRole('combobox', { name: 'Game and format' }).locator('option', { hasText: /^Gen 9/ }).getAttribute('value');
  await page.getByRole('combobox', { name: 'Game and format' }).selectOption(gen9!);
  await importTeam(page, SIX_TEAM);
  await renameTeam(page, 'Mine');
  await importTeam(page, OPPONENT);
  await renameTeam(page, 'Theirs');
  await page.goto('/#matches');
  await page.getByRole('tab', { name: 'Your team vs. theirs' }).click();
  await page.getByLabel('Your Team: load a saved team').selectOption({ label: 'Mine' });
  await page.getByLabel('Enemy Team: load a saved team').selectOption({ label: 'Theirs' });
  await page.getByRole('button', { name: 'Plan vs this team' }).click();
  await expect(page.getByText('The bring planner needs meta usage data, which only exists for Champions')).toBeVisible();
});
