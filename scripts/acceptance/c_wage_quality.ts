import type { AcceptanceContext } from './types';
import { fetchJson, runCommand } from './utils';

export const name = 'C wage quality';

interface LookupResponse {
  wages?: {
    dataQuality?: {
      hasIssue: boolean;
      notes?: string[];
    };
  };
}

export async function run(ctx: AcceptanceContext): Promise<void> {
  await runCommand('pnpm exec tsx scripts/testdata/insert_non_monotonic_wage.ts', {
    tee: true,
  });

  const response = await fetchJson<LookupResponse>(`${ctx.baseUrl}/api/v1/lookup`, {
    method: 'POST',
    headers: ctx.headers,
    body: {
      address: { fullText: '946 Albany Avenue, Brooklyn, NY 11203' },
      socCode: '15-1252',
      wageYear: ctx.wageYear,
    },
  });

  if (!response.data.wages?.dataQuality?.hasIssue) {
    throw new Error('Expected dataQuality flag on wage response.');
  }
}
