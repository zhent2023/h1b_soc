import type { AcceptanceContext } from './types';
import { delay, fetchJson, runCommand } from './utils';

export const name = 'B version consistency';

interface LookupResponse {
  kind: string;
  datasetVersions: {
    oflc?: { versionLabel: string };
    onet?: { versionLabel: string };
    cbsa?: { versionLabel: string };
  };
  wages?: { level1?: { annual: number } };
  duties?: { duties?: Array<{ text: string }> };
  geo?: { cbsa?: { cbsaName: string } };
}

export async function run(ctx: AcceptanceContext): Promise<void> {
  await runCommand('pnpm exec tsx scripts/testdata/install_two_versions.ts', { tee: true });

  const body = {
    address: { fullText: '946 Albany Avenue, Brooklyn, NY 11203' },
    socCode: '15-1252',
    wageYear: ctx.wageYear,
  };

  const slowPromise = fetchJson<LookupResponse>(
    `${ctx.baseUrl}/api/v1/lookup?debugSleepMs=3000`,
    {
      method: 'POST',
      headers: ctx.headers,
      body,
    },
  );

  await delay(500);

  await runCommand('pnpm exec tsx scripts/admin/datasets_activate.ts --dataset oflc --versionLabel test_b', {
    tee: true,
  });
  await runCommand('pnpm exec tsx scripts/admin/datasets_activate.ts --dataset onet --versionLabel test_b', {
    tee: true,
  });
  await runCommand('pnpm exec tsx scripts/admin/datasets_activate.ts --dataset cbsa --versionLabel test_b', {
    tee: true,
  });

  const slowResponse = await slowPromise;
  const slowData = slowResponse.data;

  if (slowData.datasetVersions.oflc?.versionLabel !== 'test_a') {
    throw new Error('Slow lookup did not keep OFLC version test_a.');
  }
  if (slowData.datasetVersions.onet?.versionLabel !== 'test_a') {
    throw new Error('Slow lookup did not keep O*NET version test_a.');
  }
  if (slowData.datasetVersions.cbsa?.versionLabel !== 'test_a') {
    throw new Error('Slow lookup did not keep CBSA version test_a.');
  }
  if (slowData.wages?.level1?.annual !== 80000) {
    throw new Error('Slow lookup wages did not match test_a values.');
  }
  const dutyText = slowData.duties?.duties?.[0]?.text ?? '';
  if (!dutyText.includes('Duty A')) {
    throw new Error('Slow lookup duties did not match test_a.');
  }
  if (slowData.geo?.cbsa?.cbsaName !== 'Test CBSA A') {
    throw new Error('Slow lookup CBSA did not match test_a.');
  }

  const fast = await fetchJson<LookupResponse>(`${ctx.baseUrl}/api/v1/lookup`, {
    method: 'POST',
    headers: ctx.headers,
    body,
  });

  if (fast.data.datasetVersions.oflc?.versionLabel !== 'test_b') {
    throw new Error('Post-switch lookup did not return OFLC test_b.');
  }
  if (fast.data.wages?.level1?.annual !== 90000) {
    throw new Error('Post-switch wages did not match test_b values.');
  }
  const fastDuty = fast.data.duties?.duties?.[0]?.text ?? '';
  if (!fastDuty.includes('Duty B')) {
    throw new Error('Post-switch duties did not match test_b.');
  }
  if (fast.data.geo?.cbsa?.cbsaName !== 'Test CBSA B') {
    throw new Error('Post-switch CBSA did not match test_b.');
  }
}
