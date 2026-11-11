import { expect, test } from '@playwright/test';
import { openApp, pickOption } from './helpers';

test('an import with notes stays open so the notes can be read', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Team actions' }).click();
  await page.getByRole('menuitem', { name: 'Import / Export' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: /import/i }).click();
  await dialog.getByRole('textbox', { name: 'Text to import' }).fill('Incineroar\nAbility: Intimidate\n- Fake Out\n- Not A Real Move');
  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Imported with notes');
  await page.waitForTimeout(1000);
  await expect(dialog).toBeVisible();
});

test('the nature picker survives a click on its own padding and returns focus on Escape', async ({ page }) => {
  await openApp(page);
  await pickOption(page, 'Species', 'Incineroar');
  const trigger = page.getByRole('button', { name: 'Stat alignment (nature)' });
  await trigger.click();
  const popup = page.getByRole('group', { name: 'Choose a nature' });
  await expect(popup).toBeVisible();
  // Focus moved into the popup.
  await expect(popup.locator(':focus')).toHaveCount(1);
  // The caption text is not a button: clicking it must not toggle the trigger.
  await popup.getByText('Column = stat raised').click();
  await expect(popup).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(popup).toBeHidden();
  await expect(trigger).toBeFocused();
});
