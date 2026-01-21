import { chromium } from 'playwright';

const port = process.env.ADMIN_AUDIT_PORT || '3102';
const baseUrl =
  process.env.ADMIN_AUDIT_BASE_URL || `http://127.0.0.1:${port}`;
const email = process.env.ADMIN_AUDIT_EMAIL || '';
const password = process.env.ADMIN_AUDIT_PASSWORD || '';
const timeoutMs = Number(process.env.ADMIN_AUDIT_TIMEOUT_MS || 15000);

async function ensureVisible(locator, label) {
  try {
    await locator.first().waitFor({ state: 'visible', timeout: timeoutMs });
  } catch {
    throw new Error(`Missing ${label}`);
  }
}

const browser = await chromium.launch();
const page = await browser.newPage();

try {
  if (email && password) {
    await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });
    await page.getByTestId('login-email').fill(email);
    await page.getByTestId('login-password').fill(password);
    await page.getByTestId('login-submit').click();
    await page.waitForLoadState('networkidle');
  }

  await page.goto(`${baseUrl}/admin/audit`, { waitUntil: 'networkidle' });

  await ensureVisible(
    page.getByRole('button', { name: /Run Cleanup/ }),
    'Run Cleanup button',
  );
  await ensureVisible(
    page.getByRole('button', { name: /Apply Filters|Loading\\.\\.\\./ }),
    'Apply Filters button',
  );
  await ensureVisible(
    page.getByRole('button', { name: /Delete Matching/ }),
    'Delete Matching button',
  );
  await ensureVisible(
    page.getByRole('button', { name: /Save Filters/ }),
    'Save Filters button',
  );
  await ensureVisible(
    page.getByRole('heading', { name: 'Insights' }),
    'Insights section',
  );
  await ensureVisible(
    page.getByRole('heading', { name: 'Noise Filters' }),
    'Noise Filters section',
  );

  if (email && password) {
    const loginLink = page.getByRole('link', { name: 'Go to login' });
    if ((await loginLink.count()) > 0) {
      throw new Error('Admin login failed or insufficient permissions.');
    }
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
