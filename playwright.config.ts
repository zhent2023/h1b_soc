import { defineConfig } from '@playwright/test';

const port = process.env.PORT ?? '3000';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${port}`,
  },
  webServer: {
    command: 'pnpm dev',
    url: `http://localhost:${port}`,
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      ...process.env,
      GEOCODER_PROVIDER: 'stub',
      FEATURE_WAGE_QUALITY_BANNER: 'true',
    },
  },
});
