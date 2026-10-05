import { expect, test, type Page } from '@playwright/test';
import { SIX_TEAM, expectNoA11yViolations, importTeam, openApp, renameTeam, setTheme } from './helpers';

/** A saved Champions team, then the Game day screen from the Match log's "Start a match". */
async function startGame(page: Page) {
  await openApp(page);
  await importTeam(page, SIX_TEAM);
  await renameTeam(page, 'Rain');
  await page.goto('/#matches');
  await page.getByRole('button', { name: 'Start a match' }).click();
  await expect(page.getByRole('combobox', { name: 'My team' })).toHaveValue(/.+/);
}

const tapSix = async (page: Page, n = 6) => {
  const grid = page.getByRole('list', { name: 'Most used Pokémon' });
  for (let i = 0; i < n; i++) await grid.getByRole('button', { pressed: false }).first().click();
};

test('Game day: tap their six, read the plan, log a win, and find it in the match log', async ({ page }) => {
  await startGame(page);
  await expect(page).toHaveURL(/#gameday$/);
  await expect(page.getByRole('heading', { name: 'Their six (0/6)' })).toBeVisible();

  await tapSix(page, 6);
  await expect(page.getByRole('heading', { name: 'Their six (6/6)' })).toBeVisible();

  // The plan, the matchups and the speed order.
  await expect(page.getByRole('heading', { name: 'The plan' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Plan 1 Pokémon' })).toBeVisible();
  await expect(page.getByText('Main risk:')).toBeVisible();
  await expect(page.getByText(/They would probably bring:/)).toBeVisible();
  const table = page.getByRole('table', { name: /Matchups/ });
  await expect(table).toBeVisible();
  await expect(table.getByRole('row')).toHaveCount(7);
  await expect(page.getByRole('list', { name: 'Speed order, fastest first' }).getByRole('listitem')).toHaveCount(12);
  await page.getByRole('button', { name: 'Trick Room' }).click();
  await expect(page.getByRole('list', { name: /Speed order, slowest first/ })).toBeVisible();
  // Another plan is one tap away.
  await page.getByRole('tab', { name: 'Plan 2' }).click();
  await expect(page.getByRole('heading', { name: 'Plan 2' })).toBeVisible();
  await page.getByRole('tab', { name: 'Plan 1' }).click();

  // Note what they showed, mark what they brought.
  await page.getByRole('list', { name: 'What they showed' }).getByRole('listitem').first().locator('summary').click();
  await page.getByRole('textbox', { name: 'Notes' }).fill('Tailwind turn 1');

  await page.getByRole('button', { name: /^Win$/ }).click();
  await expect(page.getByText(/Logged a win in your match log/)).toBeVisible();
  // The next game is ready on the same team: their six are gone.
  await expect(page.getByRole('heading', { name: 'Their six (0/6)' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'My team' })).toHaveValue(/.+/);

  const saved = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('ptb:matches:v1')!).state.matches) as Record<string, unknown>[]);
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ result: 'win', category: 'Ranked Ladder', notes: 'Tailwind turn 1' });
  expect((saved[0].myBrought as string[]).length).toBe(4);
  expect((saved[0].myLeads as string[]).length).toBe(2);
  expect((saved[0].opponentTeam as unknown[]).length).toBe(6);
  expect(saved[0].myTeamId).toBeTruthy();

  // In the match log, with what was brought and led.
  await page.goto('/#matches');
  await page.getByRole('list', { name: 'Logged matches' }).getByRole('button').first().click();
  await expect(page.getByRole('list', { name: 'I brought' })).toBeVisible();
  await expect(page.getByText('Brought 4/4 · Lead 2/2').first()).toBeVisible();
});

test('Game day: the game in progress survives leaving the screen and a reload; Undo and removing work', async ({ page }) => {
  await startGame(page);
  await tapSix(page, 3);
  await expect(page.getByRole('heading', { name: 'Their six (3/6)' })).toBeVisible();
  await page.getByRole('button', { name: 'Undo the last Pokémon' }).click();
  await expect(page.getByRole('heading', { name: 'Their six (2/6)' })).toBeVisible();
  await page.getByRole('list', { name: 'Their Pokémon' }).getByRole('button', { name: /^Remove / }).first().click();
  await expect(page.getByRole('heading', { name: 'Their six (1/6)' })).toBeVisible();
  await tapSix(page, 2);

  await page.goto('/#calc');
  await page.goto('/#gameday');
  await expect(page.getByRole('heading', { name: 'Their six (3/6)' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Their six (3/6)' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'The plan' })).toBeVisible();

  await page.getByRole('button', { name: 'Discard this game' }).click();
  await expect(page.getByRole('heading', { name: 'Their six (0/6)' })).toBeVisible();
  // Nothing was logged.
  expect(await page.evaluate(() => localStorage.getItem('ptb:matches:v1'))).toBeNull();
});

test('Game day: the palette and Analyse lead to it; with no saved team it says what to do', async ({ page }) => {
  await openApp(page);
  await page.goto('/#gameday');
  await expect(page.getByText('Save a Champions team to play a game with')).toBeVisible();
  await page.goto('/#analyse');
  await page.getByRole('button', { name: 'Game day' }).click();
  await expect(page).toHaveURL(/#gameday$/);
  await page.getByRole('button', { name: 'Search (Ctrl K)' }).click();
  await page.getByRole('combobox', { name: /Search screens/ }).fill('game day');
  await expect(page.getByRole('option', { name: /Game day/ })).toBeVisible();
});

for (const theme of ['light', 'dark'] as const) {
  test(`axe: Game day with a plan, ${theme} theme`, async ({ page }) => {
    await startGame(page);
    await setTheme(page, theme);
    await tapSix(page, 6);
    await page.getByRole('table', { name: /Matchups/ }).waitFor();
    await expectNoA11yViolations(page);
  });
}
