import { defineConfig } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const port = process.env.PORT ?? '3000';
const storageStatePath = path.join(process.cwd(), 'test-results', 'e2e-auth.json');
const envPath = path.join(process.cwd(), '.env');

function readEnvValue(key: string): string | undefined {
  if (!fs.existsSync(envPath)) {
    return undefined;
  }
  const contents = fs.readFileSync(envPath, 'utf8');
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    if (!trimmed.startsWith(`${key}=`)) {
      continue;
    }
    let value = trimmed.slice(key.length + 1).trim();
    const hashIndex = value.indexOf(' #');
    if (hashIndex !== -1) {
      value = value.slice(0, hashIndex).trim();
    }
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return undefined;
}

const databaseUrl = process.env.DATABASE_URL ?? readEnvValue('DATABASE_URL');
const redisUrl = process.env.REDIS_URL ?? readEnvValue('REDIS_URL');

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: `http://localhost:${port}`,
    storageState: storageStatePath,
  },
  webServer: {
    command: 'pnpm dev',
    url: `http://localhost:${port}`,
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      ...process.env,
      ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}),
      ...(redisUrl !== undefined ? { REDIS_URL: redisUrl } : {}),
      ACCESS_MODE: 'invite',
      GEOCODER_PROVIDER: 'stub',
      FEATURE_WAGE_QUALITY_BANNER: 'true',
      FEATURE_SOC_RECOMMENDER: 'true',
      NEXT_PUBLIC_FEATURE_SOC_RECOMMENDER: 'true',
    },
  },
});
