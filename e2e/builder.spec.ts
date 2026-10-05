import { expect, test, type Page } from '@playwright/test';
import { SAMPLE_TEAM, expectPicked, importTeam, openApp, openStatCalculator, pickOption } from './helpers';


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
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('dialog').getByRole('textbox', { name: 'Team name' }).fill('E2E team');
  await page.getByRole('dialog').getByRole('button', { name: /^Save/ }).click();
  await expect(page.getByText(/Saved “.*” to your teams/)).toBeVisible();

  await page.reload();
  await expectBuilt(page);
  await page.getByRole('button', { name: 'Team actions' }).click();
  await page.getByRole('menuitem', { name: 'Saved teams' }).click();
  await expect(page.getByRole('dialog')).toContainText('E2E team');
});


test('saving under a name that is taken asks: add a variation, or overwrite', async ({ page }) => {
  await openApp(page);
  await buildIncineroar(page);
  const save = async (name: string) => {
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const separate = page.getByRole('dialog', { name: 'Save team' }).getByRole('radio', { name: /Save as a separate team/ });
    if (await separate.count()) await separate.check(); // a build saved into a team offers to update it
    await page.getByRole('dialog', { name: 'Save team' }).getByRole('textbox', { name: 'Team name' }).fill(name);
  };
  await save('Dup');
  await page.getByRole('dialog', { name: 'Save team' }).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved “Dup” to your teams.')).toBeVisible();

  // A second build under the same name: the dialog asks, defaulting to the safe choice.
  await page.getByRole('button', { name: 'Team actions' }).click();
  await page.getByRole('menuitem', { name: 'Clear this team' }).click();
  await expect(page.getByText(/Started a new team/)).toBeVisible();
  await buildIncineroar(page);
  await save('Dup');
  const dialog = page.getByRole('dialog', { name: 'Save team' });
  await expect(dialog.getByRole('radio', { name: /Add as a variation of “Dup”/ })).toBeChecked();
  await dialog.getByRole('button', { name: 'Add variation' }).click();
  await expect(page.getByText('Added a variation to “Dup”.')).toBeVisible();

  await save('Dup');
  await dialog.getByRole('radio', { name: /Overwrite “Dup”/ }).check();
  await dialog.getByRole('button', { name: 'Overwrite' }).click();
  await expect(page.getByText('Overwrote “Dup”.')).toBeVisible();
});

test('saved teams are only changed by Edit team + Save: the build stays a separate draft', async ({ page }) => {
  await openApp(page);
  await buildIncineroar(page);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('dialog', { name: 'Save team' }).getByRole('textbox', { name: 'Team name' }).fill('Keep');
  await page.getByRole('dialog', { name: 'Save team' }).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved “Keep” to your teams.')).toBeVisible();

  // Clear the build: the saved team is still in the list, untouched.
  await page.getByRole('button', { name: 'Team actions' }).click();
  await page.getByRole('menuitem', { name: 'Clear this team' }).click();
  await page.getByRole('button', { name: 'Team actions' }).click();
  await page.getByRole('menuitem', { name: 'Saved teams' }).click();
  const saved = page.getByRole('dialog', { name: 'Saved teams' });
  await expect(saved).toContainText('Keep');

  // Edit team loads it back into the builder, and Save offers to update it.
  await saved.getByRole('button', { name: 'Edit team Keep' }).click();
  await expect(saved).toBeHidden();
  await expectBuilt(page);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Save team' }).getByRole('radio', { name: /Update “Keep”/ })).toBeChecked();
});

test('Recommended items and way of use come from the meta data, and one tap applies an item', async ({ page }) => {
  await openApp(page);
  await importTeam(page, SAMPLE_TEAM);
  // The info button next to the item's own lists the most-used items.
  await expect(page.getByLabel('Recommended items for Garchomp').first()).toBeVisible();
  // The recommended way to use opens from its own section; its item chips apply with one tap.
  await page.getByText('Recommended way to use').click();
  const items = page.getByRole('region', { name: 'Recommended items' });
  await expect(items).toBeVisible();
  const chip = items.getByRole('button').first();
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
});

test('Aegislash: the stats panel switches between Shield and Blade Forme stats', async ({ page }) => {
  await openApp(page);
  await pickOption(page, 'Species', 'Aegislash');
  await openStatCalculator(page);
  const group = page.getByRole('group', { name: 'Stats shown for' });
  await expect(group.getByRole('button', { name: 'Base' })).toHaveAttribute('aria-pressed', 'true');
  await group.getByRole('button', { name: 'Blade' }).click();
  await expect(group.getByRole('button', { name: 'Blade' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Blade Spe').first()).toBeVisible();
});

test('Aegislash: Advanced details offers a Form choice (Auto / Base / Blade)', async ({ page }) => {
  await openApp(page);
  await pickOption(page, 'Species', 'Aegislash');
  await page.getByRole('button', { name: /Advanced details/ }).click();
  const form = page.getByRole('radiogroup', { name: 'Form' });
  await expect(form.getByRole('radio', { name: 'Auto' })).toBeChecked();
  await form.getByRole('radio', { name: 'Blade' }).click();
  await expect(form.getByRole('radio', { name: 'Blade' })).toBeChecked();
});
