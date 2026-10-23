export async function signIn(page, role) {
  const accounts = { student: ['asha@demo.edu', 'Student123!'], faculty: ['faculty@demo.edu', 'Faculty123!'], admin: ['admin@demo.edu', 'Admin123!'] };
  await page.getByLabel('Email address', { exact: true }).fill(accounts[role][0]);
  await page.getByLabel('Password', { exact: true }).fill(accounts[role][1]);
  await page.getByRole('button', { name: 'Sign in securely', exact: true }).click();
}

export async function fillRegistrationDetails(page, role, password) {
  await page.getByLabel('Department', { exact: true }).fill('Computer Science');
  if (role === 'student') {
    await page.getByLabel('Register number / Student ID').fill('ST101');
    await page.getByLabel('Degree / Program').fill('BE');
    await page.getByLabel('Section', { exact: true }).fill('A');
    await page.getByLabel('Academic session (e.g. 2026–2027)').fill('2026-2027');
  } else {
    await page.getByLabel('Employee / Faculty ID').fill('FAC101');
    await page.getByLabel('Designation', { exact: true }).fill('Assistant Professor');
  }
  await page.getByLabel('Confirm password', { exact: true }).fill(password);
}
