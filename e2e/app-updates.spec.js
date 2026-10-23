import { test, expect } from '@playwright/test';

test('offers an update screen, displays real loading state, and reloads the app', async ({ page }, testInfo) => {
  const current = (await (await page.request.get('/api/version')).json()).buildId;
  let checks = 0, updateRequest;
  await page.route('**/api/version', async (route) => {
    checks++;
    if (checks === 1) await route.fulfill({ json: { buildId: 'a-new-release-is-ready' } });
    else if (checks === 2) updateRequest = route;
    else await route.fulfill({ json: { buildId: current } });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Update available', exact: true })).toBeVisible();
  await page.getByText('What’s new', { exact: true }).click();
  await expect(page.getByText('Complete student and faculty profiles')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('update-available.png') });
  await page.getByRole('button', { name: 'Update', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Updating CampusRelay' })).toBeVisible();
  await expect(page.getByRole('progressbar')).toBeVisible();
  await expect.poll(() => Boolean(updateRequest)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('updating.png') });
  await updateRequest.fulfill({ json: { buildId: current } });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Sign in to CampusRelay', exact: true })).toBeVisible();
});
