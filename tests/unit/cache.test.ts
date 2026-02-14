import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const redisGet = vi.fn<Promise<string | null>, [string]>();
const redisSet = vi.fn<Promise<unknown>, [string, string, 'EX', number]>();

vi.mock('ioredis', () => {
  return {
    default: class MockRedis {
      get = redisGet;
      set = redisSet;
      constructor() {}
    },
  };
});

async function loadCache() {
  vi.resetModules();
  return import('../../src/lib/cache');
}

describe('cache helpers', () => {
  const previousRedisUrl = process.env.REDIS_URL;

  beforeEach(() => {
    redisGet.mockReset();
    redisSet.mockReset();
  });

  afterEach(() => {
    if (previousRedisUrl === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = previousRedisUrl;
    }
  });

  it('records a miss when redis is disabled', async () => {
    delete process.env.REDIS_URL;
    const { cacheGet, runWithCacheContext } = await loadCache();

    const result = await runWithCacheContext(() => cacheGet('missing'));
    expect(result.result).toBeNull();
    expect(result.hits).toBe(0);
    expect(result.misses).toBe(1);
  });

  it('records a hit for valid cached JSON', async () => {
    process.env.REDIS_URL = 'redis://127.0.0.1:26379';
    redisGet.mockResolvedValue(JSON.stringify({ ok: true }));
    const { cacheGet, runWithCacheContext } = await loadCache();

    const result = await runWithCacheContext(() => cacheGet('present'));
    expect(result.result).toEqual({ ok: true });
    expect(result.hits).toBe(1);
    expect(result.misses).toBe(0);
  });

  it('records a miss for invalid cached JSON', async () => {
    process.env.REDIS_URL = 'redis://127.0.0.1:26379';
    redisGet.mockResolvedValue('not-json');
    const { cacheGet, runWithCacheContext } = await loadCache();

    const result = await runWithCacheContext(() => cacheGet('bad'));
    expect(result.result).toBeNull();
    expect(result.hits).toBe(0);
    expect(result.misses).toBe(1);
  });

  it('records a miss when redis key is empty', async () => {
    process.env.REDIS_URL = 'redis://127.0.0.1:26379';
    redisGet.mockResolvedValue(null);
    const { cacheGet, runWithCacheContext } = await loadCache();

    const result = await runWithCacheContext(() => cacheGet('empty'));
    expect(result.result).toBeNull();
    expect(result.hits).toBe(0);
    expect(result.misses).toBe(1);
  });

  it('sets cached values with ttl when redis is enabled', async () => {
    process.env.REDIS_URL = 'redis://127.0.0.1:26379';
    const { cacheSet } = await loadCache();

    await cacheSet('key', { answer: 42 }, 90);
    expect(redisSet).toHaveBeenCalledWith('key', JSON.stringify({ answer: 42 }), 'EX', 90);
  });

  it('no-ops when setting cache with redis disabled', async () => {
    delete process.env.REDIS_URL;
    const { cacheSet } = await loadCache();

    await cacheSet('key', { answer: 42 }, 90);
    expect(redisSet).not.toHaveBeenCalled();
  });
});
