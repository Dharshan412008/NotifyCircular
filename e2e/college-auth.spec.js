import { expect, test } from '@playwright/test';
import { signIn } from './sign-in.js';

test('faculty can register and sign back in to the compose page', async ({ page }, testInfo) => {
  const email = `teacher-${testInfo.project.name}@gmail.com`;
  await page.goto('/faculty');
  await page.getByRole('button', { name: 'New faculty? Create an account' }).click();
  await page.getByLabel('Full name').fill('New Faculty');
  await expect(page.getByLabel('Academic year')).toHaveCount(0);
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('CampusPass123!');
  await page.getByRole('button', { name: 'Create faculty account', exact: true }).click();
  await expect(page.getByRole('heading', { name: /compose an official notice/i })).toBeVisible();
  expect((await (await page.request.get('/api/auth/me')).json()).user.role).toBe('faculty');
  await page.request.post('/api/auth/logout');
  await page.goto('/faculty');
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('CampusPass123!');
  await page.getByRole('button', { name: 'Sign in securely', exact: true }).click();
  await expect(page.getByRole('heading', { name: /compose an official notice/i })).toBeVisible();
});

test('a Gmail student can register and sign in without OTP', async ({ page }, testInfo) => {
  const email = `normal-${testInfo.project.name}@gmail.com`;
  await page.goto('/student');
  await page.getByRole('button', { name: 'New student? Create an account' }).click();
  await page.getByLabel('Full name').fill('Normal Login Student');
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('CampusPass123!');
  await page.getByRole('button', { name: 'Create student account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your circulars', exact: true })).toBeVisible();
  expect((await (await page.request.get('/api/auth/me')).json()).user.email).toBe(email);
  await page.request.post('/api/auth/logout');
  await page.goto('/student');
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('CampusPass123!');
  await page.getByRole('button', { name: 'Sign in securely', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your circulars', exact: true })).toBeVisible();
});

test('college password login opens a usable email verification screen', async ({ page }, testInfo) => {
  await page.route('**/api/auth/options', (route) => route.fulfill({ json: { localAuth: true, collegePasswordAuth: true, domains: ['srishakthi.ac.in'] } }));
  await page.route('**/api/auth/login', (route) => route.fulfill({ json: { verificationRequired: true, email: 'student@srishakthi.ac.in' } }));
  await page.route('**/api/auth/verification/confirm', (route) => route.fulfill({ status: 400, json: { error: { code: 'invalid_code', message: 'Enter the correct six-digit code from your email.' } } }));
  await page.route('**/api/auth/verification/resend', (route) => route.fulfill({ json: { verificationRequired: true } }));
  await page.goto('/student');
  await page.getByLabel('Email address', { exact: true }).fill('student@srishakthi.ac.in');
  await page.getByLabel('Password', { exact: true }).fill('Secure123!');
  await page.getByRole('button', { name: 'Sign in securely', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Verify your college email' })).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
  await page.getByLabel('Verification code').fill('123456');
  await page.getByRole('button', { name: 'Verify email', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('correct six-digit code');
  await page.getByRole('button', { name: 'Resend code', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('A new code has been sent');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('email-verification.png'), fullPage: true });
});

test('first visit shows college Google login without trial accounts or a password field', async ({ page }, testInfo) => {
  await page.route('**/api/auth/options', (route) => route.fulfill({ json: { localAuth: false, googleEnabled: false, domains: ['srishakthi.ac.in'] } }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in to CampusRelay' })).toBeVisible();
  await expect(page.getByText('College accounts: @srishakthi.ac.in')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeDisabled();
  await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/try now|guided demo|asha rao/i)).toHaveCount(0);
  await page.getByRole('button', { name: 'Faculty portal', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Faculty sign-in' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('college-sign-in.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('a student cannot gain faculty access by selecting the faculty portal', async ({ page }) => {
  await page.goto('/faculty');
  await signIn(page, 'student');
  await expect(page.getByRole('alert')).toContainText('not assigned to the selected portal');
  expect((await (await page.request.get('/api/auth/me')).json()).user).toBeNull();
  await page.getByRole('button', { name: 'Student portal', exact: true }).click();
  await signIn(page, 'student');
  await expect(page.getByRole('heading', { name: 'Your circulars', exact: true })).toBeVisible();
});
