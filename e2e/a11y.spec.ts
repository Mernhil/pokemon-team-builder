import { test } from '@playwright/test';
import { SAMPLE_TEAM, SIX_TEAM, expectNoA11yViolations, importTeam, openApp, openStatCalculator, pickOption, setTheme } from './helpers';

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

    test('Match log analytics', async ({ page }) => {
      const mon = (speciesId: string) => ({ speciesId });
      const matches: Record<string, unknown> = {};
      for (let i = 0; i < 6; i++) {
        matches[`k${i}`] = { id: `k${i}`, date: `2026-09-${10 + i}`, result: i < 2 ? 'win' : 'loss', regulationId: 'champions-reg-mc', myTeam: ['incineroar', 'garchomp'].map(mon), myBrought: ['incineroar', 'garchomp'], myLeads: ['incineroar', 'garchomp'], opponentTeam: ['kingambit', 'sneasler'].map(mon), oppBrought: ['kingambit'], oppLeads: ['kingambit'], myArchetype: 'Rain', opponentArchetype: 'Trick Room', createdAt: 1, updatedAt: 1 };
      }
      await page.evaluate((log) => localStorage.setItem('ptb:matches:v1', log), JSON.stringify({ version: 3, state: { matches, order: Object.keys(matches) } }));
      await page.goto('/#matches');
      await page.reload();
      await page.getByRole('heading', { name: /Nemesis/ }).waitFor();
      await expectNoA11yViolations(page);
    });

    test('Speed tiers', async ({ page }) => {
      await importTeam(page, SAMPLE_TEAM);
      await page.goto('/#speed');
      await page.getByRole('list', { name: 'Speed tiers' }).waitFor();
      await page.getByRole('list', { name: 'Speed tiers' }).getByRole('button').first().click();
      await expectNoA11yViolations(page);
    });

    test('Threat report', async ({ page }) => {
      await importTeam(page, SAMPLE_TEAM);
      await page.goto('/#threats');
      await page.getByRole('status').filter({ hasText: /threats calculated/ }).waitFor({ timeout: 30_000 });
      await expectNoA11yViolations(page);
    });

    test('Reverse search', async ({ page }) => {
      await page.goto('/#reverse');
      await page.getByRole('combobox', { name: 'Condition type' }).selectOption({ label: 'One-shots' });
      await pickOption(page, 'Species', 'Rillaboom');
      await page.getByRole('status').filter({ hasText: /Checked \d+ Pokémon/ }).waitFor({ timeout: 30_000 });
      await expectNoA11yViolations(page);
    });

    test('Optimiser panel', async ({ page }) => {
      await importTeam(page, 'Incineroar @ Sitrus Berry\nAbility: Intimidate\nAdamant Nature\n- Flare Blitz\n- Fake Out\n');
      await openStatCalculator(page);
      await page.getByRole('button', { name: 'Optimise', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Optimise spread' });
      await dialog.getByRole('button', { name: 'Survive a move' }).click();
      await dialog.getByRole('button', { name: 'Add goal' }).click();
      await dialog.getByRole('button', { name: 'Knock out' }).click();
      await expectNoA11yViolations(page);
    });

    test('Bring planner', async ({ page }) => {
      await importTeam(page, SIX_TEAM);
      await page.goto('/#matches');
      await page.getByRole('button', { name: 'Log your first match' }).click();
      await page.getByRole('button', { name: 'Saved team', exact: true }).click();
      await page.getByRole('combobox').filter({ hasText: 'pick a saved team' }).selectOption({ index: 1 });
      await page.getByRole('button', { name: 'Plan vs this team' }).click();
      await page.getByRole('textbox', { name: 'Their team as Showdown text' }).fill('Sneasler @ Focus Sash\nAbility: Poison Touch\nJolly Nature\n- Close Combat\n- Dire Claw\n- Fake Out\n- Protect\n\nKingambit @ Black Glasses\nAbility: Defiant\nAdamant Nature\n- Sucker Punch\n- Kowtow Cleave\n- Iron Head\n- Protect\n');
      await page.getByRole('button', { name: 'Load pasted team' }).click();
      await page.getByRole('heading', { name: 'Plan 1' }).waitFor();
      await expectNoA11yViolations(page);
    });

    test('Regulation diff', async ({ page }) => {
      await page.goto('/#regdiff');
      await page.getByRole('table', { name: /Species changes/ }).waitFor();
      await expectNoA11yViolations(page);
    });

    test('Settings with sync on', async ({ page }) => {
      await page.route('**/api/sync**', (route) => (route.request().method() === 'GET' ? route.fulfill({ json: { docs: [], cursor: 0, more: false } }) : route.fulfill({ json: { results: [] } })));
      await page.getByRole('navigation', { name: 'Main' }).locator('visible=true').getByRole('button', { name: /^More/ }).click();
      await page.getByRole('menuitem', { name: /Settings/ }).click();
      const dialog = page.getByRole('dialog', { name: 'Settings & credits' });
      await dialog.getByRole('checkbox', { name: 'Sync with my account' }).check();
      await dialog.getByRole('status').filter({ hasText: /Last sync: / }).waitFor();
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
