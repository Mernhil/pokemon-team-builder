import { expect, test, type Page } from '@playwright/test';
import { expectNoA11yViolations, goTo, openApp, setTheme } from './helpers';

const mon = (speciesId: string, over: Record<string, unknown> = {}) => ({
  uid: `uid-${speciesId}-${Math.random().toString(36).slice(2, 8)}`,
  speciesId,
  nature: 'Jolly',
  moves: ['protect', '', '', ''],
  level: 50,
  sp: { hp: 0, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 },
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  ...over,
});
const slots = (...m: ReturnType<typeof mon>[]) => [...m, null, null, null, null, null, null].slice(0, 6);
const team = (id: string, name: string, s: unknown[], over: Record<string, unknown> = {}) => ({ id, name, formatId: 'champions-vgc-reg-mc', slots: s, createdAt: 1_790_000_000_000, updatedAt: 1_790_000_000_000, ...over });

async function seedTeams(page: Page, teams: ReturnType<typeof team>[], activeTeamId: string) {
  const state = { teams: Object.fromEntries(teams.map((t) => [t.id, t])), order: teams.filter((t) => !('groupId' in t)).map((t) => t.id), activeTeamId, theme: 'dark', view: 'builder', battle: {} };
  await page.evaluate((v) => localStorage.setItem('ptb:v1', v), JSON.stringify({ version: 3, state }));
}

