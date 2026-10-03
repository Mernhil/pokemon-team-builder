import { expect, test, type Page } from '@playwright/test';
import { expectNoA11yViolations, openApp, setTheme } from './helpers';

const runTab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });

async function startRun(page: Page, name = 'My Nuzlocke') {
  await openApp(page, '#atlas');
  await page.getByRole('tab', { name: 'Run', exact: true }).click();
  await page.getByRole('textbox', { name: 'Run name' }).fill(name);
  await page.getByRole('button', { name: 'Start run' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Next cap: 14' })).toContainText('Roark');
}

async function openPlace(page: Page, text: string) {
  await runTab(page, 'Encounters').click();
  await page.getByRole('textbox', { name: 'Find a place or a Pokémon' }).fill(text);
  await page.getByRole('list', { name: 'Places' }).getByRole('button', { name: new RegExp(text) }).first().click();
}

test('Start a Platinum run: caps, encounters, the dupes clause, level warnings, deaths and the boss order', async ({ page }) => {
  await startRun(page);
  await expect(page.getByRole('group', { name: 'Run summary' })).toContainText('Badges 0/8');

  // Route 201: log Starly. The area's encounter is then used.
  await openPlace(page, 'Route 201');
  await page.getByRole('button', { name: 'Caught: Starly' }).click();
  await expect(page.getByText('Caught: Starly at Route 201.')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Places' }).getByRole('button', { name: /Route 201/ })).toContainText('Encounter used');
  await expect(page.getByRole('list', { name: 'Logged here' })).toContainText('Starly');

  // Route 202 is open, but Starly's whole line is greyed out as a dupe.
  await openPlace(page, 'Route 202');
  await expect(page.getByRole('list', { name: 'Places' }).getByRole('button', { name: /Route 202/ })).toContainText('Encounter available');
  const starly = page.locator('li[data-blocked="true"]').filter({ hasText: 'Starly' });
  await expect(starly).toContainText('Already caught: re-roll (dupes clause).');
  await expect(page.locator('li[data-blocked="false"]').filter({ hasText: 'Shinx' })).toHaveCount(1);

  // A level over the next cap is called out.
  await runTab(page, 'Party').click();
  await expect(page.getByRole('list', { name: 'Party' })).toContainText('Starly');
  await page.getByRole('spinbutton', { name: 'Level of Starly' }).fill('20');
  await expect(page.getByRole('list', { name: 'Over the level cap' })).toContainText('Starly (Lv 20) is over the next level cap (14)');
  await expect(page.getByText('Over cap 14')).toBeVisible();
  await page.getByRole('spinbutton', { name: 'Level of Starly' }).fill('12');
  await expect(page.getByRole('list', { name: 'Over the level cap' })).toHaveCount(0);

  // Next boss, and beating it moves the cap on.
  await runTab(page, 'Next boss').click();
  await expect(page.getByRole('heading', { name: 'Gym: Roark' })).toBeVisible();
  await expect(page.getByRole('list', { name: "Roark's team" }).getByRole('listitem')).not.toHaveCount(0);
  await page.getByRole('button', { name: 'Mark Roark as beaten' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Next cap: 22' })).toContainText('Gardenia');
  await expect(page.getByRole('group', { name: 'Run summary' })).toContainText('Badges 1/8');
  await expect(page.getByRole('checkbox', { name: 'Roark (Coal Badge) beaten' })).toBeChecked();

  // A death: where and why, then it shows in the graveyard and the summary.
  await runTab(page, 'Party').click();
  await page.getByRole('button', { name: 'Starly died' }).click();
  await page.getByRole('textbox', { name: "Cause of Starly's death" }).fill('Critical hit from Roark');
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('list', { name: 'Graveyard' })).toContainText('Critical hit from Roark');
  await expect(page.getByRole('group', { name: 'Run summary' })).toContainText('1 dead');
  await expect(page.getByRole('list', { name: 'Party' })).toHaveCount(0);

  // The map marks places once a run is going.
  await page.getByRole('tab', { name: 'Map', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Run marks' })).toContainText('encounter used');
  await expect(page.getByRole('button', { name: /^Route 201, encounter used/ })).toBeAttached();
  await expect(page.getByRole('button', { name: /^Route 202, encounter available/ })).toBeAttached();

  // Everything is still there after a reload.
  await page.reload();
  await page.getByRole('tab', { name: 'Run', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Next cap: 22' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Run' })).toHaveValue(/.+/);
});

test('Rules can be changed; with the first-encounter rule off a used area stays open', async ({ page }) => {
  await startRun(page);
  await openPlace(page, 'Route 201');
  await page.getByRole('button', { name: 'Caught: Bidoof' }).click();
  await page.getByRole('button', { name: 'Fainted: Turtwig' }).click();
  await expect(page.locator('li[data-blocked="true"]').filter({ hasText: 'Piplup' })).toContainText('already used');
  await runTab(page, 'Rules').click();
  await page.getByRole('checkbox', { name: /First encounter per area/ }).uncheck();
  await openPlace(page, 'Route 201');
  await expect(page.locator('li[data-blocked="true"]').filter({ hasText: 'Piplup' })).toHaveCount(0);
});

test('Log a gift by hand, and the Pokémon joins the party', async ({ page }) => {
  await startRun(page);
  await runTab(page, 'Encounters').click();
  await page.getByRole('combobox', { name: 'Where' }).selectOption({ label: 'Twinleaf Town' });
  await page.getByRole('combobox', { name: 'Pokémon', exact: true }).fill('Turtwig');
  await page.getByRole('textbox', { name: 'Nickname', exact: true }).fill('Leafy');
  await page.getByRole('button', { name: 'Log it' }).click();
  await runTab(page, 'Party').click();
  await expect(page.getByRole('list', { name: 'Party' })).toContainText('Leafy');
  await expect(page.getByRole('list', { name: 'Party' })).toContainText('Turtwig');
});

test('Calc vs boss opens the calculator with my Pokémon and theirs', async ({ page }) => {
  await startRun(page);
  await openPlace(page, 'Route 201');
  await page.getByRole('button', { name: 'Caught: Starly' }).click();
  await runTab(page, 'Next boss').click();
  await page.getByRole('button', { name: /^Calc: Starly attacks / }).first().click();
  await expect(page).toHaveURL(/#calc$/);
  await expect(page.getByRole('button', { name: 'Starly sprite' }).first()).toBeVisible();
});

test('Encounters-only games track encounters and deaths, and say there are no caps or bosses', async ({ page }) => {
  await openApp(page, '#atlas');
  await page.getByRole('radio', { name: /^Pokémon Black$/ }).click();
  await page.getByRole('tab', { name: 'Run', exact: true }).click();
  await page.getByRole('button', { name: 'Start run' }).click();
  await expect(page.getByText(/encounters only in the Pokénav, so this run tracks encounters/)).toBeVisible();
  await expect(runTab(page, 'Next boss')).toHaveCount(0);
  await expect(page.getByText(/Next cap/)).toHaveCount(0);
  await runTab(page, 'Encounters').click();
  await expect(page.getByRole('list', { name: 'Places' })).toBeVisible();
});

test('Several runs per game, with a switcher', async ({ page }) => {
  await startRun(page, 'First');
  await page.getByRole('button', { name: 'New run' }).click();
  await page.getByRole('textbox', { name: 'Run name' }).fill('Second');
  await page.getByRole('button', { name: 'Start run' }).click();
  const switcher = page.getByRole('combobox', { name: 'Run' });
  await expect(switcher.locator('option')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Second' })).toBeVisible();
  await switcher.selectOption({ index: 1 });
  await expect(page.getByRole('heading', { name: 'First' })).toBeVisible();
});

for (const theme of ['light', 'dark'] as const) {
  test(`axe: the Run page, ${theme} theme`, async ({ page }) => {
    await openApp(page);
    await setTheme(page, theme);
    await startRun(page, 'Axe run');
    await openPlace(page, 'Route 201');
    await page.getByRole('button', { name: 'Caught: Starly' }).click();
    await expectNoA11yViolations(page);
    await runTab(page, 'Party').click();
    await page.getByRole('spinbutton', { name: 'Level of Starly' }).fill('30');
    await expectNoA11yViolations(page);
    await runTab(page, 'Next boss').click();
    await page.getByRole('heading', { name: 'Gym: Roark' }).waitFor();
    await expectNoA11yViolations(page);
    await runTab(page, 'Rules').click();
    await expectNoA11yViolations(page);
    await page.getByRole('tab', { name: 'Map', exact: true }).click();
    await page.getByRole('group', { name: 'Run marks' }).waitFor();
    await expectNoA11yViolations(page);
  });
}
