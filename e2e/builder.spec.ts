import { expect, test, type Page } from '@playwright/test';
import { expectPicked, openApp, openStatCalculator, pickOption } from './helpers';


/** Slot 1 filled the way a player would: species, item, ability, nature, four moves, SP in two stats. */
async function buildIncineroar(page: Page) {
  await pickOption(page, 'Species', 'Incineroar');
  await pickOption(page, 'Held item', 'Sitrus Berry');
  await page.getByRole('combobox', { name: 'Ability' }).selectOption({ label: 'Intimidate (Hidden)' });
  await page.getByRole('button', { name: 'Stat alignment (nature)' }).click();
  await page.getByRole('button', { name: 'Adamant', exact: true }).click();
  const moves = ['Fake Out', 'Flare Blitz', 'Throat Chop', 'Parting Shot'];
  for (const [i, move] of moves.entries()) await pickOption(page, `Move ${i + 1}`, move);
  await openStatCalculator(page);
  await page.getByRole('spinbutton', { name: 'HP SP value' }).fill('32');
  await page.getByRole('spinbutton', { name: 'Atk SP value' }).fill('32');
}

/** Slot 1 shows the set built above (works on the phone layout too, where the team list is hidden). */
async function expectBuilt(page: Page) {
  await expect(page.getByRole('heading', { name: 'Slot 1: Incineroar' })).toBeAttached();
  await expectPicked(page, 'Held item', 'Sitrus Berry');
  await expect(page.getByRole('combobox', { name: 'Ability' })).toHaveValue(/./);
  await expect(page.getByRole('button', { name: 'Stat alignment (nature)' })).toContainText('Adamant');
  for (const [i, move] of ['Fake Out', 'Flare Blitz', 'Throat Chop', 'Parting Shot'].entries())
    await expectPicked(page, `Move ${i + 1}`, move);
  await openStatCalculator(page);
  await expect(spUsed(page)).toHaveAttribute('aria-valuenow', '64');
  await expect(page.getByRole('spinbutton', { name: 'HP SP value' })).toHaveValue('32');
  await expect(page.getByRole('spinbutton', { name: 'Atk SP value' })).toHaveValue('32');
}

const spUsed = (page: Page) => page.getByRole('meter', { name: 'SP used' });

test('builds a Pokémon with legal Stat Points and no validation errors', async ({ page }) => {
  await openApp(page);
  await buildIncineroar(page);

  await expectBuilt(page);

  // 64 of 66 used; asking for more than is left (or more than 32 in one stat) is clamped.
  await expect(spUsed(page)).toHaveAttribute('aria-valuenow', '64');
  await page.getByRole('spinbutton', { name: 'Spe SP value' }).fill('20');
  await expect(spUsed(page)).toHaveAttribute('aria-valuenow', '66');
  await page.getByRole('spinbutton', { name: 'HP SP value' }).fill('40');
  await expect(page.getByRole('spinbutton', { name: 'HP SP value' })).toHaveValue('32');
  expect(Number(await spUsed(page).getAttribute('aria-valuenow'))).toBeLessThanOrEqual(66);

  await expect(page.getByRole('complementary', { name: 'Team check', exact: true }).getByText('0 errors')).toBeVisible();
});

test('Showdown export → clear → import restores the same set', async ({ page }) => {
  await openApp(page);
  await buildIncineroar(page);

  await page.getByRole('button', { name: 'Team actions' }).click();
  await page.getByRole('menuitem', { name: 'Import / Export' }).click();
  const dialog = page.getByRole('dialog');
  const text = dialog.getByRole('textbox', { name: /Showdown.* export/i });
  const exported = await text.inputValue();
  expect(exported).toContain('Incineroar @ Sitrus Berry');
  expect(exported).toContain('Ability: Intimidate');
  expect(exported).toContain('Adamant Nature');
  for (const m of ['Fake Out', 'Flare Blitz', 'Throat Chop', 'Parting Shot']) expect(exported).toContain(`- ${m}`);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Team actions' }).click();
  await page.getByRole('menuitem', { name: 'Clear this team' }).click();
  await expect(page.getByRole('heading', { name: 'Slot 1', exact: true })).toBeAttached();

  await page.getByRole('button', { name: 'Team actions' }).click();
  await page.getByRole('menuitem', { name: 'Import / Export' }).click();
  await dialog.getByRole('tab', { name: /import/i }).click();
  await dialog.getByRole('textbox', { name: 'Text to import' }).fill(exported);
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();

  await expectBuilt(page);
});

test('a saved team survives a reload', async ({ page }) => {
  await openApp(page);
  await buildIncineroar(page);
  await page.getByRole('textbox', { name: 'Team name' }).first().fill('E2E team');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^Save/ }).click();
  await expect(page.getByText(/Saved “.*” to your teams/)).toBeVisible();

  await page.reload();
  await expectBuilt(page);
  await page.getByRole('button', { name: 'Team actions' }).click();
  await page.getByRole('menuitem', { name: 'Saved teams' }).click();
  await expect(page.getByRole('dialog')).toContainText('E2E team');
});

