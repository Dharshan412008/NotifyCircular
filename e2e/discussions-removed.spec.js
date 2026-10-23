import { test, expect } from '@playwright/test';
import { signIn } from './sign-in.js';

test('old discussion links return to the portal and chat is absent from navigation', async ({ page }) => {
  await page.goto('/faculty/discussions?channel=1');
  await signIn(page, 'faculty');
  await expect(page).toHaveURL(/\/faculty\/compose$/);
  await expect(page.getByRole('button', { name: 'Discussions', exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Message your group' })).toHaveCount(0);
  await page.request.post('/api/auth/logout');
  await page.goto('/student/discussions?channel=1');
  await signIn(page, 'student');
  await expect(page).toHaveURL(/\/student$/);
  await expect(page.getByRole('button', { name: 'Discussions', exact: true })).toHaveCount(0);
});
