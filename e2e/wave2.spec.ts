import { expect, test } from '@playwright/test';
import { fillAddressLine1 } from './helpers';

const addresses = {
  littleton: '410 Great Road B9 Unit 7-3, Littleton, MA 01460',
  brooklyn1: '946 Albany Avenue, Brooklyn, NY 11203',
  brooklyn2: '265 Lorimer Street, Apt 637, Brooklyn, NY 11206',
  austin: '9600 Great Hills Trail, Suite 150W, Austin, TX 78759',
  industry: '131 Marcellin Dr, City of Industry, CA 91789',
};


async function runLookup(page: any) {
  await Promise.all([
    page.waitForResponse(
      (resp: any) => resp.url().includes('/api/v1/lookup') && resp.request().method() === 'POST',
    ),
    page.getByTestId('lookup-button').click(),
  ]);
}

async function ensureResolvedOrSearch(page: any, query: string, areaCode: string) {
  const kindText = await page.getByTestId('result-kind').textContent();
  if (kindText && kindText.includes('geo_needs_confirmation')) {
    if ((await page.getByTestId('candidate-search-input').count()) === 0) {
      await page.getByRole('button', { name: 'Cannot find your county? Search manually' }).click();
    }
    await page.getByTestId('candidate-search-input').fill(query);
    await Promise.all([
      page.waitForResponse((resp: any) => resp.url().includes('/api/v1/geo/candidates')),
      page.getByTestId('candidate-search-button').click(),
    ]);
    const resultItem = page
      .getByTestId('candidate-results')
      .locator('li', { hasText: areaCode });
    await expect(resultItem).toBeVisible({ timeout: 5000 });
    await resultItem.getByRole('button', { name: 'Use' }).click();
    await page.waitForResponse(
      (resp: any) => resp.url().includes('/api/v1/lookup') && resp.request().method() === 'POST',
    );
  }
  await expect(page.getByTestId('area-code')).toHaveText(areaCode, { timeout: 5000 });
}

test('po box address includes warning in results', async ({ page }) => {
  await page.goto('/');
  await fillAddressLine1(page, 'PO Box 123, Boston, MA 02101');

  await runLookup(page);
  await expect(page.getByTestId('warnings')).toContainText('PO Box detected', { timeout: 5000 });
});

test('Littleton address uses town match and parses line2', async ({ page }) => {
  await page.goto('/');
  await fillAddressLine1(page, addresses.littleton);
  await expect(page.getByTestId('address-line2')).toHaveValue(/Unit 7-3/);

  await runLookup(page);
  await expect(page.getByTestId('result-kind')).toContainText('geo_only', { timeout: 5000 });
  await expect(page.getByTestId('area-code')).toHaveText('14460');
  await expect(page.getByTestId('explain-list')).toContainText('Matched stub Littleton');
});

test('Brooklyn addresses resolve to the same county area', async ({ page }) => {
  await page.goto('/');

  for (const address of [addresses.brooklyn1, addresses.brooklyn2]) {
    await fillAddressLine1(page, address);
    await runLookup(page);
    await expect(page.getByTestId('area-code')).toHaveText('35620');
    await expect(page.getByTestId('geo-county')).toContainText('Kings');
  }
});

test('Austin and City of Industry resolve or allow confirmation search', async ({ page }) => {
  await page.goto('/');

  await fillAddressLine1(page, addresses.austin);
  await runLookup(page);
  await ensureResolvedOrSearch(page, 'Travis', '12420');

  await fillAddressLine1(page, addresses.industry);
  await runLookup(page);
  await ensureResolvedOrSearch(page, 'Los', '31080');
});

test('confirmation flow candidate search resolves override', async ({ page }) => {
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
  const texts = await results.allTextContents();
  const targetIndex = texts.findIndex((text) => text.includes('14460'));
  const index = targetIndex >= 0 ? targetIndex : 0;
  const targetText = texts[index] ?? '';
  const match = targetText.match(/\((\d{5})\)/);
  const selectedAreaCode = match ? match[1] : null;

  await results.nth(index).getByRole('button', { name: 'Use' }).click();
  await page.waitForResponse(
    (resp) => resp.url().includes('/api/v1/lookup') && resp.request().method() === 'POST',
  );
  if (selectedAreaCode) {
    await expect(page.getByTestId('area-code')).toHaveText(selectedAreaCode);
  }
});
