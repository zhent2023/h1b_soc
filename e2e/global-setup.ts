import fs from 'fs';
import path from 'path';

import { chromium, type FullConfig } from '@playwright/test';

const storageStatePath = path.join(process.cwd(), 'test-results', 'e2e-auth.json');

async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL as string | undefined;
  const loginEmail = process.env.E2E_EMAIL ?? 'demo@example.com';
  const loginPassword = process.env.E2E_PASSWORD ?? 'demo-password';

  if (!baseURL) {
    throw new Error('baseURL is required for e2e auth setup.');
  }

  await fs.promises.mkdir(path.dirname(storageStatePath), { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto(new URL('/login', baseURL).toString());
  await page.getByLabel('Email').fill(loginEmail);
  await page.getByLabel('Password').fill(loginPassword);

  const [loginResponse] = await Promise.all([
    page.waitForResponse(
      (resp) => resp.url().includes('/api/v1/auth/login') && resp.request().method() === 'POST',
    ),
    page.getByRole('button', { name: 'Sign In' }).click(),
  ]);

  if (!loginResponse.ok()) {
    throw new Error(`Login failed with status ${loginResponse.status()}`);
  }

  await page.waitForURL('**/', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('mode-address').waitFor({ state: 'visible', timeout: 30_000 });

  await page.context().storageState({ path: storageStatePath });
  await browser.close();
}

export default globalSetup;
