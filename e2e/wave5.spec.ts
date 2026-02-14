import { expect, test, type Page } from '@playwright/test';

const recommendationFixture = {
  items: [
    {
      matchedOnetCode: '15-2051.01',
      matchedOnetTitle: 'Business Intelligence Analysts',
      socCode: '15-2051',
      socTitle: 'Data Scientists',
      similarity: 0.87,
      duties: [
        'Generate standard or custom reports for stakeholders.',
        'Maintain business intelligence dashboards and tools.',
        'Analyze trends in operational data.',
        'Provide technical support for reporting systems.',
        'Coordinate testing for analytics outputs.',
      ],
      dutiesCount: 17,
      dutiesAvailable: true,
      wageLevel1Hourly: '43.38',
      wageLevel1Annual: 90230,
      wageLevel2Hourly: '52.00',
      wageLevel2Annual: 108160,
      wageLevel3Hourly: '60.00',
      wageLevel3Annual: 124800,
      wageLevel4Hourly: '75.00',
      wageLevel4Annual: 156000,
      wageYear: '2025-2026',
      wageAreaCode: '14460',
      wageIsAcwia: false,
      wageAvailable: true,
      wageHasDataQualityIssue: false,
      wageDataQualityNotes: null,
      wageSource: 'LOCAL',
    },
    {
      matchedOnetCode: '43-9111.00',
      matchedOnetTitle: 'Statistical Assistants',
      socCode: '43-9111',
      socTitle: 'Statistical Assistants',
      similarity: 0.85,
      duties: [
        'Compute and analyze data using statistical formulas.',
        'Verify completeness and accuracy of source data.',
        'Compile charts that describe results.',
      ],
      dutiesCount: 14,
      dutiesAvailable: true,
      wageLevel1Hourly: '26.94',
      wageLevel1Annual: 56035,
      wageLevel2Hourly: '31.00',
      wageLevel2Annual: 64480,
      wageLevel3Hourly: '36.00',
      wageLevel3Annual: 74880,
      wageLevel4Hourly: '44.00',
      wageLevel4Annual: 91520,
      wageYear: '2025-2026',
      wageAreaCode: '14460',
      wageIsAcwia: false,
      wageAvailable: true,
      wageHasDataQualityIssue: true,
      wageDataQualityNotes: { issues: ['Fixture flag'] },
      wageSource: 'LOCAL',
    },
    {
      matchedOnetCode: '15-2051.00',
      matchedOnetTitle: 'Data Scientists',
      socCode: '15-2051',
      socTitle: 'Data Scientists',
      similarity: 0.84,
      duties: ['Analyze large data sets.', 'Build predictive models.'],
      dutiesCount: 12,
      dutiesAvailable: true,
      wageLevel1Hourly: '43.38',
      wageLevel1Annual: 90230,
      wageLevel2Hourly: '52.00',
      wageLevel2Annual: 108160,
      wageLevel3Hourly: '60.00',
      wageLevel3Annual: 124800,
      wageLevel4Hourly: '75.00',
      wageLevel4Annual: 156000,
      wageYear: '2025-2026',
      wageAreaCode: '14460',
      wageIsAcwia: false,
      wageAvailable: true,
      wageHasDataQualityIssue: false,
      wageDataQualityNotes: null,
      wageSource: 'LOCAL',
    },
    {
      matchedOnetCode: '15-2041.00',
      matchedOnetTitle: 'Statisticians',
      socCode: '15-2041',
      socTitle: 'Statisticians',
      similarity: 0.83,
      duties: ['Interpret statistical data.', 'Report analysis results.'],
      dutiesCount: 10,
      dutiesAvailable: true,
      wageLevel1Hourly: '33.97',
      wageLevel1Annual: 70658,
      wageLevel2Hourly: '39.00',
      wageLevel2Annual: 81120,
      wageLevel3Hourly: '45.00',
      wageLevel3Annual: 93600,
      wageLevel4Hourly: '55.00',
      wageLevel4Annual: 114400,
      wageYear: '2025-2026',
      wageAreaCode: '14460',
      wageIsAcwia: false,
      wageAvailable: true,
      wageHasDataQualityIssue: false,
      wageDataQualityNotes: null,
      wageSource: 'LOCAL',
    },
    {
      matchedOnetCode: '13-1081.02',
      matchedOnetTitle: 'Logistics Analysts',
      socCode: '13-1081',
      socTitle: 'Logisticians',
      similarity: 0.82,
      duties: ['Monitor logistics data.', 'Track product flow.'],
      dutiesCount: 8,
      dutiesAvailable: true,
      wageLevel1Hourly: '32.89',
      wageLevel1Annual: 68411,
      wageLevel2Hourly: '38.00',
      wageLevel2Annual: 79040,
      wageLevel3Hourly: '44.00',
      wageLevel3Annual: 91520,
      wageLevel4Hourly: '54.00',
      wageLevel4Annual: 112320,
      wageYear: '2025-2026',
      wageAreaCode: '14460',
      wageIsAcwia: false,
      wageAvailable: true,
      wageHasDataQualityIssue: false,
      wageDataQualityNotes: null,
      wageSource: 'LOCAL',
    },
    {
      matchedOnetCode: '17-2051.00',
      matchedOnetTitle: 'Financial Analysts',
      socCode: '13-2051',
      socTitle: 'Financial Analysts',
      similarity: 0.81,
      duties: ['Analyze financial data.', 'Prepare investment reports.'],
      dutiesCount: 9,
      dutiesAvailable: true,
      wageLevel1Hourly: '35.12',
      wageLevel1Annual: 73000,
      wageLevel2Hourly: '41.00',
      wageLevel2Annual: 85280,
      wageLevel3Hourly: '47.00',
      wageLevel3Annual: 97760,
      wageLevel4Hourly: '57.00',
      wageLevel4Annual: 118560,
      wageYear: '2025-2026',
      wageAreaCode: '14460',
      wageIsAcwia: false,
      wageAvailable: true,
      wageHasDataQualityIssue: false,
      wageDataQualityNotes: null,
      wageSource: 'LOCAL',
    },
  ],
  warnings: [],
  meta: {
    inputTruncated: false,
    enrichment: { dutiesIncluded: true, wageIncluded: true },
  },
};

