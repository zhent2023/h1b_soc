// We depend on `@playwright/test` (not `playwright`) in this repo.
// Importing from `@playwright/test` keeps CI/lightweight installs working.
import { chromium } from '@playwright/test';

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
    // Avoid relying on Next.js client-side hydration for form submission.
    // Directly call the login API so cookies are set deterministically in CI.
    await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
    const loginResult = await page.evaluate(
      async ({ email, password }) => {
        const res = await fetch('/api/v1/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ email, password }),
        });
        const text = await res.text();
        return { ok: res.ok, status: res.status, text };
      },
      { email, password },
    );

    if (!loginResult.ok) {
      throw new Error(`Login failed (${loginResult.status}): ${loginResult.text}`);
    }

    const meResult = await page.evaluate(async () => {
      const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
      const text = await res.text();
      return { ok: res.ok, status: res.status, text };
    });
    if (!meResult.ok) {
      throw new Error(`Auth check failed (${meResult.status}): ${meResult.text}`);
    }

    const adminConfigResult = await page.evaluate(async () => {
      const res = await fetch('/api/v1/admin/audit-logs/config', { credentials: 'include' });
      const text = await res.text();
      return { ok: res.ok, status: res.status, text };
    });
    if (!adminConfigResult.ok) {
      throw new Error(
        `Admin audit config not accessible (${adminConfigResult.status}): ${adminConfigResult.text}`,
      );
    }
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
