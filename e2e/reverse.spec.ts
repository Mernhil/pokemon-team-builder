import { expect, test, type Page } from '@playwright/test';
import { openApp, pickOption } from './helpers';

const checked = (page: Page) => page.getByRole('status').filter({ hasText: /Checked \d+ Pokémon/ });
const count = async (page: Page) => Number((await page.getByRole('heading', { name: / match(es)?$/ }).innerText()).split(' ')[0]);

async function addCondition(page: Page, kind: string, species: string) {
  await page.getByRole('combobox', { name: 'Condition type' }).selectOption({ label: kind });
  await pickOption(page, 'Species', species);
}

test('Reverse search: every condition has to hold, and a match can be added to the team', async ({ page }) => {
  await openApp(page, '#reverse');
  await expect(page.getByText('Nothing to search for yet')).toBeVisible();

  await addCondition(page, 'One-shots', 'Rillaboom');
  await expect(checked(page)).toBeVisible({ timeout: 30_000 });
  const one = await count(page);
  expect(one).toBeGreaterThan(0);
  await expect(page.getByRole('list').getByText('One-shots Rillaboom').first()).toBeVisible();

  await addCondition(page, 'Survives', 'Incineroar');
  await expect(page.getByRole('heading', { name: / match(es)?$/ })).toBeVisible();
  await expect(checked(page)).toBeVisible({ timeout: 30_000 });
  const two = await count(page);
  expect(two).toBeLessThanOrEqual(one);

  await addCondition(page, 'Resists', 'Garchomp');
  await expect(checked(page)).toBeVisible({ timeout: 30_000 });
  expect(await count(page)).toBeLessThanOrEqual(two);

  // Removing a condition widens the answer again.
  await page.getByRole('button', { name: /^Remove: Resists Garchomp/ }).click();
  await expect(checked(page)).toBeVisible({ timeout: 30_000 });
  expect(await count(page)).toBe(two);

  if (two > 0) {
    await page.getByRole('button', { name: /^Add .* to team$/ }).first().click();
    await expect(page.getByText(/^Added .* to /)).toBeVisible();
  }
});

test('Reverse search: a required move narrows the answers to Pokémon that know it, with the other conditions', async ({ page }) => {
  await openApp(page, '#reverse');
  await addCondition(page, 'One-shots', 'Sylveon');
  await expect(checked(page)).toBeVisible({ timeout: 30_000 });
  const any = await count(page);

  // "A Fake Out user that one-shots Sylveon".
  await pickOption(page, 'Add a required move', 'Fake Out');
  await expect(page.getByRole('list', { name: 'Required moves' }).getByText('Fake Out')).toBeVisible();
  await expect(checked(page)).toBeVisible({ timeout: 30_000 });
  const withFakeOut = await count(page);
  expect(withFakeOut).toBeGreaterThan(0);
  expect(withFakeOut).toBeLessThan(any);
  // Every answer says it knows the move.
  const cards = page.getByRole('list').filter({ hasText: 'Knows Fake Out' });
  await expect(cards.first()).toBeVisible();

  // Removing the move widens the search again.
  await page.getByRole('button', { name: 'Remove Fake Out' }).click();
  await expect(checked(page)).toBeVisible({ timeout: 30_000 });
  expect(await count(page)).toBe(any);

  // A move on its own works too: everything that can learn it.
  await page.getByRole('button', { name: /^Remove: One-shots Sylveon/ }).click();
  await pickOption(page, 'Add a required move', 'Fake Out');
  await expect(checked(page)).toBeVisible({ timeout: 30_000 });
  expect(await count(page)).toBeGreaterThan(withFakeOut);
});

test('Reverse search: a target added while the meta is still loading is rebuilt as its Mega once it arrives', async ({ page }) => {
  // Hold the meta chunk back so the target is added before the most-used sets exist.
  await page.route(/assets\/meta-[^/]*\.js$/, async (route) => {
    await new Promise((r) => setTimeout(r, 2500));
    await route.continue();
  });
  await openApp(page, '#reverse');
  await addCondition(page, 'One-shots', 'Golisopod');
  await expect(page.getByText('Loading meta data…')).toBeVisible();
  await expect(checked(page)).toBeVisible({ timeout: 30_000 });
  // The condition now holds Golisopite and is calculated as the Mega.
  await expect(page.getByText(/Golisopod's set: Golisopite/)).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Mega' })).toHaveAttribute('aria-checked', 'true');
  expect(await count(page)).toBeGreaterThan(30);
  await expect(page.getByTestId('rs-card-arcanine')).toBeVisible();
});

