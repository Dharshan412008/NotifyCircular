import { test, expect } from '@playwright/test';

test('does not interrupt the app with release update screens', async ({ page }) => {
  await page.route('**/api/version', route => route.fulfill({ json: { buildId: 'a-new-release-is-ready' } }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in to CampusRelay', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Update available', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Updating CampusRelay', exact: true })).toHaveCount(0);
});
