import { describe, expect, it, vi, afterEach } from 'vitest';

import { rateLimitOrThrow, RateLimitError } from '../../src/lib/rateLimit';

describe('rateLimitOrThrow', () => {
  const nowSpy = vi.spyOn(Date, 'now');

  afterEach(() => {
    nowSpy.mockReset();
  });

  it('enforces in-memory rate limits by IP', async () => {
    const req = new Request('http://localhost', {
      headers: { 'x-forwarded-for': '1.2.3.4' },
    });

    nowSpy.mockReturnValue(0);
    await rateLimitOrThrow({ key: 'lookup', limitPerMin: 1, req });

    nowSpy.mockReturnValue(1);
    await expect(rateLimitOrThrow({ key: 'lookup', limitPerMin: 1, req })).rejects.toBeInstanceOf(
      RateLimitError,
    );
  });

  it('uses x-real-ip when forwarded header is missing', async () => {
    const req = new Request('http://localhost', {
      headers: { 'x-real-ip': '9.9.9.9' },
    });

    nowSpy.mockReturnValue(0);
    await rateLimitOrThrow({ key: 'geo', limitPerMin: 2, req });
    await rateLimitOrThrow({ key: 'geo', limitPerMin: 2, req });
    await expect(rateLimitOrThrow({ key: 'geo', limitPerMin: 2, req })).rejects.toBeInstanceOf(
      RateLimitError,
    );
  });

  it('falls back to unknown ip when headers are missing', async () => {
    const req = new Request('http://localhost');

    nowSpy.mockReturnValue(0);
    await rateLimitOrThrow({ key: 'fallback', limitPerMin: 1, req });
    await expect(rateLimitOrThrow({ key: 'fallback', limitPerMin: 1, req })).rejects.toBeInstanceOf(
      RateLimitError,
    );
  });

  it('uses redis when provided and persists timestamps', async () => {
    const redis = {
      get: vi.fn().mockResolvedValue(JSON.stringify([0])),
      set: vi.fn().mockResolvedValue(null),
    };
    const req = new Request('http://localhost');

    nowSpy.mockReturnValue(70_000);
    await rateLimitOrThrow({ key: 'redis', limitPerMin: 1, req, redis });

    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining('redis:'),
      JSON.stringify([70_000]),
      'PX',
      60_000,
    );
  });

  it('throws when redis timestamps exceed limit', async () => {
    const redis = {
      get: vi.fn().mockResolvedValue(JSON.stringify([10_000, 20_000])),
      set: vi.fn().mockResolvedValue(null),
    };
    const req = new Request('http://localhost');

    nowSpy.mockReturnValue(30_000);
    await expect(rateLimitOrThrow({ key: 'redis', limitPerMin: 2, req, redis })).rejects.toMatchObject({
      status: 429,
      headers: { 'Retry-After': expect.any(String) },
    });
  });
});
