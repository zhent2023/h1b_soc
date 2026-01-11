import { expect, test } from '@playwright/test';

const addresses = [
  {
    input: '410 Great Road B9 Unit 7-3, Littleton, MA 01460',
    areaCode: '14460',
    county: 'Middlesex County',
  },
  {
    input: '946 Albany Avenue, Brooklyn, NY 11203',
    areaCode: '35620',
    county: 'Kings County',
  },
  {
    input: '265 Lorimer Street, Apt 637, Brooklyn, NY 11206',
    areaCode: '35620',
    county: 'Kings County',
  },
  {
    input: '9600 Great Hills Trail, Suite 150W, Austin, TX 78759',
    areaCode: '12420',
    county: 'Travis County',
  },
  {
    input: '131 Marcellin Dr, City of Industry, CA 91789',
    areaCode: '31080',
    county: 'Los Angeles County',
  },
];

const socChecks = [
  { code: '15-1252', expectDuties: true, expectWarning: false, expectWage: true },
  { code: '13-1161', expectDuties: true, expectWarning: false, expectWage: true },
  { code: '27-1021', expectDuties: true, expectWarning: false, expectWage: true },
  { code: '27-2012', expectDuties: true, expectWarning: false, expectWage: true },
  { code: '17-2071.00', expectDuties: true, expectWarning: true, expectWage: true },
  { code: '13-1081.01', expectDuties: true, expectWarning: true, expectWage: true },
];

test('address only mode resolves fixture addresses', async ({ page }) => {
  await page.goto('/');

  for (const address of addresses) {
    await page.getByTestId('address-input').fill(address.input);
    await page.getByTestId('lookup-button').click();
    await expect(page.getByTestId('area-code')).toHaveText(address.areaCode, {
      timeout: 2000,
    });
    await expect(page.getByTestId('geo-county')).toContainText(address.county);
    await expect(page.getByTestId('explain-list')).toContainText('provider=stub');
  }
});

test('address + soc mode shows wages and warnings where applicable', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('address-input').fill(addresses[0].input);

  for (const check of socChecks) {
    await page.getByTestId('soc-input').fill(check.code);
    await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes('/api/v1/lookup') && resp.request().method() === 'POST',
      ),
      page.getByTestId('lookup-button').click(),
    ]);

    if (check.expectWage) {
      await expect(page.getByTestId('wage-l1-annual')).toBeVisible({ timeout: 2000 });
      await expect(page.getByTestId('wage-l2-annual')).toBeVisible();
      await expect(page.getByTestId('wage-l3-annual')).toBeVisible();
      await expect(page.getByTestId('wage-l4-annual')).toBeVisible();
    } else {
      await expect(page.locator('[data-testid="wage-l1-annual"]')).toHaveCount(0);
    }

    if (check.expectWarning) {
      await expect(page.getByTestId('warnings')).toContainText('Wages use SOC-6');
    } else {
      await expect(page.locator('[data-testid="warnings"]')).toHaveCount(0);
    }

    const dutyCount = await page.getByTestId('duties-list').locator('li').count();
    expect(dutyCount).toBeGreaterThan(0);
  }
});

test('soc only mode extremes are stable', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('soc-input').fill('15-1252');

  const runLookup = async () => {
    await page.getByTestId('lookup-button').click();
    await expect(page.getByTestId('extremes-lowest')).toBeVisible({ timeout: 2000 });
    const lowest = await page.getByTestId('extremes-lowest').locator('li').allTextContents();
    const highest = await page.getByTestId('extremes-highest').locator('li').allTextContents();
    return { lowest, highest };
  };

  const first = await runLookup();
  const second = await runLookup();
  const third = await runLookup();

  expect(first.lowest.length).toBe(5);
  expect(first.highest.length).toBe(5);
  expect(second.lowest).toEqual(first.lowest);
  expect(second.highest).toEqual(first.highest);
  expect(third.lowest).toEqual(first.lowest);
  expect(third.highest).toEqual(first.highest);
});
