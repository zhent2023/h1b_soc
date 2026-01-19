import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { geocode, geocodeCensus } from '../../src/lib/geocoder';

const cacheGet = vi.fn();
const cacheSet = vi.fn();

vi.mock('../../src/lib/cache', () => ({
  cacheGet: (...args: unknown[]) => cacheGet(...args),
  cacheSet: (...args: unknown[]) => cacheSet(...args),
}));

describe('geocoder', () => {
  const originalFetch = globalThis.fetch;
  const previousProvider = process.env.GEOCODER_PROVIDER;

  beforeEach(() => {
    cacheGet.mockReset();
    cacheSet.mockReset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (previousProvider === undefined) {
      delete process.env.GEOCODER_PROVIDER;
    } else {
      process.env.GEOCODER_PROVIDER = previousProvider;
    }
  });

  it('returns cached results with cache=hit', async () => {
    process.env.GEOCODER_PROVIDER = 'stub';
    cacheGet.mockResolvedValue({
      stateAb: 'MA',
      confidence: 'high',
      explain: ['cached'],
    });

    const result = await geocode({ fullText: '410 Great Road, Littleton, MA 01460' });
    expect(result.explain).toContain('cache=hit');
    expect(cacheSet).not.toHaveBeenCalled();
  });

  it('matches stubbed locations and fallback', async () => {
    process.env.GEOCODER_PROVIDER = 'stub';
    cacheGet.mockResolvedValue(null);

    const littleton = await geocode({ fullText: 'Littleton, MA 01460' });
    expect(littleton.countyName).toContain('Middlesex');

    const brooklyn = await geocode({ fullText: 'Brooklyn, NY 11203' });
    expect(brooklyn.countyFips).toBe('36047');

    const austin = await geocode({ fullText: 'Austin, TX 78759' });
    expect(austin.countyName).toContain('Travis');

    const industry = await geocode({ fullText: 'City of Industry, CA 91789' });
    expect(industry.countyName).toContain('Los Angeles');

    const fallback = await geocode({ city: 'Nowhere', state: 'ZZ' });
    expect(fallback.confidence).toBe('low');
    expect(fallback.explain.join(' ')).toContain('No stub match');
  });

  it('uses census provider when configured', async () => {
    process.env.GEOCODER_PROVIDER = 'census';
    cacheGet.mockResolvedValue(null);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          addressMatches: [
            {
              score: 95,
              addressComponents: { state: 'CA' },
              geographies: { Counties: [{ GEOID: '06037', NAME: 'Los Angeles County' }] },
            },
          ],
        },
      }),
    });

    const result = await geocode({ fullText: 'City of Industry, CA 91789' });
    expect(result.stateAb).toBe('CA');
    expect(result.explain.join(' ')).toContain('provider=census');
  });

  it('handles missing census input', async () => {
    const result = await geocodeCensus({}, 1000);
    expect(result.confidence).toBe('low');
    expect(result.explain.join(' ')).toContain('Missing address input');
  });

  it('handles census errors and no matches', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'fail',
    });

    const bad = await geocodeCensus({ fullText: 'Nowhere' }, 1000);
    expect(bad.explain.join(' ')).toContain('error: 500');

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ result: { addressMatches: [] } }),
    });

    const none = await geocodeCensus({ fullText: 'Nowhere' }, 1000);
    expect(none.explain.join(' ')).toContain('No census geocoder matches');
  });

  it('handles abort errors in census provider', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(Object.assign(new Error('abort'), { name: 'AbortError' }));
    const result = await geocodeCensus({ fullText: 'Nowhere' }, 1);
    expect(result.explain.join(' ')).toContain('timed out');
  });

  it('handles multiple census matches and missing geographies', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          addressMatches: [
            { score: 100, addressComponents: { state: 'MA' }, geographies: {} },
            { score: 99, addressComponents: { state: 'MA' }, geographies: {} },
          ],
        },
      }),
    });

    const result = await geocodeCensus({ fullText: 'Boston, MA' }, 1000);
    expect(result.explain.join(' ')).toContain('Multiple matches');
    expect(result.explain.join(' ')).toContain('Geographies missing');
  });

  it('uses onelineaddress for structured input without street', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          addressMatches: [
            {
              score: 92,
              addressComponents: { state: 'TX' },
              geographies: { Places: [{ BASENAME: 'Austin' }] },
            },
          ],
        },
      }),
    });
    globalThis.fetch = fetchMock;

    await geocodeCensus({ city: 'Austin', state: 'TX', zip: '78759' }, 1000);

    const url = String(fetchMock.mock.calls[0]?.[0] ?? '');
    expect(url).toContain('/onelineaddress?');
    expect(url).toContain('address=Austin+TX+78759');
  });

  it('returns medium confidence when multiple matches have a wide score gap', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          addressMatches: [
            {
              score: 100,
              addressComponents: { state: 'TX' },
              geographies: { Counties: [{ GEOID: '48001', NAME: 'Travis County' }] },
            },
            {
              score: 80,
              addressComponents: { state: 'TX' },
              geographies: { Counties: [{ GEOID: '48003', NAME: 'Bell County' }] },
            },
          ],
        },
      }),
    });

    const result = await geocodeCensus({ fullText: 'Austin, TX' }, 1000);
    expect(result.confidence).toBe('medium');
    expect(result.explain.join(' ')).toContain('Multiple matches returned');
  });

  it('handles census provider errors that are not timeouts', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network'));
    const result = await geocodeCensus({ fullText: 'Nowhere' }, 1000);
    expect(result.explain.join(' ')).toContain('Census geocoder error: network');
  });

  it('handles structured census input', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          addressMatches: [
            {
              score: 92,
              addressComponents: { state: 'TX' },
              geographies: { Places: [{ BASENAME: 'Austin' }] },
            },
          ],
        },
      }),
    });

    const result = await geocodeCensus(
      { line1: '123 Main', city: 'Austin', state: 'TX', zip: '78759' },
      1000,
    );
    expect(result.placeName).toBe('Austin');
    expect(result.stateAb).toBe('TX');
  });
});