const ensureRecommenderOpen = async (page: Page) => {
  await page.getByTestId('address-line1').waitFor({ state: 'visible' });
  if (await page.getByTestId('soc-recommender').count()) {
    return;
  }
  await page.getByTestId('soc-recommender-toggle').click();
  await expect(page.getByTestId('soc-recommender')).toBeVisible();
};

async function mockRecommend(page: any) {
  await page.route('**/api/v1/soc/recommend', async (route: any) => {
    if (route.request().method() !== 'POST') {
      return route.continue();
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(recommendationFixture),
    });
  });
}

test.beforeEach(async ({ page }) => {
  await mockRecommend(page);
  await page.goto('/');
});

test('shows cards and selection writes O*NET into input', async ({ page }) => {
  await ensureRecommenderOpen(page);
  await page.getByTestId('soc-recommender-input').fill('Analyze data and build reports.');
  await Promise.all([
    page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/v1/soc/recommend') && resp.request().method() === 'POST',
    ),
    page.getByTestId('soc-recommender-submit').click(),
  ]);
  await expect(page.getByTestId('soc-recommend-card')).toHaveCount(6);

  await page.getByTestId('soc-recommend-select').first().click();
  await expect(page.getByTestId('soc-input')).toHaveValue(/15-2051.01/);
  await ensureRecommenderOpen(page);
  await expect(page.getByTestId('soc-recommend-banner')).toBeVisible();
  expect(page.url()).toContain('focusOnet=15-2051.01');
});

test('banner restores from URL without overwriting input', async ({ page }) => {
  await page.goto('/?focusOnet=15-2051.01');
  await ensureRecommenderOpen(page);
  await expect(page.getByTestId('soc-recommend-banner')).toBeVisible();
  await expect(page.getByTestId('soc-input')).toHaveValue('');
});

test('manual edits clear banner and focusOnet', async ({ page }) => {
  await ensureRecommenderOpen(page);
  await page.getByTestId('soc-recommender-input').fill('Analyze data and build reports.');
  await Promise.all([
    page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/v1/soc/recommend') && resp.request().method() === 'POST',
    ),
    page.getByTestId('soc-recommender-submit').click(),
  ]);
  await page.getByTestId('soc-recommend-select').first().click();
  await ensureRecommenderOpen(page);
  await expect(page.getByTestId('soc-recommend-banner')).toBeVisible();

  await page.getByTestId('soc-input').fill('15-1252.00');
  await expect(page.getByTestId('soc-recommend-banner')).toHaveCount(0);
  expect(page.url()).not.toContain('focusOnet=');
});

test.describe('mobile duties behavior', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('collapses duties and allows only one expanded card', async ({ page }) => {
    await ensureRecommenderOpen(page);
    await page.getByTestId('soc-recommender-input').fill('Analyze data and build reports.');
    await Promise.all([
      page.waitForResponse(
        (resp) =>
          resp.url().includes('/api/v1/soc/recommend') && resp.request().method() === 'POST',
      ),
      page.getByTestId('soc-recommender-submit').click(),
    ]);
    await expect(page.getByTestId('soc-recommend-card')).toHaveCount(6);
    await expect(page.getByTestId('soc-recommend-duties')).toHaveCount(0);

    const cards = page.getByTestId('soc-recommend-card');
    await cards.nth(0).getByTestId('soc-recommend-duties-toggle').click();
    await expect(cards.nth(0).getByTestId('soc-recommend-duties')).toHaveCount(1);

    await cards.nth(1).getByTestId('soc-recommend-duties-toggle').click();
    await expect(cards.nth(1).getByTestId('soc-recommend-duties')).toHaveCount(1);
    await expect(cards.nth(0).getByTestId('soc-recommend-duties')).toHaveCount(0);

    await expect(cards.nth(0).getByTestId('soc-recommend-wage')).toContainText('/ hr |');
    await expect(cards.nth(0).getByTestId('soc-recommend-wage')).toContainText('/ yr');
    await expect(cards.nth(0).getByTestId('soc-recommend-wage')).toContainText('II');
    await expect(cards.nth(0).getByTestId('soc-recommend-wage')).toContainText('III');
    await expect(cards.nth(0).getByTestId('soc-recommend-wage')).toContainText('IV');
    await expect(page.getByTestId('soc-recommend-quality')).toBeVisible();
  });
});
