import { expect, test, type Page } from '@playwright/test';
import { FIRE_TEAM, SAMPLE_TEAM, expectNoA11yViolations, goTo, importTeam, openApp, setTheme } from './helpers';

const T0 = 1_790_000_000_000;
const mon = (speciesId: string, moves: string[] = ['protect']) => ({ uid: `uid-${speciesId}`, speciesId, nature: 'Jolly', moves, abilityId: '', itemId: '', sp: { hp: 0, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 } });
const teamJson = (id: string, name: string, over: object = {}) => ({ id, name, formatId: 'champions-vgc-reg-mc', slots: [mon('garchomp', ['earthquake']), mon('incineroar', ['fakeout']), null, null, null, null], createdAt: T0, updatedAt: T0, ...over });
const teamDoc = (t: { id: string; updatedAt: number }) => ({ id: t.id, kind: 'team', updatedAt: t.updatedAt, deleted: false, json: t, seq: 1 });
const matchJson = (id: string, result: 'win' | 'loss', opp: string[]) => ({
  id, date: '2026-09-15', result, regulationId: 'champions-reg-mc', category: 'Ranked Ladder', opponentTeam: opp.map((speciesId) => ({ speciesId })), createdAt: T0, updatedAt: T0,
});

interface Fake {
  shared: { you: { email: string; displayName: string }; folders: unknown[]; matches: unknown[] };
  mine: { email: string; displayName: string; outgoing: { folderId: string; grantee: string; role: string }[]; matchGrantees: string[] };
  ops: Record<string, unknown>[];
}
const fresh = (): Fake => ({ shared: { you: { email: 'me@example.com', displayName: '' }, folders: [], matches: [] }, mine: { email: 'me@example.com', displayName: '', outgoing: [], matchGrantees: [] }, ops: [] });

/** The Worker's three routes, faked: my own documents (empty), what is shared with me, and my sharing settings. */
async function fakeServer(page: Page, f: Fake) {
  await page.route('**/api/sync**', (route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fulfill({ json: { docs: [], cursor: 0, more: false } });
    const body = req.postDataJSON() as { docs: { id: string; kind: string }[] };
    return route.fulfill({ json: { results: body.docs.map((d) => ({ id: d.id, kind: d.kind, status: 'applied' })) } });
  });
  await page.route('**/api/shared', (route) => (route.request().method() === 'GET' ? route.fulfill({ json: f.shared }) : route.fulfill({ json: { results: [] } })));
  await page.route('**/api/shares', (route) => {
    if (route.request().method() === 'POST') {
      const op = route.request().postDataJSON() as Record<string, string | boolean>;
      f.ops.push(op);
      if (op.op === 'profile') f.mine.displayName = String(op.displayName);
      if (op.op === 'shareMatches') f.mine.matchGrantees = op.enabled ? [...new Set([...f.mine.matchGrantees, String(op.grantee)])] : f.mine.matchGrantees.filter((g) => g !== op.grantee);
      if (op.op === 'share') f.mine.outgoing = [...f.mine.outgoing.filter((o) => !(o.folderId === op.folderId && o.grantee === op.grantee)), { folderId: String(op.folderId), grantee: String(op.grantee), role: String(op.role) }];
      if (op.op === 'unshare') f.mine.outgoing = f.mine.outgoing.filter((o) => !(o.folderId === op.folderId && o.grantee === op.grantee));
    }
    return route.fulfill({ json: f.mine });
  });
}

async function openSyncedApp(page: Page, f: Fake, hash = '') {
  await page.addInitScript(() => {
    if (!localStorage.getItem('ptb:sync:v1')) localStorage.setItem('ptb:sync:v1', JSON.stringify({ state: { enabled: true, deviceName: 'Test device', cursor: 0, known: {} }, version: 1 }));
  });
  await fakeServer(page, f);
  await openApp(page, hash);
}

const sharedFolder = (role: 'view' | 'edit', docs: unknown[]) => ({ owner: 'ash@example.com', ownerName: 'Ash', folderId: 'ash-root', role, docs });
const ROOT = teamJson('ash-root', 'Rain M-C');
const VARIATION = teamJson('ash-var', 'Rain M-C', { groupId: 'ash-root', variationLabel: 'vs Sun' });

async function openSavedTeams(page: Page) {
  await page.getByRole('button', { name: 'Team actions' }).click();
  await page.getByRole('menuitem', { name: 'Saved teams' }).click();
  return page.getByRole('dialog', { name: 'Saved teams' });
}

