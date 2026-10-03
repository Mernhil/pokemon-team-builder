import { expect, test } from '@playwright/test';
import { SAMPLE_TEAM, importTeam, openApp } from './helpers';

const speeds = async (page: import('@playwright/test').Page) =>
  (await page.getByRole('list', { name: 'Speed tiers' }).getByLabel(/^Speed \d+$/).evaluateAll((els) => els.map((e) => Number(e.getAttribute('aria-label')?.replace('Speed ', '')))));

test('Speed tiers: ladder with my team, Trick Room flips it, Outspeed this applies and undoes', async ({ page }) => {
  await openApp(page);
  await importTeam(page, SAMPLE_TEAM);
  // The Team check links to it.
  await page.getByRole('link', { name: /Speed tiers/ }).click();
  await expect(page).toHaveURL(/#speed$/);

  // Reg M-C is live without usage data: the newest regulation that has some is used, and says so.
  await expect(page.getByText(/No usage data for Reg M-C yet/)).toBeVisible();
  const ladder = page.getByRole('list', { name: 'Speed tiers' });
  await expect(ladder.getByRole('listitem').first()).toBeVisible();
  await expect(ladder.getByText('Yours').first()).toBeVisible();
  const normal = await speeds(page);
  expect(normal.length).toBeGreaterThan(10);
  expect(normal).toEqual([...normal].sort((a, b) => b - a));

  await page.getByRole('button', { name: 'Trick Room' }).click();
  const reversed = await speeds(page);
  expect(reversed).toEqual([...reversed].sort((a, b) => a - b));

  await page.getByRole('button', { name: 'Trick Room' }).click();
  await page.getByRole('group', { name: 'My side' }).getByRole('button', { name: 'Tailwind' }).click();
  const tw = await speeds(page);
  expect(tw).not.toEqual(normal);

  // A fresh Incineroar with every Stat Point unspent: tap meta rows until one can be beaten, then apply (undoable).
  await importTeam(page, 'Incineroar @ Sitrus Berry\nAbility: Intimidate\nAdamant Nature\n- Flare Blitz\n- Fake Out\n');
  await page.goto('/#speed');
  await expect(ladder.getByText('Yours')).toBeVisible();
  const apply = page.getByRole('button', { name: /^Apply .* Spe / });
  const count = await ladder.getByRole('button').count();
  for (let i = count - 1; i >= 0; i--) {
    await ladder.getByRole('button').nth(i).click();
    await expect(page.getByText('Outspeed this', { exact: true })).toBeVisible();
    if ((await apply.count()) > 0 && (await apply.isEnabled())) break;
    await ladder.getByRole('button', { expanded: true }).click();
  }
  await apply.click();
  await expect(page.getByText(/Incineroar: \d+ Spe /)).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
});

test('Speed tiers: non-Champions formats get an empty state', async ({ page }) => {
  await openApp(page);
  const gen9 = await page.getByRole('combobox', { name: 'Game and format' }).locator('option', { hasText: /^Gen 9/ }).getAttribute('value');
  await page.getByRole('combobox', { name: 'Game and format' }).selectOption(gen9!);
  await page.goto('/#speed');
  await expect(page.getByText('Speed tiers need meta usage data, which only exists for Champions')).toBeVisible();
});
