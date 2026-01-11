import path from 'path';

import type { AcceptanceContext } from './types';
import { delay, runCommand, spawnProcess, waitForServer } from './utils';
import * as aData from './a_data_ingest';
import * as bVersion from './b_version_consistency';
import * as cQuality from './c_wage_quality';
import * as dDedup from './d_duty_dedup';
import * as eSalary from './e_salary_unit';
import * as fCache from './f_cache_hit';

const ROOT_DIR = path.resolve(__dirname, '../..');

async function startDependencies() {
  await runCommand('docker compose --profile redis up -d', {
    cwd: ROOT_DIR,
    tee: true,
  });
}

async function ensureDbReady() {
  const maxAttempts = 10;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await runCommand('pnpm db:migrate', { cwd: ROOT_DIR, tee: true });
      return;
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }
      await delay(2000);
    }
  }
}

function getBaseUrl(): string {
  return process.env.BASE_URL ?? 'http://localhost:3000';
}

async function main() {
  const baseUrl = getBaseUrl();
  const wageYear = process.env.ACCEPT_WAGE_YEAR ?? '2025-2026';
  if (!process.env.REDIS_URL || process.env.REDIS_URL.trim().length === 0) {
    process.env.REDIS_URL = 'redis://localhost:6379';
  }

  await startDependencies();
  await ensureDbReady();

  const context: AcceptanceContext = {
    baseUrl,
    headers: {},
    wageYear,
  };

  const steps = [aData, bVersion, cQuality, dDedup, eSalary, fCache];

  console.log(`Acceptance runner starting against ${baseUrl}`);

  for (const step of steps) {
    if (step.name === aData.name) {
      console.log(`==> ${step.name}`);
      try {
        await step.run(context);
        console.log(`PASS ${step.name}`);
      } catch (error) {
        console.error(`FAIL ${step.name}`);
        throw error;
      }
    }
  }

  const serverEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ACCESS_MODE: 'public',
    GEOCODER_PROVIDER: 'stub',
    ENABLE_DEBUG_TOOLS: 'true',
    ENABLE_DEBUG_HEADERS: 'true',
    FEATURE_WAGE_QUALITY_BANNER: 'true',
    REDIS_URL:
      process.env.REDIS_URL && process.env.REDIS_URL.trim().length > 0
        ? process.env.REDIS_URL
        : 'redis://localhost:6379',
  };

  const port = new URL(baseUrl).port || '3000';
  serverEnv.PORT = port;

  console.log('Starting Next.js server for API acceptance checks...');
  const server = spawnProcess('pnpm dev', { cwd: ROOT_DIR, env: serverEnv });

  try {
    await waitForServer(baseUrl, 90_000);
    for (const step of steps) {
      if (step.name === aData.name) {
        continue;
      }
      console.log(`==> ${step.name}`);
      try {
        await step.run(context);
        console.log(`PASS ${step.name}`);
      } catch (error) {
        console.error(`FAIL ${step.name}`);
        throw error;
      }
    }
  } finally {
    server.kill('SIGTERM');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
