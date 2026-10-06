import { expect, test } from '@playwright/test';
import { openApp, setTheme } from './helpers';

test('Meta tab lists the most used Pokémon with where the numbers come from', async ({ page }) => {
  await openApp(page, '#meta');
  // Reg M-B has Smogon's published usage (Reg M-C may still be on provisional numbers).
  await page.getByRole('combobox', { name: 'Regulation' }).selectOption({ label: 'Champions · Reg M-B' });
  const list = page.getByRole('list', { name: /Most used Pokémon in Reg M-B/ });
  await expect(list.getByRole('listitem').first()).toBeVisible();
  await expect(list.getByRole('heading', { level: 2 }).first()).toContainText('Kingambit');
  // Source, month, sample size and when the app's copy was last updated.
  await expect(page.getByRole('link', { name: /Smogon usage statistics/ })).toBeVisible();
  await expect(page.getByText(/rating \d+\+ · [\d,]+ battles · updated /)).toBeVisible();
});

test('Match log: log a match with a result and two opponent Pokémon', async ({ page }) => {
  await openApp(page, '#matches');
  await page.getByRole('button', { name: 'Log your first match' }).click();
  await page.getByRole('combobox', { name: 'Result' }).selectOption({ label: 'Loss' });

  for (const species of ['Kingambit', 'Sneasler']) {
    await page.getByRole('button', { name: 'Add Pokémon' }).last().click();
    const emptyPhone = page.getByRole('button', { name: /^Species: Species seen at Team Preview/ });
    if (await emptyPhone.isVisible()) {
      await emptyPhone.click();
      await page.getByRole('dialog').getByRole('combobox', { name: 'Search Species' }).fill(species);
    } else {
      await page.getByPlaceholder(/Species seen at Team Preview/).fill(species);
    }
    await page.getByRole('listbox', { name: 'Species', exact: true }).getByRole('option').first().click();
  }

  await expect(page.getByRole('heading', { name: 'Overall: 0-1 (0%)' })).toBeVisible();
  const snapshot = page.getByText('Most-seen opponent species').locator('xpath=following-sibling::*[1]');
  await expect(snapshot).toContainText('Kingambit');
  await expect(snapshot).toContainText('Sneasler');
  await expect(page.getByRole('heading', { name: 'Losses (1)' })).toBeVisible();
});

test('Pokédex opens an entry and its Area tab', async ({ page }) => {
  await openApp(page, '#dex');
  await page.getByRole('button', { name: /Kanto/ }).click();
  await page.getByRole('listbox', { name: 'Pokémon' }).getByRole('option', { name: /Pikachu/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Pikachu', level: 2 })).toBeVisible();
  await page.getByRole('button', { name: 'Area', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Where to find Pikachu' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Region map' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Viridian Forest/ })).toBeVisible();
});

test('Pokédex Moves tab: the type filter narrows every list to one type', async ({ page }) => {
  await openApp(page, '#dex');
  await page.getByRole('button', { name: /Kanto/ }).click();
  await page.getByRole('listbox', { name: 'Pokémon' }).getByRole('option', { name: /Pikachu/ }).first().click();
  await page.getByRole('button', { name: 'Moves', exact: true }).click();
  const filter = page.getByRole('group', { name: 'Filter moves by type' });
  const rows = page.getByRole('row');
  const all = await rows.count();
  await filter.getByRole('button', { name: 'Electric moves' }).click();
  await expect(filter.getByRole('button', { name: 'Electric moves' })).toHaveAttribute('aria-pressed', 'true');
  const electric = await rows.count();
  expect(electric).toBeGreaterThan(1);
  expect(electric).toBeLessThan(all);
  await expect(page.getByRole('row').filter({ hasText: 'Thunderbolt' }).first()).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Quick Attack' })).toHaveCount(0);
  await filter.getByRole('button', { name: 'All types' }).click();
  expect(await rows.count()).toBe(all);
});

test('Pokénav: open Platinum, click a place on the map, the location panel opens', async ({ page }) => {
  await openApp(page, '#atlas');
  await page.getByRole('radio', { name: 'Pokémon Platinum' }).check();
  await expect(page.getByRole('tab', { name: 'Map' })).toHaveAttribute('aria-selected', 'true');
  // The place markers sit under the map image, which takes the real pointer events: tap the map itself
  // where the marker is and let the map's own hit-testing pick the place. Not a forced click: that skips
  // the check that nothing covers the point (on phones the fixed tab bar can, depending on how the
  // browser scrolled the map into view), and lands the tap on whatever does.
  const map = page.getByRole('group', { name: /Sinnoh map/ });
  const [m, s] = await Promise.all([map.getByRole('button', { name: 'Route 201', exact: true }).boundingBox(), map.boundingBox()]);
  await map.click({ position: { x: m!.x - s!.x + m!.width / 2, y: m!.y - s!.y + m!.height / 2 } });
  // A side panel on desktop, a sheet on phones.
  const panel = page.getByRole('complementary', { name: 'Location details' }).or(page.getByRole('dialog', { name: 'Route 201' }));
  await expect(panel.getByRole('heading', { name: 'Route 201', level: 2 }).first()).toBeVisible();
  await expect(panel.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
});

test('Pokénav: tapping a place still picks it when the browser sizes the map box differently', async ({ page }) => {
  // WebKit can give the svg another shape than the map (it then letterboxes the map inside it); the
  // tap must still land on the place under it, not on where it would be in a stretched map.
  await openApp(page, '#atlas');
  await page.addStyleTag({ content: 'svg[role="group"] { height: 150px !important; }' });
  await page.getByRole('radio', { name: 'Pokémon Platinum' }).check();
  const map = page.getByRole('group', { name: /Sinnoh map/ });
  const [m, s] = await Promise.all([map.getByRole('button', { name: 'Route 201', exact: true }).boundingBox(), map.boundingBox()]);
  await map.click({ position: { x: m!.x - s!.x + m!.width / 2, y: m!.y - s!.y + m!.height / 2 } });
  const panel = page.getByRole('complementary', { name: 'Location details' }).or(page.getByRole('dialog', { name: 'Route 201' }));
  await expect(panel.getByRole('heading', { name: 'Route 201', level: 2 }).first()).toBeVisible();
});

test('theme toggle switches between light and dark', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('html')).toHaveClass(/dark/);
  await setTheme(page, 'light');
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await setTheme(page, 'dark');
  await expect(page.locator('html')).toHaveClass(/dark/);
});