test('A team shared view-only: it appears under "Shared with me", opens read-only, and "Make my own copy" makes it mine', async ({ page }) => {
  const f = fresh();
  f.shared.folders = [sharedFolder('view', [teamDoc(ROOT), teamDoc(VARIATION)])];
  await openSyncedApp(page, f);
  await expect(page.getByText(/Ash shared a team with you \(view only\)/)).toBeVisible();

  const teams = await openSavedTeams(page);
  const section = teams.getByRole('region', { name: 'Shared with me' }).or(teams.locator('section[aria-labelledby="shared-with-me"]'));
  await expect(section).toContainText('Rain M-C');
  await expect(section).toContainText('View only');
  await expect(section).toContainText('From Ash');
  await expectNoA11yViolations(page);
  await section.getByRole('button', { name: 'Open Rain M-C (shared)' }).click();

  const banner = page.getByRole('status').filter({ hasText: 'Shared by Ash · view only' });
  await expect(banner).toBeVisible();
  // Nothing in the set editor can be changed.
  const editor = page.getByRole('group', { name: /Selected Pokémon \(view only\)/ });
  await expect(editor).toBeVisible();
  await expect(editor.locator('button:enabled, input:enabled, select:enabled, textarea:enabled')).toHaveCount(0);
  await expectNoA11yViolations(page);
  await setTheme(page, 'light');
  await expectNoA11yViolations(page);

  await banner.getByRole('button', { name: 'Make my own copy' }).click();
  await expect(page.getByText(/Made your own copy of “Rain M-C”/)).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /^Shared by Ash/ })).toHaveCount(0);
  await expect(page.getByRole('group', { name: /^Selected Pokémon$/ }).locator('button:enabled, input:enabled').first()).toBeVisible();

  // The copy is in my own list; the shared one is still in "Shared with me".
  const again = await openSavedTeams(page);
  await expect(again.getByRole('button', { name: 'Open Rain M-C (copy)', exact: true })).toBeVisible();
  await expect(again.locator('section[aria-labelledby="shared-with-me"]')).toContainText('Rain M-C');
});

test('A team shared as editable says so, and a later change by the owner shows a toast with who and when', async ({ page }) => {
  const f = fresh();
  f.shared.folders = [sharedFolder('edit', [teamDoc(ROOT), teamDoc(VARIATION)])];
  await openSyncedApp(page, f);
  await expect(page.getByText(/shared a team with you \(you can edit it\)/)).toBeVisible();
  const teams = await openSavedTeams(page);
  await teams.getByRole('button', { name: 'Open Rain M-C (shared)' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Shared by Ash · you can edit' })).toBeVisible();
  await expect(page.getByRole('group', { name: /^Selected Pokémon$/ })).toBeEnabled();

  // The owner changes the variation; the next sync (when the window regains focus) announces it.
  const newer = teamJson('ash-var', 'Rain M-C (tweaked)', { groupId: 'ash-root', variationLabel: 'vs Sun', updatedAt: Date.now() - 2 * 3_600_000 });
  f.shared.folders = [sharedFolder('edit', [teamDoc(ROOT), teamDoc(newer)])];
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('Ash updated “Rain M-C (tweaked)” 2 h ago')).toBeVisible();
});

test('When a share is withdrawn, its teams leave this device', async ({ page }) => {
  const f = fresh();
  f.shared.folders = [sharedFolder('view', [teamDoc(ROOT)])];
  await openSyncedApp(page, f);
  await expect(page.getByText(/shared a team with you/)).toBeVisible();
  f.shared.folders = [];
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText(/“Rain M-C” is no longer shared with you/)).toBeVisible();
  const teams = await openSavedTeams(page);
  await expect(teams.locator('section[aria-labelledby="shared-with-me"]')).toHaveCount(0);
});

