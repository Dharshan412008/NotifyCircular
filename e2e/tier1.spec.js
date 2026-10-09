import { signIn } from './sign-in.js';
import { expect, test } from '@playwright/test';

async function expectNoHorizontalOverflow(page) {
  const metrics = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    deviceWidth: document.querySelector('.device')?.scrollWidth || 0,
    deviceClientWidth: document.querySelector('.device')?.clientWidth || 0,
  }));
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewport);
  expect(metrics.deviceWidth).toBeLessThanOrEqual(metrics.deviceClientWidth + 1);
}

test('renders the routed React shell without legacy assets', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page).toHaveTitle('CampusRelay | Smart circulars');
  await expect(page.getByRole('heading', { name: /sign in to campusrelay/i })).toBeVisible();
  await expect(page.locator('script[src="/script.js"]')).toHaveCount(0);
  await expect(page.locator('#root .device')).toHaveCount(1);
  await expectNoHorizontalOverflow(page);
  await page.waitForTimeout(250);
  await page.screenshot({ path: testInfo.outputPath('home.png'), fullPage: true });
});

test('faculty login reaches compose and group routes', async ({ page }, testInfo) => {
  await page.goto('/faculty');
  await signIn(page, 'faculty');
  await expect(page).toHaveURL(/\/faculty\/compose$/);
  await expect(page.getByRole('heading', { name: /compose an official notice/i })).toBeVisible();
  const theme = page.getByRole('switch', { name: 'Dark theme', exact: true });
  await theme.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await theme.click();
  await page.getByRole('navigation', { name: 'Faculty navigation' }).getByRole('button', { name: 'Sent', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search recent circulars' }).fill('no_matching_circular_12345');
  await expect(page.getByText('No matching circulars', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Groups' }).click();
  await expect(page).toHaveURL(/\/faculty\/groups$/);
  await expect(page.getByRole('heading', { name: /groups & memberships/i })).toBeVisible();
  await expect(page.getByText('First Year', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.waitForTimeout(250);
  await page.screenshot({ path: testInfo.outputPath('faculty-groups.png'), fullPage: true });
  if (testInfo.project.name.includes('mobile')) await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await page.getByRole('button', { name: /sign out/i }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('student login receives only its membership-filtered inbox', async ({ page }, testInfo) => {
  await page.goto('/student');
  await signIn(page, 'student');
  await expect(page).toHaveURL(/\/student$/);
  await expect(page.getByRole('heading', { name: /your circulars/i })).toBeVisible();
  await expect(page.locator('.inbox-list').getByText('Sports Group', { exact: true }).first()).toBeVisible();
  await expect(page.locator('.inbox-list').getByText('Final Year', { exact: true })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await page.waitForTimeout(250);
  await page.screenshot({ path: testInfo.outputPath('student-inbox.png'), fullPage: true });
  await page.getByRole('button', { name: 'Groups' }).click();
  await expect(page.getByRole('checkbox', { name: /first year, assigned automatically/i })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: /whole college, assigned automatically/i })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: /sports group/i })).toBeChecked();
});

test('college login remains usable on a short mobile viewport', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-edge', 'Mobile viewport coverage only');
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in to CampusRelay' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Student portal', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const submit = page.getByRole('button', { name: 'Sign in securely' });
  await submit.scrollIntoViewIfNeeded();
  await expect(submit).toBeVisible();
  await expect(page.getByText(/try now|guided demo/i)).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test('routes a live circular only to the targeted student and records it as read', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-edge', 'Core workflow runs once against the isolated database');
  const baseURL = testInfo.project.use.baseURL;
  const notice = `E2E sports briefing ${Date.now()}: report to Court 2 at 4 PM.`;
  const contexts = [];

  try {
    const facultyContext = await browser.newContext({ baseURL });
    contexts.push(facultyContext);
    const facultyPage = await facultyContext.newPage();
    await facultyPage.goto('/faculty');
    await signIn(facultyPage, 'faculty');
    await facultyPage.getByLabel(/circular message/i).fill(notice);
    await expect(facultyPage.locator('.smart-title small')).toContainText(/audience suggestion/);
    await facultyPage.getByRole('button', { name: 'Add group' }).click();
    await facultyPage.getByRole('checkbox', { name: /sports group/i }).check();
    await facultyPage.getByRole('button', { name: /use 1 group/i }).click();
    await facultyPage.getByRole('button', { name: /review & send/i }).click();
    await facultyPage.getByRole('button', { name: /^send circular/i }).click();
    await expect(facultyPage.getByText(/circular sent/i)).toBeVisible();
    await facultyContext.close();

    const ashaContext = await browser.newContext({ baseURL, acceptDownloads: true });
    contexts.push(ashaContext);
    const ashaPage = await ashaContext.newPage();
    await ashaPage.goto('/student');
    const ashaInboxResponse = ashaPage.waitForResponse((response) => (
      response.url().endsWith('/api/inbox') && response.status() === 200
    ));
    await signIn(ashaPage, 'student');
    await ashaInboxResponse;
    const ashaCard = ashaPage.locator('.inbox-card').filter({ hasText: notice });
    await expect(ashaCard).toHaveCount(1);
    await ashaCard.click();
    await expect(ashaPage.locator('.notice-body')).toHaveText(notice);
    await expect(ashaPage.getByText('Read', { exact: true })).toBeVisible();
    const downloadPromise = ashaPage.waitForEvent('download');
    await ashaPage.getByRole('link', { name: 'Download .txt' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/circular-\d+\.txt/);
    await download.delete();
    await ashaContext.close();

    const raviContext = await browser.newContext({ baseURL });
    contexts.push(raviContext);
    const raviPage = await raviContext.newPage();
    await raviPage.goto('/student');
    await raviPage.getByLabel(/email address/i).fill('ravi@demo.edu');
    await raviPage.getByLabel(/^password$/i).fill('Student123!');
    const raviInboxResponse = raviPage.waitForResponse((response) => (
      response.url().endsWith('/api/inbox') && response.status() === 200
    ));
    await raviPage.getByRole('button', { name: /sign in securely/i }).click();
    await raviInboxResponse;
    await expect(raviPage.getByRole('heading', { name: /your circulars/i })).toBeVisible();
    await expect(raviPage.locator('.inbox-card').filter({ hasText: notice })).toHaveCount(0);
    await raviContext.close();
  } finally {
    await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
  }
});
