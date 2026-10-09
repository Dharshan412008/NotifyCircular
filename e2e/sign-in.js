export async function signIn(page, role) {
  const accounts = { student: ['asha@demo.edu', 'Student123!'], faculty: ['faculty@demo.edu', 'Faculty123!'], admin: ['admin@demo.edu', 'Admin123!'] };
  await page.getByLabel('Email address', { exact: true }).fill(accounts[role][0]);
  await page.getByLabel('Password', { exact: true }).fill(accounts[role][1]);
  await page.getByRole('button', { name: 'Sign in securely', exact: true }).click();
}
