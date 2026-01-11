import Redis from 'ioredis';
import { AsyncLocalStorage } from 'node:async_hooks';

type CacheContext = { hits: number; misses: number };

const cacheContext = new AsyncLocalStorage<CacheContext>();

let redisClient: Redis | null = null;

function getRedisClient(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) {
    return null;
  }

  if (!redisClient) {
    redisClient = new Redis(url);
  }

  return redisClient;
}

export async function runWithCacheContext<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; hits: number; misses: number }> {
  const store: CacheContext = { hits: 0, misses: 0 };
  return cacheContext.run(store, async () => {
    const result = await fn();
    return { result, hits: store.hits, misses: store.misses };
  });
}

function recordHit() {
  const store = cacheContext.getStore();
  if (store) {
    store.hits += 1;
  }
}

function recordMiss() {
  const store = cacheContext.getStore();
  if (store) {
    store.misses += 1;
  }
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const client = getRedisClient();
  if (!client) {
    recordMiss();
    return null;
  }

  const raw = await client.get(key);
  if (!raw) {
    recordMiss();
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as T;
    recordHit();
    return parsed;
  } catch {
    recordMiss();
    return null;
  }
}

export async function cacheSet<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  const client = getRedisClient();
  if (!client) {
    return;
  }

  const payload = JSON.stringify(value);
  await client.set(key, payload, 'EX', ttlSeconds);
}