test('Compare: two variations side by side, the same-team notice and a set-by-set diff', async ({ page }) => {
  await openApp(page);
  const rain = team('rain', 'Rain', slots(mon('garchomp', { itemId: 'lifeorb', moves: ['earthquake', 'protect', '', ''] }), mon('incineroar')));
  const sun = team('sun', 'Rain', slots(mon('garchomp', { itemId: 'choicescarf', nature: 'Adamant', moves: ['earthquake', 'rockslide', '', ''] }), mon('kingambit')), { groupId: 'rain', variationLabel: 'vs Sun' });
  await seedTeams(page, [rain, sun], 'rain');
  await page.reload();
  await goTo(page, 'Compare teams');
  await expect(page).toHaveURL(/#compare$/);

  // The active team on the left, its variation on the right.
  await expect(page.getByRole('combobox', { name: 'Team A' })).toHaveValue('rain');
  await expect(page.getByRole('combobox', { name: 'Team B' })).toHaveValue('sun');
  await expect(page.getByText('These are variations of the same team')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Defensive type matrix, team A' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Offensive type matrix, team B' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Speeds, fastest first' })).toHaveCount(2);

  await expect(page.getByRole('status').filter({ hasText: '1 changed · 1 only on A · 1 only on B · 0 the same' })).toBeVisible();
  const diff = page.getByRole('list', { name: 'Pokémon compared' });
  const garchomp = diff.getByRole('listitem').filter({ hasText: 'Garchomp' });
  await expect(garchomp).toHaveAttribute('data-status', 'changed');
  await expect(garchomp).toContainText('Life Orb');
  await expect(garchomp).toContainText('Choice Scarf');
  await expect(garchomp).toContainText('Adamant');
  await expect(garchomp).toContainText('Rock Slide');
  await expect(diff.getByRole('listitem').filter({ hasText: 'Incineroar' })).toHaveAttribute('data-status', 'only-a');
  await expect(diff.getByRole('listitem').filter({ hasText: 'Kingambit' })).toHaveAttribute('data-status', 'only-b');

  await page.getByRole('button', { name: 'Swap the two teams' }).click();
  await expect(page.getByRole('combobox', { name: 'Team A' })).toHaveValue('sun');
  await expect(diff.getByRole('listitem').filter({ hasText: 'Incineroar' })).toHaveAttribute('data-status', 'only-b');
});

test('Compare needs two teams', async ({ page }) => {
  await openApp(page, '#compare');
  await expect(page.getByText('You need two teams to compare')).toBeVisible();
});

const OWNER = 'ash@example.com';
const sharedRoot = () => team('shared-root', 'Rain', slots(mon('pelipper'), mon('garchomp')), { updatedAt: Date.now() - 3_600_000 });
const sharedVar = () => team('shared-var', 'Rain', slots(mon('pelipper')), { groupId: 'shared-root', variationLabel: 'vs Sun', updatedAt: Date.now() - 3_000_000 });

/** A fake server where Ash shared a folder (a team and one variation) with me. */
async function fakeSharing(page: Page, role: 'view' | 'edit') {
  const doc = (t: ReturnType<typeof team>, seq: number) => ({ id: t.id, kind: 'team', updatedAt: t.updatedAt, deleted: false, json: t, seq, owner: OWNER, role });
  await page.route('**/api/sync**', (route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fulfill({ json: { docs: [], cursor: 0, more: false } });
    const body = req.postDataJSON() as { docs: { id: string; kind: string }[] };
    return route.fulfill({ json: { results: body.docs.map((d) => ({ id: d.id, kind: d.kind, status: 'applied' })) } });
  });
  await page.route('**/api/shares', (route) =>
    route.fulfill({
      json: { me: { email: 'me@example.com' }, granted: [], received: [{ owner: OWNER, grantee: 'me@example.com', kind: 'team-group', ref: 'shared-root', role }], names: { [OWNER]: 'Ash' } },
    }),
  );
  await page.route('**/api/shared', (route) => route.fulfill({ json: { docs: [doc(sharedRoot(), 1), doc(sharedVar(), 2)], names: { [OWNER]: 'Ash' } } }));
}

async function enableSync(page: Page) {
  await page.getByRole('navigation', { name: 'Main' }).locator('visible=true').getByRole('button', { name: /^More|^Match log|^Meta|^Speed tiers|^Threat report|^Regulation diff|^Compare teams/ }).click();
  await page.getByRole('menuitem', { name: /Settings/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings & credits' });
  await dialog.getByRole('checkbox', { name: 'Sync with my account' }).check();
  await expect(dialog.getByRole('status').filter({ hasText: /Last sync: / })).toBeVisible();
  return dialog;
}

const openSavedTeams = async (page: Page) => {
  await page.getByRole('button', { name: 'Team actions' }).click();
  await page.getByRole('menuitem', { name: 'Saved teams' }).click();
  return page.getByRole('dialog', { name: 'Saved teams' });
};

test('A team shared view-only: it shows who it is from, opens read-only, and “Make my own copy” makes it mine', async ({ page }) => {
  await openApp(page);
  await fakeSharing(page, 'view');
  const settings = await enableSync(page);
  await expect(settings.getByRole('list', { name: 'Shared with me' })).toContainText('from Ash');
  await expect(page.getByText('Ash shared “Rain” with you.')).toBeVisible();
  await page.keyboard.press('Escape');

  const saved = await openSavedTeams(page);
  const section = saved.getByRole('region', { name: 'Shared with me' });
  await expect(section).toContainText('From Ash');
  await expect(section).toContainText('View only');
  await expect(section).toContainText('2 variations');
  // not in "my" list, and nothing to delete or rename there
  await expect(section.getByRole('button', { name: /^Delete/ })).toHaveCount(0);
  await section.getByRole('button', { name: /^Open Rain, shared by Ash/ }).click();

  await expect(page.getByText('Shared by Ash: view only')).toBeVisible();

  await page.getByRole('button', { name: 'Make my own copy' }).click();
  await expect(page.getByText('Shared by Ash: view only')).toHaveCount(0);
  const again = await openSavedTeams(page);
  await expect(again.getByRole('button', { name: 'Open Rain', exact: true })).toBeVisible(); // my copy, in my own list
});

test('A team shared with edit rights says so, and a variation added to it belongs to the folder', async ({ page }) => {
  await openApp(page);
  await fakeSharing(page, 'edit');
  await enableSync(page);
  await page.keyboard.press('Escape');
  const saved = await openSavedTeams(page);
  await expect(saved.getByRole('region', { name: 'Shared with me' })).toContainText('Can edit');
  await saved.getByRole('button', { name: /^Open Rain, shared by Ash/ }).click();
  await expect(page.getByText('Shared by Ash: you can edit')).toBeVisible();
});

test('Sharing a team needs sync: the share button is there once sync is on, and the dialog asks for an e-mail', async ({ page }) => {
  await openApp(page);
  await fakeSharing(page, 'view');
  let put: unknown;
  await page.unroute('**/api/shares');
  await page.route('**/api/shares', async (route) => {
    const req = route.request();
    if (req.method() === 'PUT') put = req.postDataJSON();
    const granted = put ? [{ owner: 'me@example.com', grantee: 'friend@example.com', kind: 'team-group', ref: (put as { ref: string }).ref, role: 'edit' }] : [];
    return route.fulfill({ json: { me: { email: 'me@example.com' }, granted, received: [], names: {} } });
  });
  // sharing is only offered once sync is on
  const before = await openSavedTeams(page);
  await expect(before.getByRole('button', { name: /^Share / })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await enableSync(page);
  await page.keyboard.press('Escape');
  const saved = await openSavedTeams(page);
  await saved.getByRole('button', { name: /^Share / }).first().click();
  const dialog = page.getByRole('dialog', { name: /^Share “/ });
  await expect(dialog.getByRole('button', { name: 'Share', exact: true })).toBeDisabled(); // until an address is typed
  await dialog.getByRole('textbox', { name: 'Their e-mail address' }).fill('not an address');
  await dialog.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('e-mail address');
  await dialog.getByRole('textbox', { name: 'Their e-mail address' }).fill('Friend@Example.com');
  await dialog.getByRole('combobox', { name: 'What they can do' }).selectOption('edit');
  await dialog.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(dialog.getByRole('list', { name: 'Shared with' })).toContainText('friend@example.com');
  expect(put).toMatchObject({ kind: 'team-group', grantee: 'friend@example.com', role: 'edit' });
});

for (const theme of ['light', 'dark'] as const) {
  test(`axe: Compare and a shared team, ${theme} theme`, async ({ page }) => {
    await openApp(page);
    await setTheme(page, theme);
    await fakeSharing(page, 'view');
    const rain = team('rain', 'Rain', slots(mon('garchomp', { itemId: 'lifeorb' }), mon('incineroar')));
    const sun = team('sun', 'Rain', slots(mon('garchomp', { itemId: 'choicescarf' })), { groupId: 'rain', variationLabel: 'vs Sun' });
    await seedTeams(page, [rain, sun], 'rain');
    await page.reload();
    await goTo(page, 'Compare teams');
    await page.getByRole('list', { name: 'Pokémon compared' }).waitFor();
    await expectNoA11yViolations(page);

    await enableSync(page);
    await page.keyboard.press('Escape');
    const saved = await openSavedTeams(page);
    await saved.getByRole('button', { name: /^Open Rain, shared by Ash/ }).click();
    await goTo(page, 'Build');
    await page.getByText('Shared by Ash: view only').waitFor();
    await expectNoA11yViolations(page);
  });
}
