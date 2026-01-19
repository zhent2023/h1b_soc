import { expect, test } from '@playwright/test';
import path from 'path';

test('transcript upload control is visible and gates recommend button', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByTestId('transcript-upload')).toBeVisible();

  const recommendButton = page.getByTestId('soc-recommender-submit');
  await expect(recommendButton).toBeDisabled();

  await page.getByTestId('soc-recommender-input').fill('Draft duties text');
  await expect(recommendButton).toBeEnabled();
});

test('transcript upload accepts multiple files', async ({ page }) => {
  await page.goto('/');

  const input = page.locator('[data-testid="transcript-upload"] input[type="file"]');
  const fileA = path.join(process.cwd(), 'e2e', 'fixtures', 'transcript-a.pdf');
  const fileB = path.join(process.cwd(), 'e2e', 'fixtures', 'transcript-b.pdf');

  await input.setInputFiles([fileA, fileB]);

  await expect(page.getByText('transcript-a.pdf')).toBeVisible();
  await expect(page.getByText('transcript-b.pdf')).toBeVisible();
});

test('recommend button is enabled for NEEDS_REVIEW transcripts', async ({ page }) => {
  const transcriptId = `transcript-${Date.now()}`;
  const uploadUrl = `/api/test-upload/${transcriptId}`;

  await page.route('**/api/v1/transcripts/create', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        transcriptId,
        upload: {
          provider: 'local',
          uploadUrl,
          method: 'PUT',
          maxBytes: 5_000_000,
        },
      }),
    }),
  );

  await page.route(`**${uploadUrl}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ storageUrl: `local://${transcriptId}.pdf` }),
    }),
  );

  await page.route(`**/api/v1/transcripts/${transcriptId}/complete-upload`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok' }),
    }),
  );

  await page.route(`**/api/v1/transcripts/${transcriptId}/process`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ usedPath: 'pdf_text', courseCount: 1 }),
    }),
  );

  await page.route(`**/api/v1/transcripts/${transcriptId}/compute-ska?debug=1`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ evidenceCount: 5 }),
    }),
  );

  await page.route(`**/api/v1/transcripts/${transcriptId}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ transcript: { id: transcriptId, status: 'NEEDS_REVIEW', courses: [] } }),
    }),
  );

  await page.goto('/');

  const input = page.locator('[data-testid="transcript-upload"] input[type="file"]');
  const fileA = path.join(process.cwd(), 'e2e', 'fixtures', 'transcript-a.pdf');
  await input.setInputFiles([fileA]);

  await expect(page.getByText('NEEDS REVIEW')).toBeVisible();
  await expect(page.getByTestId('soc-recommender-submit')).toBeEnabled();
});
