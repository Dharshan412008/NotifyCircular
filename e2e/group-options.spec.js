import { expect, test } from '@playwright/test';

test('creates a section group with joining permissions and a deduplicated member preview', async ({ page }, testInfo) => {
  await page.request.post('/api/auth/login', { data: { email: 'asha@demo.edu', password: 'Student123!' } });
  await page.request.put('/api/platform/profile', { data: { name: 'Asha Rao', department: 'Computing', section: 'A', register_number: '', program: '', academic_year: '', bio: '' } });
  await page.request.post('/api/auth/logout');
  await page.goto('/faculty/groups');
  await page.getByRole('button', { name: /meera shah/i }).click();
  await page.getByRole('button', { name: 'Create group', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const groupName = `Computing A ${testInfo.project.name} ${Date.now()}`;
  await dialog.getByLabel('Group name', { exact: true }).fill(groupName);
  await dialog.getByLabel('Description', { exact: true }).fill('Computing workshops');
  await dialog.getByLabel('Icon or initials', { exact: true }).fill('CS');
  await dialog.getByRole('combobox', { name: 'Group type', exact: true }).selectOption('activity');
  await dialog.getByRole('combobox', { name: 'Study year', exact: true }).selectOption('1');
  await dialog.getByLabel('Department', { exact: true }).fill('Computing');
  await dialog.getByLabel('Section', { exact: true }).fill('A');
  await expect(dialog.getByLabel('Add Asha Rao', { exact: true })).toBeChecked();
  await expect(dialog.getByLabel('Add Ravi Kumar', { exact: true })).not.toBeChecked();
  await expect(dialog.getByText('1 student will be added.', { exact: true })).toBeVisible();
  await dialog.getByLabel(/Students can join this group/).check();
  await page.screenshot({ path: testInfo.outputPath('group-options.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Create group', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('article').filter({ hasText: groupName })).toContainText('1 student');
  const group = (await (await page.request.get('/api/groups')).json()).groups.find((item) => item.name === groupName);
  expect(group.section).toBe('A'); expect(group.joinable).toBe(true); expect(group.kind).toBe('activity');
});
