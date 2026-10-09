import { signIn } from './sign-in.js';
import { expect, test } from '@playwright/test';

test('keeps discovery filters and display preferences after reload', async ({ page }, testInfo) => {
  await page.goto('/student');
  await signIn(page, 'student');
  await page.getByRole('combobox', { name: 'Sort notices' }).selectOption('priority');
  await page.getByRole('combobox', { name: 'Received' }).selectOption('30');
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Sort notices' })).toHaveValue('priority');
  await expect(page.getByRole('combobox', { name: 'Received' })).toHaveValue('30');
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await expect(page).toHaveURL(/\/student$/);
  await page.getByRole('combobox', { name: 'Sort notices' }).selectOption('oldest');
  await page.locator('.inbox-card').first().click();
  await page.getByRole('button', { name: 'Back to inbox' }).click();
  await expect(page.getByRole('combobox', { name: 'Sort notices' })).toHaveValue('oldest');

  await page.goto('/student/settings');
  await page.getByRole('combobox', { name: 'Accent color' }).selectOption('ocean');
  await page.getByRole('combobox', { name: 'Card spacing' }).selectOption('compact');
  await page.getByRole('combobox', { name: 'Motion effects' }).selectOption('reduced');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'ocean');
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await expect(page.getByRole('combobox', { name: 'Accent color' })).toHaveValue('ocean');
  await page.screenshot({ path: testInfo.outputPath('display-preferences.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.goto('/student/campus');
  await page.getByRole('button', { name: 'Achievements', exact: true }).click();
  await page.getByRole('button', { name: 'My posts', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search campus posts' }).fill('Robotics');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Achievements', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'My posts', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('searchbox', { name: 'Search campus posts' })).toHaveValue('Robotics');
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await expect(page).toHaveURL(/\/student\/campus$/);

  const created = await page.request.post('/api/posts', { data: { caption: 'Original discovery test post', topic: 'general' } });
  expect(created.ok()).toBe(true);
  const payload = await created.json();
  await page.goto(`/student/campus?post=${payload.id}`);
  await page.getByRole('button', { name: /share something with campus/i }).click();
  const caption = `New post from a focused view ${testInfo.project.name}`;
  await page.getByLabel('Caption', { exact: true }).fill(caption);
  await page.getByRole('button', { name: 'Share post', exact: true }).click();
  await expect(page).toHaveURL(/\/student\/campus$/);
  await expect(page.getByRole('article').filter({ hasText: caption })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('personalized-campus.png'), fullPage: true });
});
