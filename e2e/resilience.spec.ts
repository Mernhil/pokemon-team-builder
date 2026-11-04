import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

test('a screen whose file cannot be loaded says so and leaves the navigation working', async ({ page }) => {
  // The app was updated while this tab was open: the old file name is gone.
  await page.route('**/assets/MatchesView-*.js', (route) => route.abort());
  await openApp(page, '#matches');
  const alert = page.getByRole('alert').filter({ hasText: 'needs a newer version' });
  await expect(alert).toBeVisible();
  await expect(alert.getByRole('button', { name: 'Reload' })).toBeVisible();
  // Moving to another screen starts fresh.
  await page.goto('/#meta');
  await expect(alert).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toBeAttached();
});
