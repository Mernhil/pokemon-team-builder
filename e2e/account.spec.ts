import { pbkdf2Sync } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { expectNoA11yViolations, openApp } from './helpers';

const USER = { id: 'u_test', username: 'ash', role: 'user' };
const PW = 'correct horse battery';
const SALT = 'AAAAAAAAAAAAAAAAAAAAAA';
const ROUNDS = 100_000;
const keyOf = (password: string) => pbkdf2Sync(password.normalize('NFKC'), Buffer.from(SALT, 'base64url'), ROUNDS, 32, 'sha256').toString('base64url');
const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 640;

/** A fake account server: /api/me, params, signup, login, logout and the devices list. Records every body sent. */
async function fakeAccounts(page: Page, { signedIn = false } = {}) {
  const state = {
    signedIn,
    bodies: [] as string[],
    sessions: [
      { id: 's1', name: 'Chrome on Windows', kind: 'web', createdAt: Date.now() - 86_400_000, lastSeenAt: Date.now(), current: true },
      { id: 's2', name: 'My laptop', kind: 'desktop', createdAt: Date.now() - 86_400_000, lastSeenAt: Date.now() - 3_600_000, current: false },
    ],
  };
  const json = (status: number, body: unknown) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/me', (r) => r.fulfill(state.signedIn ? json(200, { user: USER }) : json(401, { error: 'not signed in' })));
  await page.route('**/api/auth/params', (r) => {
    state.bodies.push(r.request().postData() ?? '');
    return r.fulfill(json(200, { salt: SALT, iterations: ROUNDS }));
  });
  await page.route('**/api/auth/signup', (r) => {
    state.bodies.push(r.request().postData() ?? '');
    state.signedIn = true;
    return r.fulfill(json(200, { user: USER, expiresAt: Date.now() + 1e9, recoveryCode: 'ABCDE-FGHJK-LMNPQ-RSTUV' }));
  });
  await page.route('**/api/auth/login', (r) => {
    const body = r.request().postData() ?? '';
    state.bodies.push(body);
    if ((JSON.parse(body) as { key: string }).key !== keyOf(PW)) return r.fulfill(json(401, { error: 'Wrong username or password.' }));
    state.signedIn = true;
    return r.fulfill(json(200, { user: USER, expiresAt: Date.now() + 1e9 }));
  });
  await page.route('**/api/auth/logout', (r) => {
    state.signedIn = false;
    return r.fulfill(json(200, { ok: true }));
  });
  await page.route('**/api/sessions', (r) => {
    if (r.request().method() === 'DELETE') {
      const { id } = r.request().postDataJSON() as { id: string };
      state.sessions = state.sessions.filter((s) => s.id !== id);
    }
    return r.fulfill(json(200, { sessions: state.sessions }));
  });
  return state;
}

/** This device remembers being signed in (as after an earlier login). */
async function rememberSignedIn(page: Page) {
  await page.addInitScript((user) => {
    if (!localStorage.getItem('ptb:session:v1')) localStorage.setItem('ptb:session:v1', JSON.stringify({ state: { user, cardDismissed: true }, version: 1 }));
  }, USER);
}

const accountSection = (page: Page) => page.getByRole('dialog', { name: 'Settings & credits' }).getByRole('region', { name: 'Account' });
/** Open the app on #account: Settings opens there (over the page, which a dialog hides from the accessibility tree). */
async function openAccount(page: Page) {
  await page.goto('/#account');
  await expect(accountSection(page)).toBeVisible();
}

test('the first-run card shows once the server has accounts, and “Not now” hides it for good', async ({ page }) => {
  await fakeAccounts(page);
  await openApp(page);
  const card = page.getByRole('complementary', { name: 'Make an account' });
  await expect(card).toContainText('Make an account to sync and share');
  await card.getByRole('button', { name: 'Not now' }).click();
  await expect(card).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeAttached();
  await expect(card).toHaveCount(0);
});

