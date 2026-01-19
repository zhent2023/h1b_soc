import { expect, type Page } from '@playwright/test';

export async function fillAddressLine1(page: Page, value: string) {
  const input = page.getByTestId('address-line1');
  await page.getByTestId('address-line2').fill('');
  await page.getByTestId('address-city').fill('');
  await page.getByTestId('address-state').fill('');
  await page.getByTestId('address-zip').fill('');
  await input.fill(value);
  await input.blur();
  await expect(page.getByTestId('address-city')).not.toHaveValue('');
  await expect(page.getByTestId('address-state')).not.toHaveValue('');
}
