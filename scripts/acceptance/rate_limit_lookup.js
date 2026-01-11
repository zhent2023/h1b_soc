#!/usr/bin/env node
const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
const total = Number(process.env.RATE_LIMIT_TOTAL || '80');
const concurrency = Number(process.env.RATE_LIMIT_CONCURRENCY || '4');
const expectedLimit = Number(process.env.RATE_LIMIT_LOOKUP_PER_MIN || '50');
const address =
  process.env.RATE_LIMIT_ADDRESS || '946 Albany Avenue, Brooklyn, NY 11203';

if (Number.isNaN(total) || total <= 0) {
  console.error('RATE_LIMIT_TOTAL must be a positive number.');
  process.exit(1);
}

if (Number.isNaN(concurrency) || concurrency <= 0) {
  console.error('RATE_LIMIT_CONCURRENCY must be a positive number.');
  process.exit(1);
}

if (typeof fetch !== 'function') {
  console.error('Global fetch is not available in this Node runtime.');
  process.exit(1);
}

const headers = { 'content-type': 'application/json' };
if (process.env.ACCESS_EMAIL && process.env.ACCESS_KEY) {
  headers['x-access-email'] = process.env.ACCESS_EMAIL;
  headers['x-access-key'] = process.env.ACCESS_KEY;
}

let index = 0;
const results = [];

async function worker() {
  while (true) {
    const current = index++;
    if (current >= total) {
      return;
    }

    const res = await fetch(`${baseUrl}/api/v1/lookup`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ address: { fullText: address } }),
    });
    await res.text();
    results.push({
      status: res.status,
      retryAfter: res.headers.get('retry-after'),
    });
  }
}

async function main() {
  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  const okCount = results.filter((r) => r.status === 200).length;
  const limitCount = results.filter((r) => r.status === 429).length;
  const other = results.filter((r) => r.status !== 200 && r.status !== 429);
  const hasRetryAfter = results.some(
    (r) => r.status === 429 && r.retryAfter && r.retryAfter.length > 0,
  );

  console.log(
    JSON.stringify(
      { total, okCount, limitCount, otherCount: other.length },
      null,
      2,
    ),
  );

  if (other.length > 0) {
    console.error(
      `Unexpected statuses: ${other.map((r) => r.status).join(', ')}`,
    );
    process.exit(1);
  }

  const expectedOk = Math.min(expectedLimit, total);
  if (okCount < expectedOk) {
    console.error(`Expected at least ${expectedOk} OK responses.`);
    process.exit(1);
  }

  if (total > expectedLimit && limitCount === 0) {
    console.error('Expected at least one 429 response.');
    process.exit(1);
  }

  if (limitCount > 0 && !hasRetryAfter) {
    console.error('Expected Retry-After header on 429 responses.');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
