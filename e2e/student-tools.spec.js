import { expect, test } from '@playwright/test';

test('upcoming events retain acknowledgments when the inbox is marked read', async ({ page, request }, testInfo) => {
  const summary = `Campus showcase ${testInfo.project.name} ${Date.now()}`;
  await request.post('/api/auth/login', { data: { email: 'faculty@demo.edu', password: 'Faculty123!' } });
  const groups = (await (await request.get('/api/groups')).json()).groups;
  const target = groups.find((group) => group.slug === 'first-year');
  const response = await request.post('/api/circulars', { data: {
    text: `${summary}. Please confirm your attendance.`, summary,
    targetGroupIds: [target.id], detectedDate: '2099-09-15', requiresAcknowledgment: true,
  } });
  expect(response.status()).toBe(201);
  const noticeId = (await response.json()).circular.id;
  await page.goto('/student');
  await page.getByRole('button', { name: /asha rao/i }).click();
  await page.getByRole('button', { name: 'Mark all as read', exact: true }).click();
  await expect(page.getByText(/marked as read\. Required acknowledgments/)).toBeVisible();
  const notice = (await (await page.request.get(`/api/circulars/${noticeId}`)).json()).circular;
  expect(notice.readAt).toBeTruthy();
  expect(notice.acknowledgedAt).toBeFalsy();
  await page.getByRole('button', { name: 'Events', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Upcoming events', exact: true })).toBeVisible();
  await expect(page.getByText(summary, { exact: true })).toBeVisible();
  await expect(page.locator(`a[href="/api/circulars/${noticeId}/calendar.ics"]`)).toBeVisible();
  await page.getByRole('switch', { name: 'Dark theme', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: testInfo.outputPath('events-dark.png'), fullPage: true });
  if (testInfo.project.name === 'mobile-edge') {
    await page.setViewportSize({ width: 320, height: 568 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    expect(overflow).toBe(false);
    await page.screenshot({ path: testInfo.outputPath('events-compact.png'), fullPage: true });
  }
});
