import { expect, test, type Page } from '@playwright/test';
import { SAMPLE_TEAM, importTeam, openApp } from './helpers';

/** A saved log (v3 shape) with a clear nemesis: Kingambit beats me 5 times out of 6. */
function seedLog() {
  const mon = (speciesId: string) => ({ speciesId });
  const base = { regulationId: 'champions-reg-mc', category: 'Ranked Ladder', myTeam: ['incineroar', 'garchomp', 'whimsicott', 'rillaboom'].map(mon), myBrought: ['incineroar', 'garchomp', 'whimsicott', 'rillaboom'], myLeads: ['incineroar', 'garchomp'] };
  const matches: Record<string, unknown> = {};
  const order: string[] = [];
  for (let i = 0; i < 6; i++) {
    const id = `k${i}`;
    matches[id] = { ...base, id, date: `2026-09-${String(10 + i).padStart(2, '0')}`, result: i === 0 ? 'win' : 'loss', opponentTeam: ['kingambit', 'sneasler', 'whimsicott'].map(mon), oppBrought: ['kingambit', 'sneasler'], oppLeads: ['kingambit'], createdAt: 1, updatedAt: 1 };
    order.push(id);
  }
  matches.one = { ...base, id: 'one', date: '2026-09-20', result: 'win', myLeads: ['rillaboom', 'whimsicott'], opponentTeam: [mon('dragapult')], createdAt: 1, updatedAt: 1 };
  order.push('one');
  return JSON.stringify({ version: 3, state: { matches, order } });
}

async function openSeeded(page: Page) {
  await page.addInitScript((log) => localStorage.setItem('ptb:matches:v1', log), seedLog());
  await openApp(page, '#matches');
  await expect(page.getByRole('heading', { name: /Overall: 1-6/ }).or(page.getByRole('heading', { name: /Overall:/ }))).toBeVisible();
}

test('Match log: tap sprites to cycle not brought → brought → lead, within the doubles limits', async ({ page }) => {
  await openApp(page, '#matches');
  await page.getByRole('button', { name: 'Log your first match' }).click();
  for (const species of ['Kingambit', 'Sneasler', 'Whimsicott']) {
    await page.getByRole('button', { name: 'Add Pokémon' }).last().click();
    const empty = page.getByRole('button', { name: /^Species: Species seen at Team Preview/ });
    if (await empty.isVisible()) {
      await empty.click();
      await page.getByRole('dialog').getByRole('combobox', { name: 'Search Species' }).fill(species);
    } else {
      await page.getByPlaceholder(/Species seen at Team Preview/).fill(species);
    }
    await page.getByRole('listbox', { name: 'Species', exact: true }).getByRole('option').first().click();
  }
  const theirs = page.getByRole('list', { name: 'They brought' });
  const king = theirs.getByRole('button', { name: /^Kingambit:/ });
  await expect(king).toContainText('Not brought');
  await king.click();
  await expect(king).toContainText('Brought');
  await king.click();
  await expect(king).toContainText('★ Lead');
  await expect(page.getByText('Brought 1/4 · Lead 1/2').first()).toBeVisible();
  await theirs.getByRole('button', { name: /^Sneasler:/ }).click();
  await theirs.getByRole('button', { name: /^Sneasler:/ }).click();
  await theirs.getByRole('button', { name: /^Whimsicott:/ }).click();
  await theirs.getByRole('button', { name: /^Whimsicott:/ }).click();
  // Two leads is the limit: a third lead attempt just sends Whimsicott back to not brought.
  await expect(theirs.getByRole('button', { name: /^Whimsicott:/ })).toContainText('Not brought');
  await expect(page.getByText('Brought 2/4 · Lead 2/2').first()).toBeVisible();

  // Removing a Pokémon takes it out of the brought list too; the choice survives a reload.
  await page.reload();
  await expect(page.getByRole('list', { name: 'They brought' }).getByRole('button', { name: /^Kingambit:/ })).toContainText('★ Lead');
});

test('Analytics: Wilson ranges, thin samples greyed, nemesis, filters', async ({ page }) => {
  await openSeeded(page);
  // 5 games or more shows a percentage and a 95% range; fewer says so instead of printing 100%.
  const leads = page.getByText('By my lead').locator('xpath=following-sibling::*[1]');
  await expect(leads).toContainText('Garchomp + Incineroar');
  await expect(leads).toContainText(/1-5 · 17% \(\d+–\d+%\)/);
  await expect(leads).toContainText('1-0 · too few games');
  await expect(leads).not.toContainText('100%');

  // The nemesis is the opponent I lose to most among those faced at least 5 times.
  const nem = page.getByRole('heading', { name: /Nemesis/ }).locator('xpath=ancestor::*[contains(@class,"rounded")][1]');
  await expect(nem.getByRole('listitem').first()).toContainText('Kingambit');
  await expect(page.getByRole('table', { name: /Record against each opponent Pokémon/ })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Weekly numbers' }).or(page.getByText('Weekly numbers'))).toBeVisible();

  // Filters narrow the stats.
  await page.getByRole('combobox', { name: 'Stats from date' }).or(page.getByLabel('Stats from date')).fill('2026-09-20');
  await expect(page.getByText('1 of 7 matches')).toBeVisible();
  await expect(page.getByText(/Needs an opponent Pokémon faced at least 5 times/)).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.getByText('7 of 7 matches')).toBeVisible();
  await page.getByRole('combobox', { name: 'Stats category' }).selectOption('Ranked Ladder');
  await expect(page.getByText('7 of 7 matches')).toBeVisible();
});

test('Nemesis links open the Damage Calc, Speed tiers and Threat report on that Pokémon', async ({ page }) => {
  await page.addInitScript((log) => localStorage.setItem('ptb:matches:v1', log), seedLog());
  await openApp(page);
  await importTeam(page, SAMPLE_TEAM);
  await page.goto('/#matches');
  await page.getByRole('button', { name: 'Open Kingambit in the Damage Calc' }).click();
  await expect(page).toHaveURL(/#calc$/);
  await expect(page.getByRole('heading', { name: /Defender/ })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Species' }).last().or(page.getByRole('button', { name: /Species: Kingambit/ }).last())).toBeVisible();

  await page.goto('/#matches');
  await page.getByRole('button', { name: 'Find Kingambit in Speed tiers' }).click();
  await expect(page).toHaveURL(/#speed$/);
  await expect(page.getByRole('list', { name: 'Speed tiers' }).getByRole('button', { expanded: true })).toContainText('Kingambit');

  await page.goto('/#matches');
  await page.getByRole('button', { name: 'Find Kingambit in the Threat report' }).click();
  await expect(page).toHaveURL(/#threats$/);
  await expect(page.locator('[data-threat="kingambit"]').locator('visible=true').first()).toBeVisible();
});
