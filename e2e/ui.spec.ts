import { expect, test } from '@playwright/test';
import { fillAddressLine1 } from './helpers';

test('empty form shows hint and disables lookup', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await expect(page.getByTestId('detected-mode')).toHaveCount(0);
  await expect(page.getByTestId('lookup-button')).toBeDisabled();
});

test('address only mode is detected and hides salary fields', async ({ page }) => {
  await page.goto('/');
  await fillAddressLine1(page, '410 Great Road B9 Unit 7-3, Littleton, MA 01460');

  await expect(page.getByTestId('detected-mode')).toHaveText('Mode: Address only');
  await expect(page.getByTestId('lookup-button')).toHaveText('Lookup Geo');
  await expect(page.getByTestId('salary-input')).toHaveCount(0);
});

test('soc only mode is detected and hides salary fields', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('soc-input').fill('15-1252');

  await expect(page.getByTestId('detected-mode')).toHaveText('Mode: Occupation only');
  await expect(page.getByTestId('lookup-button')).toHaveText('Find Extremes');
  await expect(page.getByTestId('salary-input')).toHaveCount(0);
});

test('address + soc mode shows salary fields and suffix note', async ({ page }) => {
  await page.goto('/');
  await fillAddressLine1(page, '410 Great Road B9 Unit 7-3, Littleton, MA 01460');
  await page.getByTestId('soc-input').fill('15-1252.00');

  await expect(page.getByTestId('detected-mode')).toHaveText('Mode: Address + Occupation');
  await expect(page.getByTestId('lookup-button')).toHaveText('Lookup Wages');
  await expect(page.getByTestId('salary-input')).toBeVisible();
  await expect(page.getByTestId('salary-unit')).toBeVisible();
  await expect(page.getByTestId('soc-suffix-note')).toContainText('Using 15-1252 for wages');

  await page.getByTestId('salary-input').fill('900');
  await expect(page.getByTestId('salary-warning')).toBeVisible();
});
