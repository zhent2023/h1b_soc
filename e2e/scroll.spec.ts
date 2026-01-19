import { expect, test, type Page } from '@playwright/test';
import { fillAddressLine1 } from './helpers';

const lookupResponse = {
  kind: 'geo_needs_confirmation',
  datasetVersions: {
    oflc: { id: 'oflc', datasetName: 'oflc', versionLabel: '2024' },
    onet: { id: 'onet', datasetName: 'onet', versionLabel: '2024' },
    cbsa: { id: 'cbsa', datasetName: 'cbsa', versionLabel: '2024' },
  },
  featureFlags: { wageQualityBanner: true },
  explain: { summary: ['stub response'] },
  geo: {
    geocode: {
      stateAb: 'TX',
      confidence: 'low',
      explain: ['stub'],
      countyName: 'Travis County',
      countyFips: '48001',
      placeName: 'Austin',
    },
    countyName: 'Travis County',
    placeName: 'Austin',
  },
  confirmation: {
    suggestions: [
      {
        areaCode: 'A1',
        areaName: 'Austin',
        stateAb: 'TX',
        countyFips: '48001',
        countyTownName: 'Travis County',
        matchKind: 'county',
      },
    ],
  },
  warnings: [],
};

const installScrollSpies = async (page: Page) => {
  await page.addInitScript(() => {
    (window as any).__scrollIntoViewCalls = [];

    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (options?: ScrollIntoViewOptions | boolean) {
      (window as any).__scrollIntoViewCalls.push(options ?? null);
      return undefined;
    };

    const originalRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      if (this instanceof HTMLElement && this.dataset?.testid === 'confirmation-card') {
        return {
          top: 1000,
          bottom: 1200,
          left: 0,
          right: 0,
          width: 100,
          height: 200,
          x: 0,
          y: 1000,
          toJSON() {
            return {};
          },
        } as DOMRect;
      }
      return originalRect.apply(this);
    };

    (window as any).__restoreScrollIntoView = () => {
      Element.prototype.scrollIntoView = originalScrollIntoView;
      Element.prototype.getBoundingClientRect = originalRect;
    };
  });
};

const getLastScrollCall = async (page: Page) => {
  const calls = (await page.evaluate(() => (window as any).__scrollIntoViewCalls)) as Array<
    ScrollIntoViewOptions | boolean | null
  >;
  return calls[calls.length - 1] ?? null;
};

test('confirmation auto-scroll uses smooth behavior when idle', async ({ page }) => {
  await installScrollSpies(page);
  await page.route('**/api/v1/lookup', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(lookupResponse),
    });
  });

  await page.goto('/');
  await fillAddressLine1(page, 'Austin, TX');
  await page.getByTestId('lookup-button').click();
  await page.getByTestId('confirmation-card').waitFor();

  const lastCall = await getLastScrollCall(page);
  expect(lastCall && typeof lastCall === 'object' && 'behavior' in lastCall).toBe(true);
  expect((lastCall as ScrollIntoViewOptions).behavior).toBe('smooth');
});

test('confirmation auto-scroll uses auto behavior after user scroll', async ({ page }) => {
  await installScrollSpies(page);

  let releaseLookup: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => {
    releaseLookup = resolve;
  });

  await page.route('**/api/v1/lookup', async (route) => {
    await gate;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(lookupResponse),
    });
  });

  await page.goto('/');
  await fillAddressLine1(page, 'Austin, TX');
  await page.getByTestId('lookup-button').click();

  await page.waitForTimeout(50);
  await page.evaluate(() => {
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: 120 }));
  });
  releaseLookup?.();

  await page.getByTestId('confirmation-card').waitFor();

  const lastCall = await getLastScrollCall(page);
  expect(lastCall && typeof lastCall === 'object' && 'behavior' in lastCall).toBe(true);
  expect((lastCall as ScrollIntoViewOptions).behavior).toBe('auto');
});