test('Compare: two variations of one team are called out, the diff lists what changed, and the view has no a11y problems', async ({ page }) => {
  await openApp(page);
  await importTeam(page, SAMPLE_TEAM);
  const teams = await openSavedTeams(page);
  await teams.getByRole('button', { name: 'Add variation' }).first().click();
  await page.keyboard.press('Escape');
  await openApp(page, '#compare');

  await expect(page.getByRole('combobox', { name: 'Team A' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Team B' })).toBeVisible();
  await expect(page.getByText('Two variations of the same team')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Set differences' })).toContainText('Identical sets');
  await expect(page.getByRole('table', { name: /Defensive/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Speed against the meta' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Threat report' })).toBeVisible();
  await expectNoA11yViolations(page);
});

test('Compare: two different teams show what is only on one side, swapping works, in both themes', async ({ page }) => {
  await openApp(page);
  await importTeam(page, SAMPLE_TEAM);
  await importTeam(page, FIRE_TEAM);
  await openApp(page, '#compare');
  const a = page.getByRole('combobox', { name: 'Team A' });
  const b = page.getByRole('combobox', { name: 'Team B' });
  await expect(a).toBeVisible();
  const [aBefore, bBefore] = [await a.inputValue(), await b.inputValue()];
  expect(aBefore).not.toBe(bBefore);
  await expect(page.getByText('Two variations of the same team')).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Set differences' }).locator('> li').first()).toBeVisible();
  await page.getByRole('button', { name: 'Swap the two teams' }).click();
  await expect(a).toHaveValue(bBefore);
  await expect(b).toHaveValue(aBefore);
  await expectNoA11yViolations(page);
  await setTheme(page, 'light');
  await expectNoA11yViolations(page);
});

test('Match log: a friend’s matches are separate until I pick "Both of us"', async ({ page }) => {
  const mine = { m1: { ...matchJson('m1', 'win', ['kingambit']) }, m2: { ...matchJson('m2', 'win', ['sneasler']) } };
  await page.addInitScript((log) => localStorage.setItem('ptb:matches:v1', log), JSON.stringify({ version: 3, state: { matches: mine, order: ['m1', 'm2'] } }));
  const f = fresh();
  f.shared.matches = [{ owner: 'ash@example.com', ownerName: 'Ash', docs: ['f1', 'f2', 'f3'].map((id) => ({ id, kind: 'match', updatedAt: T0, deleted: false, json: matchJson(id, 'loss', ['dragapult']), seq: 1 })) }];
  await openSyncedApp(page, f, '#matches');

  const whose = page.getByRole('combobox', { name: 'Whose matches' });
  await expect(whose).toBeVisible();
  await expect(whose).toHaveValue('mine');
  await expect(page.getByRole('heading', { name: /^Overall: 2-0/ })).toBeVisible();

  await whose.selectOption('friend:ash@example.com');
  await expect(page.getByRole('heading', { name: /^Overall: 0-3/ })).toBeVisible();
  await expect(page.getByText(/Ash.s matches, read-only/)).toBeVisible();
  await expect(page.getByRole('heading', { name: /Ash.s match/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Log match' })).toBeVisible();
  await expectNoA11yViolations(page);

  await whose.selectOption('both:ash@example.com');
  await expect(page.getByRole('heading', { name: /^Overall: 2-3/ })).toBeVisible();
  await expect(page.getByText(/count both of your logs together/)).toBeVisible();

  // Meta has no published numbers for this regulation, so it falls back to the logs, with the same choice.
  await goTo(page, 'Meta');
  const metaSource = page.getByRole('combobox', { name: 'Whose matches' });
  await expect(metaSource).toHaveValue('mine');
  await expect(page.getByText(/Showing what you.ve faced in your own 2 logged matches/)).toBeVisible();
  await metaSource.selectOption('both:ash@example.com');
  await expect(page.getByText(/what the two of you faced in 5 logged matches/)).toBeVisible();
});

test('Settings: display name, sharing my match log, and sharing a team folder', async ({ page }) => {
  const f = fresh();
  await openSyncedApp(page, f);
  await page.getByRole('navigation', { name: 'Main' }).locator('visible=true').getByRole('button', { name: /^More|^Match log|^Meta|^Speed tiers|^Threat report|^Regulation diff|^Compare teams/ }).click();
  await page.getByRole('menuitem', { name: /Settings/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings & credits' });

  const name = dialog.getByRole('textbox', { name: 'Display name' });
  await expect(name).toBeVisible();
  await expect(dialog.getByText('You are signed in as me@example.com.')).toBeVisible();
  await name.fill('Misty');
  await name.blur();
  await expect.poll(() => f.ops.find((o) => o.op === 'profile')?.displayName).toBe('Misty');

  const email = dialog.getByRole('textbox', { name: 'E-mail to share my matches with' });
  await email.fill('not an email');
  await dialog.getByRole('button', { name: 'Share my matches' }).click();
  await expect(dialog.getByRole('alert').filter({ hasText: 'doesn’t look like an e-mail' })).toBeVisible();
  await email.fill('Ash@Example.com');
  await dialog.getByRole('button', { name: 'Share my matches' }).click();
  const list = dialog.getByRole('list', { name: 'People who can see my matches' });
  await expect(list).toContainText('ash@example.com');
  await expectNoA11yViolations(page);
  await list.getByRole('button', { name: 'Stop sharing my matches with ash@example.com' }).click();
  await expect(list).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Share a folder from Saved teams.
  const teams = await openSavedTeams(page);
  await teams.getByRole('button', { name: /^Share / }).first().click();
  const share = page.getByRole('dialog', { name: /^Share “/ });
  await share.getByRole('textbox', { name: 'E-mail to share with' }).fill('ash@example.com');
  await share.getByRole('combobox', { name: 'What they can do' }).selectOption('edit');
  await share.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(share.getByRole('list').getByText('ash@example.com')).toBeVisible();
  expect(f.ops.find((o) => o.op === 'share')).toMatchObject({ grantee: 'ash@example.com', role: 'edit' });
  await expectNoA11yViolations(page);
  await share.getByRole('button', { name: 'Stop sharing with ash@example.com' }).click();
  await expect(share.getByText('Nobody yet.')).toBeVisible();
});
