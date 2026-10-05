import { expect, test } from '@playwright/test';
import { expectNoA11yViolations, openApp, setTheme } from './helpers';

/** Three Rain opponents' logs: two with an empty archetype field, one already tagged. */
function seedLog() {
  const opp = [
    { speciesId: 'pelipper', abilityId: 'drizzle', moves: ['hurricane', 'weatherball', 'tailwind', 'protect'] },
    { speciesId: 'basculegion', abilityId: 'swiftswim', moves: ['waterfall', 'flipturn', 'shadowball', 'protect'] },
  ];
  const base = { regulationId: 'champions-reg-mc', category: 'Ranked Ladder', result: 'win', opponentTeam: opp, createdAt: 1, updatedAt: 1 };
  const matches = {
    a: { ...base, id: 'a', date: '2026-09-12' },
    b: { ...base, id: 'b', date: '2026-09-13', myArchetype: 'Balance' },
    c: { ...base, id: 'c', date: '2026-09-14', myArchetype: 'Balance', opponentArchetype: 'Stall' },
  };
  return JSON.stringify({ version: 3, state: { matches, order: ['c', 'b', 'a'] } });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((log) => localStorage.setItem('ptb:matches:v1', log), seedLog());
});

test('Tag untagged matches: preview, untick one, apply, undo; a tag you set is never touched', async ({ page }) => {
  await openApp(page, '#matches');
  const open = page.getByRole('button', { name: 'Tag 2 untagged matches' });
  await expect(open).toBeVisible();
  await open.click();
  const dialog = page.getByRole('dialog', { name: 'Tag 2 untagged matches' });
  const list = dialog.getByRole('list', { name: 'Suggested tags' });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(list).toContainText('Theirs: Rain');
  await expect(list).toContainText('Pelipper sets rain');

  // Nothing is written by looking.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: 'Tag 2 untagged matches' })).toBeVisible();

  await page.getByRole('button', { name: 'Tag 2 untagged matches' }).click();
  await dialog.getByRole('checkbox', { name: /Tag the match on 2026-09-12/ }).uncheck();
  await dialog.getByRole('button', { name: 'Apply to 1' }).click();
  await expect(page.getByText('Tagged 1 match.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tag 1 untagged match' })).toBeVisible();

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('button', { name: 'Tag 2 untagged matches' })).toBeVisible();

  // The match tagged by hand keeps its tags through apply.
  await page.getByRole('button', { name: 'Tag 2 untagged matches' }).click();
  await dialog.getByRole('button', { name: 'Apply to 2' }).click();
  await expect(page.getByRole('button', { name: /^Tag \d+ untagged/ })).toHaveCount(0);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ptb:matches:v1')!).state.matches as Record<string, { myArchetype?: string; opponentArchetype?: string }>);
  expect(saved.a.opponentArchetype).toBe('Rain');
  expect(saved.b).toMatchObject({ myArchetype: 'Balance', opponentArchetype: 'Rain' });
  expect(saved.c).toMatchObject({ myArchetype: 'Balance', opponentArchetype: 'Stall' });
});

test('the match form suggests an archetype for an empty field, one tap to use it', async ({ page }) => {
  await openApp(page, '#matches');
  await page.getByRole('button', { name: /2026-09-12/ }).first().click();
  const suggest = page.getByRole('button', { name: /Use the suggested archetype Rain/ });
  await expect(suggest).toContainText('Suggested: Rain');
  await suggest.click();
  await expect(page.getByLabel('Opponent archetype')).toHaveValue('Rain');
  // Once there is a value there is nothing to suggest, and a typed value is never replaced.
  await expect(page.getByRole('button', { name: /Use the suggested archetype Rain/ })).toHaveCount(0);
  await page.getByLabel('Opponent archetype').fill('Stall');
  await expect(page.getByRole('button', { name: /Use the suggested archetype/ })).toHaveCount(0);
});

for (const theme of ['light', 'dark'] as const) {
  test(`axe: the tag preview and the suggestion chip, ${theme} theme`, async ({ page }) => {
    await openApp(page, '#matches');
    await setTheme(page, theme);
    await page.getByRole('button', { name: 'Tag 2 untagged matches' }).click();
    await page.getByRole('list', { name: 'Suggested tags' }).waitFor();
    await expectNoA11yViolations(page);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: /2026-09-12/ }).first().click();
    await page.getByRole('button', { name: /Use the suggested archetype Rain/ }).waitFor();
    await expectNoA11yViolations(page);
  });
}
