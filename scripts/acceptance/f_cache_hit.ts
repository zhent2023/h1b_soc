import Redis from 'ioredis';

import type { AcceptanceContext } from './types';
import { fetchJson } from './utils';

export const name = 'F cache hit';

interface LookupResponse {
  kind: string;
}

export async function run(ctx: AcceptanceContext): Promise<void> {
  if (process.env.REDIS_URL) {
    const redis = new Redis(process.env.REDIS_URL);
    await redis.flushdb();
    await redis.quit();
  }

  const requestBody = {
    address: { fullText: '946 Albany Avenue, Brooklyn, NY 11203' },
    socCode: '15-1252',
    wageYear: ctx.wageYear,
  };

  const first = await fetchJson<LookupResponse>(`${ctx.baseUrl}/api/v1/lookup`, {
    method: 'POST',
    headers: ctx.headers,
    body: requestBody,
  });
  const second = await fetchJson<LookupResponse>(`${ctx.baseUrl}/api/v1/lookup`, {
    method: 'POST',
    headers: ctx.headers,
    body: requestBody,
  });

  const firstHeader = first.headers.get('x-cache');
  const secondHeader = second.headers.get('x-cache');

  if (firstHeader !== 'miss') {
    throw new Error(`Expected first x-cache=miss, got ${firstHeader ?? 'null'}.`);
  }
  if (secondHeader !== 'hit') {
    throw new Error(`Expected second x-cache=hit, got ${secondHeader ?? 'null'}.`);
  }
}
