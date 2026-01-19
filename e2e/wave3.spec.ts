import { expect, test } from '@playwright/test';
import { fillAddressLine1 } from './helpers';

const addressLittleton = '410 Great Road B9 Unit 7-3, Littleton, MA 01460';
const wageQualityResponse = {
  kind: 'geo_wage',
  featureFlags: { wageQualityBanner: true },
  geo: {
    area: { areaName: 'Boston-Cambridge-Newton, MA-NH', areaCode: '14460', stateAb: 'MA' },
    geocode: { countyName: 'Middlesex County', placeName: 'Littleton', stateAb: 'MA' },
  },
  wages: {
    wageYear: '2025-2026',
    level1: { hourly: 29.12, annual: 60570 },
    level2: { hourly: 38.77, annual: 80642 },
    level3: { hourly: 48.41, annual: 100693 },
    level4: { hourly: 58.06, annual: 120765 },
    dataQuality: { notes: ['Fixture flag'] },
  },
  duties: { duties: [{ text: 'Fixture duty' }] },
  extremes: null,
  warnings: [],
  explain: { summary: ['stub response'] },
};


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
  await fillAddressLine1(page, addressLittleton);

  await runLookup(page);
  await expect(page.getByTestId('result-kind')).toContainText('geo_only', { timeout: 5000 });
  await expect(page.getByTestId('area-code')).toHaveText('14460');
});

test('address + soc shows wage quality banner when flagged', async ({ page }) => {
  await page.goto('/');
  await page.route('**/api/v1/lookup', async (route) => {
    if (route.request().method() !== 'POST') {
      return route.continue();
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(wageQualityResponse),
    });
  });
  await fillAddressLine1(page, addressLittleton);
  await page.getByTestId('soc-input').fill('13-1161');

  await runLookup(page);
  await expect(page.getByTestId('result-kind')).toContainText('geo_wage', { timeout: 5000 });
  await expect(page.getByTestId('wage-quality-banner')).toBeVisible({ timeout: 5000 });
  const dutyCount = await page.getByTestId('duties-list').locator('li').count();
  expect(dutyCount).toBeGreaterThan(0);
});

test('salary unit hour computes met wage level', async ({ page }) => {
  await page.goto('/');
  await fillAddressLine1(page, addressLittleton);
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
  await fillAddressLine1(page, 'Nowhere, MA 00000');

  await runLookup(page);
  await expect(page.getByTestId('result-kind')).toContainText('geo_needs_confirmation');

  await page.getByRole('button', { name: 'Cannot find your county? Search manually' }).click();
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
