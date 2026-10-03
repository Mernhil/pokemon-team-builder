import { test } from '@playwright/test';
import { SAMPLE_TEAM, expectNoA11yViolations, importTeam, openApp, setTheme } from './helpers';

// axe-core (WCAG 2.0/2.1 A + AA) on each main view, in both themes.
for (const theme of ['light', 'dark'] as const) {
  test.describe(`axe, ${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await openApp(page);
      await setTheme(page, theme);
    });

    test('Build', async ({ page }) => {
      await importTeam(page, SAMPLE_TEAM);
      await expectNoA11yViolations(page);
    });

    test('Calc', async ({ page }) => {
      await importTeam(page, SAMPLE_TEAM);
      await page.goto('/#calc');
      await page.getByRole('button', { name: 'Garchomp sprite' }).first().click();
      await page.getByRole('button', { name: 'Incineroar sprite' }).last().click();
      await expectNoA11yViolations(page);
    });

    test('Pokédex', async ({ page }) => {
      await page.getByRole('navigation', { name: 'Main' }).locator('visible=true').getByRole('button', { name: 'Pokédex', exact: true }).click();
      await page.getByRole('listbox', { name: 'Pokémon' }).getByRole('option').first().click();
      await expectNoA11yViolations(page);
    });

    test('Pokénav', async ({ page }) => {
      await page.getByRole('navigation', { name: 'Main' }).locator('visible=true').getByRole('button', { name: 'Pokénav', exact: true }).click();
      await page.getByRole('tab', { name: 'Map' }).waitFor();
      await expectNoA11yViolations(page);
    });

    test('Match log', async ({ page }) => {
      await page.getByRole('navigation', { name: 'Main' }).locator('visible=true').getByRole('button', { name: /^More/ }).click();
      await page.getByRole('menuitem', { name: 'Match log' }).click();
      await page.getByRole('button', { name: 'Log your first match' }).click();
      await expectNoA11yViolations(page);
    });

    test('Speed tiers', async ({ page }) => {
      await importTeam(page, SAMPLE_TEAM);
      await page.goto('/#speed');
      await page.getByRole('list', { name: 'Speed tiers' }).waitFor();
      await page.getByRole('list', { name: 'Speed tiers' }).getByRole('button').first().click();
      await expectNoA11yViolations(page);
    });

    test('Meta', async ({ page }) => {
      await page.getByRole('navigation', { name: 'Main' }).locator('visible=true').getByRole('button', { name: /^More/ }).click();
      await page.getByRole('menuitem', { name: 'Meta' }).click();
      await page.getByRole('combobox', { name: 'Regulation' }).selectOption({ label: 'Champions · Reg M-B' });
      await page.getByRole('list', { name: /Most used Pokémon/ }).waitFor();
      await expectNoA11yViolations(page);
    });
  });
}
