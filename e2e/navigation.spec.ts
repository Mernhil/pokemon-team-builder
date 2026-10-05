import { expect, test } from '@playwright/test';
import { SAMPLE_TEAM, expectNoA11yViolations, importTeam, openApp, setTheme } from './helpers';

const isPhone = (page: import('@playwright/test').Page) => (page.viewportSize()?.width ?? 1280) < 640;
const nav = (page: import('@playwright/test').Page) => page.getByRole('navigation', { name: 'Main' }).locator('visible=true');

test('every old hash lands on its Analyse tab', async ({ page }) => {
  for (const [old, now, tab] of [
    ['#speed', /#analyse\/speed$/, 'Speed'],
    ['#threats', /#analyse\/threats$/, 'Threats'],
    ['#showcase', /#analyse\/overview$/, 'Overview'],
    ['#compare', /#analyse\/compare$/, 'Compare'],
    ['#ohkod', /#analyse\/ohko\/by$/, 'OHKO'],
    ['#ohko', /#analyse\/ohko\/to$/, 'OHKO'],
  ] as const) {
    await openApp(page, old);
    await expect(page, old).toHaveURL(now);
    await expect(page.getByRole('tab', { name: tab, selected: true, exact: true }), old).toBeVisible();
  }
});

test('Analyse: one team picker over every tab, the tab is in the URL', async ({ page }) => {
  await openApp(page, '#analyse');
  await expect(page).toHaveURL(/#analyse\/overview$/);
  // It starts on the build that is open.
  await expect(page.getByRole('combobox', { name: 'Team to analyse' })).toBeVisible();
  for (const [name, hash] of [['Speed', /speed$/], ['Threats', /threats$/], ['OHKO', /ohko\/by$/], ['Compare', /compare$/], ['Overview', /overview$/]] as const) {
    await page.getByRole('tab', { name, exact: true }).click();
    await expect(page).toHaveURL(hash);
    await expect(page.getByRole('combobox', { name: 'Team to analyse' })).toBeVisible();
  }
  // The OHKO tab keeps its two lists.
  await page.getByRole('tab', { name: 'OHKO', exact: true }).click();
  await page.getByRole('tab', { name: 'Can OHKO' }).click();
  await expect(page).toHaveURL(/#analyse\/ohko\/to$/);
});

test('the main bar: Analyse is a destination; for Champions Reverse search takes Pokénav’s place', async ({ page }) => {
  await openApp(page);
  await expect(nav(page).getByRole('button', { name: 'Analyse', exact: true })).toBeVisible();
  const labels = (await nav(page).getByRole('button').allInnerTexts()).map((t) => t.trim());
  if (isPhone(page)) {
    expect(labels).toEqual(['Build', 'Calc', 'Analyse', 'Pokédex', 'More']);
    await nav(page).getByRole('button', { name: 'More' }).click();
    for (const item of ['Match log', 'Meta', 'Reverse search', 'Regulation diff']) await expect(page.getByRole('menuitem', { name: item })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Pokénav' })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Settings & credits' })).toBeVisible();
  } else {
    expect(labels).toEqual(['Build', 'Calc', 'Analyse', 'Pokédex', 'Reverse search', 'More']);
    await nav(page).getByRole('button', { name: 'More' }).click();
    for (const item of ['Match log', 'Meta', 'Regulation diff', 'Settings & credits']) await expect(page.getByRole('menuitem', { name: item })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Pokénav' })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Reverse search' })).toHaveCount(0);
  }
});

test('Settings → Navigation: choose the bar’s destinations, and Reset restores the default', async ({ page }) => {
  await openApp(page);
  await nav(page).getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Settings & credits' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings & credits' });
  const group = isPhone(page) ? 'Phone (bottom bar)' : 'Desktop and tablet (top bar)';
  const slots = isPhone(page) ? 4 : 5;
  await dialog.getByRole('combobox', { name: `${group}, slot ${slots}` }).selectOption({ label: 'Meta' });
  await page.keyboard.press('Escape');
  const labels = (await nav(page).getByRole('button').allInnerTexts()).map((t) => t.trim());
  expect(labels).toContain('Meta');
  expect(labels[slots - 1]).toBe('Meta');
  // it survives a reload, and Pokénav (the old fifth slot) isn't swapped for Reverse search once chosen
  await page.reload();
  expect((await nav(page).getByRole('button').allInnerTexts()).map((t) => t.trim())).toContain('Meta');
  await nav(page).getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Settings & credits' }).click();
  await page.getByRole('dialog', { name: 'Settings & credits' }).getByRole('group', { name: group }).getByRole('button', { name: 'Reset' }).click();
  await page.keyboard.press('Escape');
  expect((await nav(page).getByRole('button').allInnerTexts()).map((t) => t.trim())).not.toContain('Meta');
});

test.describe('command palette', () => {
  test('finds a screen by name and opens it with Enter', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Search (Ctrl K)' }).click();
    const box = page.getByRole('combobox', { name: /Search screens/ });
    await expect(box).toBeFocused();
    await box.fill('speed');
    await expect(page.getByRole('option', { name: /Analyse · Speed/ })).toBeVisible();
    await box.press('Enter');
    await expect(page).toHaveURL(/#analyse\/speed$/);
    await expect(page.getByRole('combobox', { name: /Search screens/ })).toHaveCount(0);
  });

  test('opens with Ctrl+K, finds a Pokémon, arrows pick the row and Esc closes', async ({ page }) => {
    test.skip(isPhone(page), 'keyboard shortcut');
    await openApp(page);
    await page.keyboard.press('Control+k');
    const box = page.getByRole('combobox', { name: /Search screens/ });
    await box.fill('rillaboom');
    const dexRow = page.getByRole('option', { name: /Rillaboom.*Pokédex/ });
    await expect(dexRow).toBeVisible();
    await expect(page.getByRole('option', { name: /Calc: Rillaboom vs/ })).toBeVisible();
    await expect(dexRow).toHaveAttribute('aria-selected', 'true');
    await box.press('ArrowDown');
    await expect(page.getByRole('option', { name: /Calc: Rillaboom vs/ })).toHaveAttribute('aria-selected', 'true');
    await box.press('Enter');
    await expect(page).toHaveURL(/#calc$/);
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('combobox', { name: /Search screens/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('combobox', { name: /Search screens/ })).toHaveCount(0);
  });

  test('says when nothing matches', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Search (Ctrl K)' }).click();
    await page.getByRole('combobox', { name: /Search screens/ }).fill('qqqqzzzz');
    await expect(page.getByText('Nothing matches')).toBeVisible();
  });
});

test.describe("What's new", () => {
  const seen = (version: string) => ({ cookies: [], origins: [{ origin: 'http://localhost:4173', localStorage: [{ name: 'ptb:prefs:v1', value: JSON.stringify({ state: { lastSeenVersion: version }, version: 1 }) }] }] });

  test.describe('after an update', () => {
    test.use({ storageState: seen('0.22.0') });
    test('lists what came since, offers Try it, and is not shown again once dismissed', async ({ page }) => {
      await openApp(page);
      const sheet = page.getByRole('dialog', { name: 'What’s new' });
      await expect(sheet).toBeVisible();
      await expect(sheet.getByRole('region', { name: 'Version 0.23.0' })).toBeVisible();
      await expect(sheet.getByRole('region', { name: 'Version 0.22.0' })).toHaveCount(0);
      await sheet.getByRole('link', { name: 'Try it: Team overview' }).first().click();
      await expect(page).toHaveURL(/#analyse\/overview$/);
      await expect(sheet).toHaveCount(0);
      await page.reload();
      await expect(page.getByRole('heading', { level: 1 })).toBeAttached();
      await expect(page.getByRole('dialog', { name: 'What’s new' })).toHaveCount(0);
    });
  });

  test.describe('first install', () => {
    test.use({ storageState: { cookies: [], origins: [] } });
    test('shows nothing, but Settings keeps it reachable', async ({ page }) => {
      await openApp(page);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await nav(page).getByRole('button', { name: 'More' }).click();
      await page.getByRole('menuitem', { name: 'Settings & credits' }).click();
      await page.getByRole('button', { name: 'What’s new' }).click();
      await expect(page.getByRole('dialog', { name: 'What’s new' })).toBeVisible();
    });
  });
});

for (const theme of ['light', 'dark'] as const) {
  test(`axe: Analyse, the palette and What's new, ${theme} theme`, async ({ page }) => {
    await openApp(page);
    await setTheme(page, theme);
    await importTeam(page, SAMPLE_TEAM);
    await page.goto('/#analyse/overview');
    await page.getByRole('combobox', { name: 'Team to analyse' }).waitFor();
    await expectNoA11yViolations(page);

    await page.getByRole('button', { name: 'Search (Ctrl K)' }).click();
    await page.getByRole('combobox', { name: /Search screens/ }).fill('a');
    await page.getByRole('option').first().waitFor();
    await expectNoA11yViolations(page);
    await page.keyboard.press('Escape');

    await nav(page).getByRole('button', { name: /^More/ }).click();
    await page.getByRole('menuitem', { name: 'Settings & credits' }).click();
    await page.getByRole('button', { name: 'What’s new' }).click();
    await page.getByRole('dialog', { name: 'What’s new' }).getByRole('region').first().waitFor();
    await expectNoA11yViolations(page);
  });
}