test('Reverse search: edit any answer\'s build, try Mega Stones, reset', async ({ page }) => {
  await openApp(page, '#reverse');
  await addCondition(page, 'One-shots', 'Golisopod');
  await expect(checked(page)).toBeVisible({ timeout: 30_000 });
  const plain = await count(page);
  // Medicham has no stone in its default build, so it is not an answer yet.
  await expect(page.getByTestId('rs-card-medicham')).toHaveCount(0);
  await expect(page.getByTestId('rs-card-medicham:medichamite')).toHaveCount(0);

  // Try Mega Stones adds it, labelled with its stone; nothing else goes away.
  const toggle = page.getByRole('button', { name: 'Try Mega Stones' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  let card = page.getByTestId('rs-card-medicham:medichamite');
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card.getByText('with Medichamite')).toBeVisible();
  await expect(checked(page)).toBeVisible({ timeout: 30_000 });
  expect(await count(page)).toBeGreaterThan(plain);

  // Edit build opens the target editor in the card, with a 44pt button on a phone.
  const edit = card.getByRole('button', { name: 'Edit build of Medicham' });
  const touch = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
  if (touch) expect((await edit.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const top = async () => (await card.boundingBox())!.y + (await page.evaluate(() => window.scrollY));
  const before = await top();
  await edit.click();
  await expect(card.getByLabel('Medicham ability')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // A change that keeps it an answer: the card stays and says it is a custom build. It now holds its stone
  // as its own build, so it is the species' card itself and no longer a "with <Stone>" try.
  await pickOption(page, 'Medicham move 4', 'Rock Slide'); // its last move isn't the one that does the damage
  card = page.getByTestId('rs-card-medicham');
  await expect(card.getByText('Custom build')).toBeVisible();
  await expect(page.getByTestId('rs-card-medicham:medichamite')).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Reset Medicham to default' })).toBeVisible();
  await expect(page.getByText('1 custom build')).toBeVisible();

  // A build that can't one-shot anything stays (flagged) while its editor is open, and drops out when it closes.
  for (const [i, move] of ['Protect', 'Detect', 'Endure', 'Rest'].entries()) await pickOption(page, `Medicham move ${i + 1}`, move);
  await expect(card.getByText(/Doesn't meet the conditions/)).toBeVisible({ timeout: 30_000 });
  expect(await top()).toBeGreaterThanOrEqual(before - 1); // it didn't jump up the list
  await card.getByRole('button', { name: 'Done editing Medicham' }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByText('1 custom build')).toBeVisible();

  // Reset all brings the default build, and its answer, back.
  await page.getByRole('button', { name: 'Reset all' }).click();
  await expect(page.getByText(/custom build/)).toHaveCount(0);
  await expect(page.getByTestId('rs-card-medicham:medichamite')).toBeVisible({ timeout: 30_000 });

  // Back off: the answers are today's again.
  await page.getByRole('button', { name: 'Try Mega Stones' }).click();
  await expect(checked(page)).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => count(page)).toBe(plain);
});

test('Reverse search: a custom build is what Add to team and Open in Calc use', async ({ page }) => {
  await openApp(page, '#reverse');
  await addCondition(page, 'One-shots', 'Golisopod');
  await page.getByRole('button', { name: 'Try Mega Stones' }).click();
  let card = page.getByTestId('rs-card-medicham:medichamite');
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.getByRole('button', { name: 'Edit build of Medicham' }).click();
  await pickOption(page, 'Medicham move 4', 'Rock Slide'); // its last move isn't the one that does the damage
  card = page.getByTestId('rs-card-medicham');
  await expect(card.getByText('Custom build')).toBeVisible();
  await card.getByRole('button', { name: 'Add Medicham to team' }).click();
  await expect(page.getByText(/^Added Medicham to /)).toBeVisible();
  await page.evaluate(() => { location.hash = '#build'; });
  await expect(page.getByText('Medichamite').first()).toBeVisible();
});
