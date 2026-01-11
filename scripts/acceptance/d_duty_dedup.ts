import type { AcceptanceContext } from './types';
import { fetchJson, runCommand } from './utils';

export const name = 'D duty dedup';

interface LookupResponse {
  duties?: {
    duties?: Array<{ text: string; sources: string[] }>;
  };
}

export async function run(ctx: AcceptanceContext): Promise<void> {
  await runCommand('pnpm exec tsx scripts/testdata/insert_duplicate_duties.ts', {
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

  const duties = response.data.duties?.duties ?? [];
  if (duties.length === 0) {
    throw new Error('No duties returned for dedup test.');
  }

  const rawInserted = 4;
  if (duties.length >= rawInserted) {
    throw new Error('Dedup did not reduce duty count below raw inserts.');
  }

  const normalized = duties.map((duty) => duty.text.toLowerCase().trim());
  const unique = new Set(normalized);
  if (unique.size !== duties.length) {
    throw new Error('Duplicate duties found after dedup.');
  }

  const hasMergedSources = duties.some((duty) => (duty.sources ?? []).length > 1);
  if (!hasMergedSources) {
    throw new Error('Expected at least one duty with merged sources.');
  }
}