test('Champions Pokédex: Mega Evolutions filter, a Pokémon\'s Megas side by side, and older regulations', async ({ page }) => {
  await openApp(page, '#dex');
  await page.getByRole('group', { name: 'Pokédex' }).getByRole('button', { name: 'Champions' }).click();
  const list = page.getByRole('listbox', { name: 'Pokémon' });
  const regulation = page.getByRole('combobox', { name: 'Regulation' });

  await page.getByRole('button', { name: 'Mega Evolutions' }).click();
  expect(await list.getByRole('option').count()).toBe(82); // Reg M-C is live
  const texts = await list.getByRole('option').allInnerTexts();
  const at = (name: string) => texts.findIndex((t) => t.includes(`${name}\n`));
  expect(at('Charizard-Mega-Y')).toBe(at('Charizard-Mega-X') + 1);
  expect(at('Garchomp-Mega-Z')).toBe(at('Garchomp-Mega') + 1);
  await expect(list.getByRole('option').filter({ hasText: 'Charizard-Mega-X' })).toContainText('Charizardite X');

  // An older regulation has fewer Megas, and the newest additions are gone.
  const older = (await regulation.locator('option').allInnerTexts()).find((t) => t.includes('M-A'))!;
  await regulation.selectOption({ label: older });
  expect(await list.getByRole('option').count()).toBe(60);
  await expect(list.getByRole('option').filter({ hasText: 'Garchomp-Mega-Z' })).toHaveCount(0);
  await expect(list.getByRole('option').filter({ hasText: 'Garchomp-Mega\n' })).toHaveCount(1);

  // A Mega opens like any other entry, with its Pokémon's moves.
  await list.getByRole('option').filter({ hasText: 'Charizard-Mega-X' }).click();
  await expect(page.getByRole('heading', { name: 'Charizard-Mega-X', level: 2 })).toBeVisible();
  await page.getByRole('button', { name: 'Moves', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Flare Blitz' }).first()).toBeVisible();

  // Back to all Pokémon: Megas are gone from the list. (On a phone the entry hides the list; go back to it first.)
  const back = page.getByRole('button', { name: 'All Pokémon' });
  if (await back.isVisible()) await back.click();
  await page.getByRole('button', { name: 'Pokémon', exact: true }).click();
  await expect(list.getByRole('option').filter({ hasText: '-Mega' })).toHaveCount(0);
});

// Nothing on a main screen may scroll the whole page sideways (wide tables scroll inside their own region).
for (const hash of ['#builder', '#calc', '#analyse/overview', '#analyse/speed', '#analyse/threats', '#analyse/ohko/by', '#analyse/compare', '#dex', '#atlas', '#matches', '#gameday', '#meta', '#reverse', '#regdiff']) {
  test(`${hash} does not scroll sideways`, async ({ page }) => {
    await openApp(page, hash);
    await page.waitForTimeout(500);
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
  });
}
