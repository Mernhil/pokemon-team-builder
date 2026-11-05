import { expect, test } from '@playwright/test';
import { renameTeam } from './helpers';
import { FakeServer, newDevice, openSavedTeams, renameSaved, savedTeamNames, show, waitSynced } from './devices';

/** Two devices, "Phone" and "Desktop", each make a team; the chips, the filter and "New from" must say the right device on both. */
test('saved teams say which device made and last edited them, and can be filtered by device', async ({ browser }, info) => {
  const server = new FakeServer();
  const phone = await newDevice(browser, info, server, 'Phone');
  const desktop = await newDevice(browser, info, server, 'Desktop');
  await waitSynced(phone.page);
  await waitSynced(desktop.page);

  // Alone, with one device, nothing is labelled.
  const alone = await openSavedTeams(phone.page);
  await expect(alone.getByText(/Made on /)).toHaveCount(0);
  await expect(alone.getByRole('combobox', { name: 'Filter saved teams by device' })).toHaveCount(0);
  await phone.page.keyboard.press('Escape');

  await renameTeam(phone.page, 'Phone team');
  await renameTeam(desktop.page, 'Desktop team');
  await expect.poll(() => server.teams().map((t) => t.name).sort().join('|'), { timeout: 20_000 }).toContain('Desktop team');
  await expect.poll(() => server.teams().map((t) => t.name).sort().join('|'), { timeout: 20_000 }).toContain('Phone team');
  await show(phone.page);
  await show(desktop.page);

  for (const [d, other] of [[phone, 'Desktop'], [desktop, 'Phone']] as const) {
    await expect.poll(async () => (await savedTeamNames(d.page)).sort().join('|'), { timeout: 20_000 }).toMatch(/Desktop team.*Phone team|Phone team.*Desktop team/);
    const dialog = await openSavedTeams(d.page);
    const card = (name: string) => dialog.getByRole('listitem').filter({ has: d.page.getByRole('button', { name: `Rename ${name}`, exact: true }) }).first();
    await expect(card('Phone team')).toContainText('Made on Phone');
    await expect(card('Desktop team')).toContainText('Made on Desktop');
    // The other device's team is new here until opened.
    await expect(card(other === 'Desktop' ? 'Desktop team' : 'Phone team')).toContainText(`New from ${other}`);
    await expect(card(other === 'Desktop' ? 'Phone team' : 'Desktop team')).not.toContainText('New from');

    // Filter: only what was made on the other device.
    const filter = dialog.getByRole('combobox', { name: 'Filter saved teams by device' });
    await filter.selectOption({ label: `Made on ${other}` });
    await expect(dialog.getByRole('button', { name: `Rename ${other} team`, exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: `Rename ${other === 'Desktop' ? 'Phone' : 'Desktop'} team`, exact: true })).toHaveCount(0);
    await d.page.keyboard.press('Escape');
    // Remembered on this device across a reload.
    await d.page.reload();
    const again = await openSavedTeams(d.page);
    await expect(again.getByRole('combobox', { name: 'Filter saved teams by device' })).toHaveValue(/^made:/);
    await again.getByRole('combobox', { name: 'Filter saved teams by device' }).selectOption({ label: 'All teams' });
    await d.page.keyboard.press('Escape');
  }

  // Edited elsewhere: the desktop edits the phone's team.
  await renameSaved(desktop.page, 'Phone team', 'Phone team v2');
  await expect.poll(() => server.teams().some((t) => t.name === 'Phone team v2'), { timeout: 20_000 }).toBe(true);
  await show(phone.page);
  await expect.poll(async () => (await savedTeamNames(phone.page)).includes('Phone team v2'), { timeout: 20_000 }).toBe(true);
  const dialog = await openSavedTeams(phone.page);
  await expect(dialog.getByRole('listitem').filter({ has: phone.page.getByRole('button', { name: 'Rename Phone team v2', exact: true }) }).first()).toContainText('Made on Phone · edited on Desktop');
  await dialog.getByRole('combobox', { name: 'Filter saved teams by device' }).selectOption({ label: 'Edited on Desktop' });
  await expect(dialog.getByRole('button', { name: 'Rename Phone team v2', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Rename Desktop team', exact: true })).toBeVisible();

  // Opening a team clears its "New from" mark.
  await dialog.getByRole('combobox', { name: 'Filter saved teams by device' }).selectOption({ label: 'All teams' });
  await dialog.getByRole('button', { name: 'Open Desktop team', exact: true }).click();
  await show(phone.page);
  const reopened = await openSavedTeams(phone.page);
  await expect(reopened.getByRole('listitem').filter({ has: phone.page.getByRole('button', { name: 'Rename Desktop team', exact: true }) }).first()).not.toContainText('New from');
});

test('Label unlabelled teams as this device: asks with the count, marks them, and the other device sees it without a conflict', async ({ browser }, info) => {
  const server = new FakeServer();
  const old = { id: 'old-team', name: 'Old team', formatId: 'champions-vgc-reg-mc', slots: [null, null, null, null, null, null], createdAt: 1_790_000_000_000, updatedAt: 1_790_000_000_000 };
  server.put({ id: old.id, kind: 'team', updatedAt: old.updatedAt, deleted: false, json: old });
  const phone = await newDevice(browser, info, server, 'Phone');
  const desktop = await newDevice(browser, info, server, 'Desktop');
  await waitSynced(phone.page);
  await waitSynced(desktop.page);
  await expect.poll(async () => (await savedTeamNames(phone.page)).includes('Old team'), { timeout: 15_000 }).toBe(true);

  await phone.page.getByRole('navigation', { name: 'Main' }).locator('visible=true').getByRole('button').last().click();
  await phone.page.getByRole('menuitem', { name: /Settings/ }).click();
  const settings = phone.page.getByRole('dialog', { name: 'Settings & credits' });
  await settings.getByRole('button', { name: 'Label unlabelled teams as this device' }).click();
  await expect(settings.getByRole('alert')).toContainText(/This marks \d+ teams? /);
  await settings.getByRole('button', { name: /^Label \d+ teams?$/ }).click();
  await expect.poll(() => (server.team(old.id) as { createdOn?: string } | undefined)?.createdOn, { timeout: 20_000 }).toMatch(/~Phone$/);
  expect(server.team(old.id)?.updatedAt).toBe(old.updatedAt); // a label is not an edit
  await phone.page.keyboard.press('Escape');

  await show(desktop.page);
  await expect.poll(async () => {
    const dialog = await openSavedTeams(desktop.page);
    const text = await dialog.innerText();
    await desktop.page.keyboard.press('Escape');
    return text;
  }, { timeout: 20_000 }).toContain('Made on Phone');
  expect(server.teams().filter((t) => t.variationLabel?.startsWith('Conflict copy'))).toHaveLength(0);
});
