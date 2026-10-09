import { signIn } from './sign-in.js';
import { expect, test } from '@playwright/test';

test('students share campus photos and faculty can like and comment', async ({ page, browser }, testInfo) => {
  const caption = `Robotics club won the campus challenge! ${testInfo.project.name} ${Date.now()}`;
  await page.goto('/student');
  await signIn(page, 'student');
  await page.getByRole('button', { name: 'Campus', exact: true }).click();
  await expect(page).toHaveURL(/\/student\/campus$/);
  await page.getByRole('button', { name: /share something with campus/i }).click();
  await page.getByLabel('Caption', { exact: true }).fill(caption);
  await page.getByRole('combobox', { name: 'Topic', exact: true }).selectOption('achievement');
  await page.getByLabel(/add a photo/i).setInputFiles({
    name: 'achievement.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'),
  });
  await expect(page.getByAltText('Photo preview')).toBeVisible();
  await page.getByRole('button', { name: 'Share post', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Your post is now visible');
  const ownPost = page.getByRole('article').filter({ hasText: caption });
  await expect(ownPost).toBeVisible();
  await expect(ownPost.locator('.campus-topic-badge')).toContainText('Achievement');
  await page.reload();
  await expect(ownPost).toBeVisible();
  await ownPost.getByRole('button', { name: 'Edit post', exact: true }).click();
  await page.getByRole('textbox', { name: 'Edit caption', exact: true }).fill(`${caption} Thank you to our mentors.`);
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(ownPost).toContainText('Thank you to our mentors.');
  await ownPost.getByRole('button', { name: 'Save post', exact: true }).click();
  await expect(ownPost.getByRole('button', { name: 'Unsave post', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Saved', exact: true }).click();
  await expect(ownPost).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search campus posts' }).fill('no_matching_campus_post');
  await expect(page.getByText('No matching posts', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(ownPost).toBeVisible();
  await page.getByRole('button', { name: 'My posts', exact: true }).click();
  await expect(ownPost).toBeVisible();
  await page.getByRole('button', { name: 'Explore', exact: true }).click();
  const other = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: testInfo.project.use.viewport });
  try {
    const faculty = await other.newPage();
    await faculty.goto('/faculty');
    await signIn(faculty, 'faculty');
    await faculty.getByRole('button', { name: 'Campus', exact: true }).click();
    const post = faculty.getByRole('article').filter({ hasText: caption });
    await expect(post).toBeVisible();
    await expect(post.getByRole('button', { name: 'Delete post', exact: true })).toHaveCount(0);
    await expect(post.locator('img')).toBeVisible();
    expect(await post.locator('img').evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
    await post.getByRole('button', { name: 'Like post', exact: true }).click();
    await expect(post.getByRole('button', { name: 'Unlike post', exact: true })).toContainText('1');
    await post.getByRole('button', { name: /comments/ }).click();
    await post.getByLabel('Add a comment', { exact: true }).fill('Congratulations, team!');
    await post.getByRole('button', { name: 'Post comment', exact: true }).click();
    await expect(post.getByText('Congratulations, team!', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Refresh campus feed' }).click();
    await expect(ownPost.getByRole('button', { name: /comments/ })).toContainText('1');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
    await page.screenshot({ path: testInfo.outputPath('campus-feed.png'), fullPage: true });
    await ownPost.getByRole('button', { name: 'Delete post', exact: true }).click();
    await page.getByRole('button', { name: 'Delete permanently', exact: true }).click();
    await expect(ownPost).toHaveCount(0);
    await faculty.getByRole('button', { name: 'Refresh campus feed' }).click();
    await expect(post).toHaveCount(0);
  } finally {
    await other.close();
  }
});
