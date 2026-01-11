import type { AcceptanceContext } from './types';
import { fetchJson } from './utils';

export const name = 'E salary unit';

interface LookupResponse {
  wages?: {
    metWageLevel?: {
      metLevel: number;
      basis: 'annual' | 'hourly' | 'either';
    };
  };
}

export async function run(ctx: AcceptanceContext): Promise<void> {
  const annualResponse = await fetchJson<LookupResponse>(`${ctx.baseUrl}/api/v1/lookup`, {
    method: 'POST',
    headers: ctx.headers,
    body: {
      address: { fullText: '946 Albany Avenue, Brooklyn, NY 11203' },
      socCode: '15-1252',
      wageYear: ctx.wageYear,
      proposedSalary: 120000,
      salaryUnit: 'year',
    },
  });

  const annualMeta = annualResponse.data.wages?.metWageLevel;
  if (!annualMeta || annualMeta.metLevel === 0) {
    throw new Error('Annual salary did not produce metWageLevel.');
  }
  if (!['annual', 'either'].includes(annualMeta.basis)) {
    throw new Error(`Unexpected annual basis: ${annualMeta.basis}`);
  }

  const hourlyResponse = await fetchJson<LookupResponse>(`${ctx.baseUrl}/api/v1/lookup`, {
    method: 'POST',
    headers: ctx.headers,
    body: {
      address: { fullText: '946 Albany Avenue, Brooklyn, NY 11203' },
      socCode: '15-1252',
      wageYear: ctx.wageYear,
      proposedSalary: 60,
      salaryUnit: 'hour',
    },
  });

  const hourlyMeta = hourlyResponse.data.wages?.metWageLevel;
  if (!hourlyMeta || hourlyMeta.metLevel === 0) {
    throw new Error('Hourly salary did not produce metWageLevel.');
  }
  if (!['hourly', 'either'].includes(hourlyMeta.basis)) {
    throw new Error(`Unexpected hourly basis: ${hourlyMeta.basis}`);
  }
}
