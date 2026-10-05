import { expect, test } from '@playwright/test';
import { expectNoA11yViolations, goTo, openApp } from './helpers';

test('Meta trends: Trends tab lists who moved, with the period and a text delta; cards have a trend line', async ({ page }) => {
  await openApp(page);
  await goTo(page, 'Meta');
  await page.getByRole('list', { name: /Most used Pokémon/ }).waitFor();
  // A trend line with its numbers in words on the usage cards.
  await expect(page.getByTestId('trend-line').first()).toBeVisible();
  await expect(page.getByTestId('trend-line').first()).toContainText(/→/);

  await page.getByRole('tab', { name: 'Trends' }).click();
  await expect(page.getByRole('heading', { name: 'Rising' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Falling' })).toBeVisible();
  await expect(page.getByText(/In-game ranking: .* → /)).toBeVisible();
  await page.getByRole('tab', { name: '30 days' }).click();
  await expect(page.getByRole('tab', { name: '30 days' })).toHaveAttribute('aria-selected', 'true');
  await expectNoA11yViolations(page);
});
