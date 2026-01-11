import { describe, expect, it } from 'vitest';

import { rateLimitOrThrow, RateLimitError } from '../../src/lib/rateLimit';

describe('rateLimitOrThrow', () => {
  it('throws 429 after exceeding the limit', async () => {
    const req = new Request('http://localhost/test', {
      headers: {
        'x-forwarded-for': '203.0.113.10',
      },
    });
    const key = `rate-limit-test-${Date.now()}-${Math.random()}`;

    await rateLimitOrThrow({ key, limitPerMin: 2, req });
    await rateLimitOrThrow({ key, limitPerMin: 2, req });

    await expect(rateLimitOrThrow({ key, limitPerMin: 2, req })).rejects.toBeInstanceOf(
      RateLimitError,
    );
  });
});
