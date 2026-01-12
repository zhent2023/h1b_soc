import { expect, test } from '@playwright/test';

const addressLittleton = '410 Great Road B9 Unit 7-3, Littleton, MA 01460';


async function runLookup(page: any) {
  await Promise.all([
    page.waitForResponse(
      (resp: any) => resp.url().includes('/api/v1/lookup') && resp.request().method() === 'POST',
    ),
    page.getByTestId('lookup-button').click(),
  ]);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('address only mode resolves fixture address', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('address-input').fill(addressLittleton);

  await runLookup(page);
  await expect(page.getByTestId('result-kind')).toContainText('geo_only', { timeout: 5000 });
  await expect(page.getByTestId('area-code')).toHaveText('14460');
});

test('address + soc shows wage quality banner when flagged', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('address-input').fill(addressLittleton);
  await page.getByTestId('soc-input').fill('13-1161');

  await runLookup(page);
  await expect(page.getByTestId('result-kind')).toContainText('geo_wage', { timeout: 5000 });
  await expect(page.getByTestId('wage-quality-banner')).toBeVisible({ timeout: 5000 });
  const dutyCount = await page.getByTestId('duties-list').locator('li').count();
  expect(dutyCount).toBeGreaterThan(0);
});

test('salary unit hour computes met wage level', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('address-input').fill(addressLittleton);
  await page.getByTestId('soc-input').fill('15-1252');
  await page.getByTestId('salary-input').fill('60');
  await page.getByTestId('salary-unit').selectOption('hour');

  await runLookup(page);
  await expect(page.getByTestId('proposed-salary')).toContainText('/ hour');
  await expect(page.getByTestId('met-wage-level')).toBeVisible({ timeout: 5000 });
});

test('soc only mode supports 8-digit input for extremes', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('soc-input').fill('15-1252.01');

  await runLookup(page);
  await expect(page.getByTestId('result-kind')).toContainText('soc_extremes', { timeout: 5000 });
  await expect(page.getByTestId('extremes-table')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('extremes-lowest')).toHaveCount(8);
  await expect(page.getByTestId('extremes-highest')).toHaveCount(8);
});

test('confirmation flow resolves with override selection', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('address-input').fill('Nowhere, MA 00000');

  await runLookup(page);
  await expect(page.getByTestId('result-kind')).toContainText('geo_needs_confirmation');

  await page.getByTestId('candidate-search-input').fill('Midd');
  await Promise.all([
    page.waitForResponse((resp: any) => resp.url().includes('/api/v1/geo/candidates')),
    page.getByTestId('candidate-search-button').click(),
  ]);

  const results = page.getByTestId('candidate-results').locator('li');
  await expect(results.first()).toBeVisible({ timeout: 5000 });
  await results.first().getByRole('button', { name: 'Use' }).click();

  await page.waitForResponse(
    (resp: any) => resp.url().includes('/api/v1/lookup') && resp.request().method() === 'POST',
  );
  await expect(page.getByTestId('area-code')).toBeVisible({ timeout: 5000 });
});
