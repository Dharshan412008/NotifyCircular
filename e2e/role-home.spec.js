import { expect, test } from '@playwright/test';
import { signIn } from './sign-in.js';
for (const [role, destination, heading] of [['student','/student','Your circulars'],['faculty','/faculty/compose','Compose an official notice'],['admin','/admin/overview','Your campus, at a glance']]) {
  test(`${role} opens only their own portal after home and cross-role navigation`, async ({ page }) => {
    await page.goto(`/${role}`);
    await signIn(page, role);
    for (const path of ['/', ...['student','faculty','admin'].filter(r => r !== role).map(r => `/${r}`)]) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(destination + '$'));
      await expect(page.getByRole('heading', {name:heading, exact:true})).toBeVisible();
      await expect(page.getByLabel('Choose a portal')).toHaveCount(0);
    }
    await page.reload();
    await expect(page).toHaveURL(new RegExp(destination + '$'));
  });
}
