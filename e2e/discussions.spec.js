import { signIn } from './sign-in.js';
import { expect, test } from '@playwright/test';

test('students and faculty discuss, reply, react and pin within a group', async ({ page, browser }, testInfo) => {
  await page.goto('/student/discussions');
  await signIn(page, 'student');
  await page.getByRole('button', { name: /Sports Group/ }).click();
  const text = `Practice question ${testInfo.project.name} ${Date.now()}`;
  await page.getByRole('textbox', { name: 'Message your group' }).fill(text);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const message = page.getByRole('article').filter({ hasText: text });
  await expect(message).toBeVisible();
  await message.getByRole('button', { name: 'Like message', exact: true }).click();
  await expect(message.getByRole('button', { name: 'Like message', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const other = await browser.newContext();
  try {
    const faculty = await other.newPage();
    await faculty.goto(`${testInfo.project.use.baseURL}/faculty/discussions`);
    await signIn(faculty, 'faculty');
    await faculty.getByRole('button', { name: /Sports Group/ }).click();
    const original = faculty.getByRole('article').filter({ hasText: text });
    await original.getByRole('button', { name: 'Pin', exact: true }).click();
    await expect(original.getByRole('button', { name: 'Unpin', exact: true })).toBeVisible();
    await original.getByRole('button', { name: 'Reply', exact: true }).click();
    await faculty.getByRole('textbox', { name: 'Message your group' }).fill(`Bring your ID ${testInfo.project.name}`);
    await faculty.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.locator('.discussion-body').filter({ hasText: `Bring your ID ${testInfo.project.name}` })).toBeVisible({ timeout: 12000 });
    await page.getByRole('button', { name: 'Mark discussion read' }).click();
    await expect(page.getByRole('button', { name: 'Mark discussion read' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Pinned', exact: true }).click();
    await expect(page.locator('.discussion-body').filter({ hasText: text })).toBeVisible();
    await expect(page.locator('.discussion-body').filter({ hasText: `Bring your ID ${testInfo.project.name}` })).toHaveCount(0);
    await page.getByRole('searchbox', { name: 'Search discussion' }).fill(text);
    await expect(page.getByRole('article')).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath('group-discussion.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.reload();
    await expect(page.locator('.discussion-body').filter({ hasText: text })).toBeVisible();
  } finally { await other.close(); }
});