test('without accounts on the server there is no card, and Settings → Account says so', async ({ page }) => {
  await openAccount(page);
  await expect(accountSection(page)).toContainText('Accounts aren’t switched on for this server yet');
  await expect(page.getByRole('complementary', { name: 'Make an account' })).toHaveCount(0);
});

test('create an account: the password never leaves the page, the recovery code is shown once', async ({ page }) => {
  const server = await fakeAccounts(page);
  await openApp(page);
  await page.getByRole('complementary', { name: 'Make an account' }).getByRole('button', { name: 'Make an account' }).click();
  const section = accountSection(page);
  const form = section.getByRole('form', { name: 'Create account' });
  // What password managers and phones need.
  await expect(form.getByLabel('Username')).toHaveAttribute('autocomplete', 'username');
  await expect(form.getByLabel('Username')).toHaveAttribute('name', 'username');
  await expect(form.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'password');
  await expect(form.getByLabel('Password', { exact: true })).toHaveAttribute('autocomplete', 'new-password');
  if (isPhone(page)) for (const field of await form.locator('input:not([type=checkbox])').all()) expect(await field.evaluate((e) => getComputedStyle(e).fontSize)).toBe('16px');

  await form.getByLabel('Invite code').fill('k7qm-3xwd-9ptr');
  await form.getByLabel('Username').fill('ash');
  await form.getByLabel('Password', { exact: true }).fill(PW);
  await form.getByRole('button', { name: 'Create account' }).click();

  await expect(section.getByTestId('recovery-code')).toHaveText('ABCDE-FGHJK-LMNPQ-RSTUV');
  const go = section.getByRole('button', { name: 'Continue' });
  await expect(go).toBeDisabled();
  await section.getByRole('checkbox', { name: 'I saved it' }).check();
  await go.click();
  await expect(section).toContainText('Signed in as ash');
  await expect(section.getByRole('listitem').filter({ hasText: 'My laptop' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Make an account' })).toHaveCount(0);

  expect(server.bodies.length).toBeGreaterThan(0);
  for (const b of server.bodies) expect(b).not.toContain(PW);
  // The recovery code is not kept on the device.
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('ABCDE');
  await expectNoA11yViolations(page);
});

test('log in: a wrong password says so, the right one signs in, log out signs out', async ({ page }) => {
  await fakeAccounts(page);
  await openAccount(page);
  const section = accountSection(page);
  await section.getByRole('tab', { name: 'Log in' }).click();
  const form = section.getByRole('form', { name: 'Log in' });
  await expect(form.getByLabel('Password', { exact: true })).toHaveAttribute('autocomplete', 'current-password');
  await form.getByLabel('Username').fill('ash');
  await form.getByLabel('Password', { exact: true }).fill('not my password');
  await form.getByRole('button', { name: 'Log in' }).click();
  await expect(form.getByRole('alert')).toHaveText('Wrong username or password.');

  await form.getByLabel('Password', { exact: true }).fill(PW);
  await form.getByRole('button', { name: 'Log in' }).click();
  await expect(section).toContainText('Signed in as ash');
  await expectNoA11yViolations(page);

  await section.getByRole('button', { name: 'Log out', exact: true }).click();
  await expect(section.getByRole('tab', { name: 'Create account' })).toBeVisible();
});

test('a session that ended: the banner opens the login dialog in place', async ({ page }) => {
  await rememberSignedIn(page);
  await fakeAccounts(page, { signedIn: false });
  await openApp(page, '#calc');
  const banner = page.getByRole('alert').filter({ hasText: 'Your sign-in has expired' });
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: 'Sign in again' }).click();
  const dialog = page.getByRole('dialog', { name: 'Sign in again' });
  await expect(dialog.getByLabel('Username')).toHaveValue('ash');
  await dialog.getByLabel('Password', { exact: true }).fill(PW);
  await dialog.getByRole('button', { name: 'Log in' }).click();
  await expect(dialog).toBeHidden();
  await expect(banner).toHaveCount(0);
  await expect(page).toHaveURL(/#calc$/);
});

test('devices: sign another device out, after asking', async ({ page }) => {
  await rememberSignedIn(page);
  const server = await fakeAccounts(page, { signedIn: true });
  await openAccount(page);
  const section = accountSection(page);
  await expect(section.getByRole('listitem').filter({ hasText: 'This device' })).toContainText('Chrome on Windows');
  await section.getByRole('button', { name: 'Sign out My laptop' }).click();
  await section.getByRole('alert').getByRole('button', { name: 'Sign out' }).click();
  await expect(section.getByRole('listitem').filter({ hasText: 'My laptop' })).toHaveCount(0);
  expect(server.sessions.map((s) => s.id)).toEqual(['s1']);
});

test('the account forms fit a 320 px phone', async ({ page }) => {
  await fakeAccounts(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await openAccount(page);
  await expect(accountSection(page).getByRole('form', { name: 'Create account' })).toBeVisible();
  const dialog = page.getByRole('dialog', { name: 'Settings & credits' });
  for (const [w, sel] of [[320, dialog], [430, dialog]] as const) {
    await page.setViewportSize({ width: w, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(w);
    expect(await sel.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  }
});

test('Admin: make an invite (the code shown once), disable an account after asking, a reset code that needs my password', async ({ page }) => {
  const admin = { ...USER, role: 'admin' };
  await page.addInitScript((user) => localStorage.setItem('ptb:session:v1', JSON.stringify({ state: { user, cardDismissed: true }, version: 1 })), admin);
  const server = await fakeAccounts(page, { signedIn: true });
  await page.route('**/api/me', (r) => r.fulfill({ json: { user: admin } }));
  let invites: Record<string, unknown>[] = [];
  let users = [
    { id: 'u_test', username: 'ash', role: 'admin', disabled: false, createdAt: Date.now() - 1e8, devices: 2, lastSeenAt: Date.now() },
    { id: 'u_misty', username: 'misty', role: 'user', disabled: false, createdAt: Date.now() - 1e7, devices: 1, invitedBy: 'ash' },
  ];
  await page.route('**/api/admin/invites', (r) => {
    if (r.request().method() === 'POST') {
      invites = [{ id: '0123456789abcdef', note: (r.request().postDataJSON() as { note?: string }).note, createdAt: Date.now(), expiresAt: Date.now() + 7 * 864e5, status: 'open' }];
      return r.fulfill({ json: { code: 'K7QM-3XWD-9PTR', expiresAt: Date.now() + 7 * 864e5, invites } });
    }
    return r.fulfill({ json: { invites } });
  });
  await page.route('**/api/admin/users', (r) => r.fulfill({ json: { users } }));
  await page.route('**/api/admin/users/disable', (r) => {
    users = users.map((u) => (u.id === 'u_misty' ? { ...u, disabled: true, devices: 0 } : u));
    return r.fulfill({ json: { users } });
  });
  let resetBody = '';
  await page.route('**/api/admin/users/reset', (r) => {
    resetBody = r.request().postData() ?? '';
    return r.fulfill({ json: { code: 'ABCDE-FGHJK-LMNPQ-RSTUV', expiresAt: Date.now() + 864e5, users } });
  });

  await page.goto('/#account');
  const admin_ = accountSection(page).getByRole('region', { name: 'Admin' });
  await expect(admin_).toBeVisible();
  const form = admin_.getByRole('form', { name: 'Make an invite' });
  await form.getByLabel('Note (only you see it)').fill('for Sam');
  await form.getByRole('button', { name: 'Make an invite' }).click();
  await expect(admin_.getByTestId('once-code')).toHaveText('K7QM-3XWD-9PTR');
  await expect(admin_.getByRole('list', { name: 'Invites' })).toContainText('for Sam');
  await admin_.getByRole('button', { name: 'Done' }).click();
  await expect(admin_.getByTestId('once-code')).toHaveCount(0);

  const accounts = admin_.getByRole('list', { name: 'Accounts' });
  await expect(accounts.getByRole('button', { name: 'Disable ash' })).toHaveCount(0); // never yourself
  await accounts.getByRole('button', { name: 'Disable misty' }).click();
  await accounts.getByRole('alert').getByRole('button', { name: 'Disable' }).click();
  await expect(accounts.getByRole('listitem').filter({ hasText: 'misty' })).toContainText('Disabled');
  await expect(accounts.getByRole('button', { name: 'Enable misty' })).toBeVisible();
  await expectNoA11yViolations(page);

  users = users.map((u) => ({ ...u, disabled: false }));
  // Open Settings again, so the Admin screen loads the accounts afresh.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Settings & credits' })).toBeHidden();
  await page.evaluate(() => {
    location.hash = '#account';
  });
  const again = accountSection(page).getByRole('region', { name: 'Admin' }).getByRole('list', { name: 'Accounts' });
  await again.getByRole('button', { name: 'Reset password of misty' }).click();
  const resetForm = again.getByRole('form', { name: 'Reset password of misty' });
  await resetForm.getByLabel('Your password, to confirm').fill(PW);
  await resetForm.getByRole('button', { name: 'Make reset code' }).click();
  await expect(accountSection(page).getByTestId('once-code')).toHaveText('ABCDE-FGHJK-LMNPQ-RSTUV');
  expect(resetBody).toContain('"key"');
  expect(resetBody).not.toContain(PW);
  expect(server.bodies.join('')).not.toContain(PW);
});

test('Bring my teams from before: shown to a new account, with what it brings; Bring them over, or Skip', async ({ page }) => {
  await rememberSignedIn(page);
  await fakeAccounts(page, { signedIn: true });
  let claimed = false;
  let skipped = false;
  await page.route('**/api/claim', (r) => {
    if (r.request().method() === 'POST') {
      claimed = true;
      return r.fulfill({ json: { email: 'me@example.com', counts: { teams: 12, matches: 30, shares: 2, devices: 1 } } });
    }
    return r.fulfill({ json: { available: true, state: skipped ? 'skipped' : 'pending', fresh: !claimed, email: 'me@example.com', counts: { teams: 12, matches: 30, shares: 2, devices: 1 } } });
  });
  await page.route('**/api/claim/skip', (r) => {
    skipped = true;
    return r.fulfill({ json: { ok: true } });
  });
  await openAccount(page);
  const section = accountSection(page);
  const claim = section.getByRole('region', { name: 'Bring my teams from before' });
  await expect(claim).toContainText('me@example.com');
  await expect(claim).toContainText('12 teams, 30 logged matches, 2 shares, 1 linked desktop app');
  await expectNoA11yViolations(page);
  await claim.getByRole('button', { name: 'Skip' }).click();
  // Skipped: it folds away, still there for later.
  await expect(claim).toHaveCount(0);
  await section.getByText('Bring my teams from before').click();
  await section.getByRole('button', { name: 'Bring them over' }).click();
  await expect(section.getByText('Bring my teams from before')).toHaveCount(0);
  expect(claimed).toBe(true);
});

test('Friends: add by username (a neutral answer), accept a request, a friend code shown once, remove after asking, share with a friend', async ({ page }) => {
  await rememberSignedIn(page);
  await fakeAccounts(page, { signedIn: true });
  const misty = { id: 'u_misty0000000', username: 'misty', since: Date.now() };
  const brock = { id: 'u_brock0000000', username: 'brock', displayName: 'Brock', since: Date.now() };
  let state = { friends: [] as (typeof misty)[], incoming: [brock] as (typeof misty)[], outgoing: [] as (typeof misty)[], blocked: [] as { id: string; username: string }[] };
  await page.route('**/api/me', (r) => r.fulfill({ json: { user: USER, claim: 'skipped', claimAvailable: false, incomingFriends: 1 } }));
  await page.route('**/api/friends', (r) => {
    if (r.request().method() === 'DELETE') state = { ...state, friends: state.friends.filter((f) => f.id !== (r.request().postDataJSON() as { id: string }).id) };
    return r.fulfill({ json: state });
  });
  await page.route('**/api/friends/request', (r) => {
    state = { ...state, outgoing: [misty] };
    return r.fulfill({ json: { ...state, notice: 'If that person has an account, they’ll see your request.' } });
  });
  await page.route('**/api/friends/respond', (r) => {
    state = { ...state, incoming: [], friends: [brock] };
    return r.fulfill({ json: state });
  });
  await page.route('**/api/friends/link', (r) => r.fulfill({ json: { ...state, code: 'FR-K7QM3-XWD9P', expiresAt: Date.now() + 7 * 864e5 } }));

  await page.goto('/#friends');
  const friends = page.getByRole('dialog', { name: 'Settings & credits' }).getByRole('region', { name: /Friends/ });
  await expect(friends).toBeVisible();
  await expect(friends.getByRole('heading', { name: /Friends/ }).first()).toContainText('1');
  const add = friends.getByRole('form', { name: 'Add a friend by username' });
  await add.getByLabel('Add a friend by username').fill('misty');
  await add.getByRole('button', { name: 'Send request' }).click();
  await expect(add.getByRole('status')).toHaveText(/If that person has an account/);
  await expect(friends.getByRole('region', { name: 'Waiting for an answer' })).toContainText('misty');

  await friends.getByRole('button', { name: 'Accept brock' }).click();
  await expect(friends.getByRole('region', { name: 'Friends', exact: true })).toContainText('Brock (@brock)');

  await friends.getByRole('button', { name: 'Make a friend code' }).click();
  await expect(friends.getByTestId('friend-code')).toHaveText('FR-K7QM3-XWD9P');
  await friends.getByRole('button', { name: 'Done' }).click();
  await expect(friends.getByTestId('friend-code')).toHaveCount(0);
  await expectNoA11yViolations(page);

  await friends.getByRole('button', { name: 'Remove brock' }).click();
  await friends.getByRole('alert').getByRole('button', { name: 'Remove' }).click();
  await expect(friends.getByRole('region', { name: 'Friends', exact: true })).toContainText('No friends yet');
});

test('with an account, sharing picks a friend instead of typing an e-mail', async ({ page }) => {
  await rememberSignedIn(page);
  await page.addInitScript(() => localStorage.setItem('ptb:sync:v1', JSON.stringify({ state: { enabled: true, deviceName: 'Phone', cursor: 0, known: {} }, version: 1 })));
  await fakeAccounts(page, { signedIn: true });
  await page.route('**/api/sync**', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: { docs: [], cursor: 0, more: false } }) : r.fulfill({ json: { results: [] } })));
  await page.route('**/api/shared', (r) => r.fulfill({ json: { docs: [], names: {} } }));
  let shared: unknown;
  await page.route('**/api/shares', (r) => {
    if (r.request().method() === 'PUT') shared = r.request().postDataJSON();
    return r.fulfill({ json: { me: { email: 'u_test' }, granted: [], received: [], names: {} } });
  });
  await page.route('**/api/friends', (r) => r.fulfill({ json: { friends: [{ id: 'u_brock0000000', username: 'brock', displayName: 'Brock', since: Date.now() }], incoming: [], outgoing: [], blocked: [] } }));
  await openAccount(page);
  const dialog = page.getByRole('dialog', { name: 'Settings & credits' });
  const pick = dialog.getByRole('combobox', { name: 'Friend to share my matches with' });
  await expect(pick).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'E-mail to share my matches with' })).toHaveCount(0);
  await pick.selectOption({ label: 'Brock (@brock)' });
  await dialog.getByRole('button', { name: 'Share my matches' }).click();
  await expect.poll(() => shared).toEqual({ kind: 'matches', ref: '*', grantee: 'u_brock0000000', role: 'view' });
});
