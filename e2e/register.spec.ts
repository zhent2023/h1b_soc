import { expect, test } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

test('registration flow creates account and shows welcome toast', async ({ page }) => {
  const stamp = Date.now();
  const email = `register_${stamp}@example.com`;
  const fullName = 'Register User';

  await page.goto('/register');
  await page.getByTestId('register-email').fill(email);
  await page.getByTestId('register-name').fill(fullName);
  await page.getByTestId('register-firm').fill('Register Firm');
  await page.getByTestId('register-password').fill('test-password');
  await page.getByTestId('register-confirm').fill('test-password');
  await page.getByTestId('register-attorney').check();
  await page.getByTestId('register-marketing').check();

  await Promise.all([
    page.waitForURL('**/'),
    page.getByTestId('register-submit').click(),
  ]);

  await expect(page.getByTestId('welcome-toast')).toContainText(fullName);
  await expect(page.getByText('Signed in as')).toBeVisible();
});
