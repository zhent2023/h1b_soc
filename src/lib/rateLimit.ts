import Redis from 'ioredis';

export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'PX', duration: number): Promise<unknown>;
}

export class RateLimitError extends Error {
  status: number;
  headers: Record<string, string>;

  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.status = 429;
    this.headers = {
      'Retry-After': retryAfterSeconds.toString(),
    };
  }
}

const memoryStore = new Map<string, number[]>();
let redisClient: Redis | null = null;

function getIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0]?.trim() || 'unknown';
  }

  return req.headers.get('x-real-ip') ?? 'unknown';
}

function getRedisClient(): RedisLike | null {
  const url = process.env.REDIS_URL;
  if (!url) {
    return null;
  }

  if (!redisClient) {
    redisClient = new Redis(url);
  }

  return redisClient;
}

function computeRetryAfter(oldestTimestamp: number, now: number, windowMs: number): number {
  const retryMs = Math.max(oldestTimestamp + windowMs - now, 0);
  return Math.ceil(retryMs / 1000);
}

export async function rateLimitOrThrow(params: {
  key: string;
  limitPerMin: number;
  req: Request;
  redis?: RedisLike;
}): Promise<void> {
  const { key, limitPerMin, req } = params;
  const windowMs = 60_000;
  const now = Date.now();
  const cutoff = now - windowMs;
  const ip = getIp(req);
  const compositeKey = `${key}:${ip}`;

  const redis = params.redis ?? getRedisClient();
  if (redis) {
    const raw = await redis.get(compositeKey);
    const timestamps = raw ? (JSON.parse(raw) as number[]) : [];
    const fresh = timestamps.filter((ts) => ts > cutoff);

    if (fresh.length >= limitPerMin) {
      const retryAfter = computeRetryAfter(fresh[0], now, windowMs);
      throw new RateLimitError('Rate limit exceeded', retryAfter);
    }

    fresh.push(now);
    await redis.set(compositeKey, JSON.stringify(fresh), 'PX', windowMs);
    return;
  }

  const existing = memoryStore.get(compositeKey) ?? [];
  const fresh = existing.filter((ts) => ts > cutoff);

  if (fresh.length >= limitPerMin) {
    const retryAfter = computeRetryAfter(fresh[0], now, windowMs);
    throw new RateLimitError('Rate limit exceeded', retryAfter);
  }

  fresh.push(now);
  memoryStore.set(compositeKey, fresh);
}
