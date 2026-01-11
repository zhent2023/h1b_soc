import { PrismaClient } from '@prisma/client';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';

import { lookup, LookupError } from '../../src/lib/lookup';

const prisma = new PrismaClient();

describe('lookup integration', () => {
  const previousProvider = process.env.GEOCODER_PROVIDER;

  beforeAll(async () => {
    process.env.GEOCODER_PROVIDER = 'stub';
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    if (previousProvider === undefined) {
      delete process.env.GEOCODER_PROVIDER;
    } else {
      process.env.GEOCODER_PROVIDER = previousProvider;
    }
  });

  it('address only returns geo_only with areaCode 14460', async () => {
    const response = await lookup(
      {
        address: { fullText: '410 Great Road B9 Unit 7-3, Littleton, MA 01460' },
      },
      { prisma },
    );

    expect(response.kind).toBe('geo_only');
    expect(response.geo?.area?.areaCode).toBe('14460');
    expect(response.explain.summary.length).toBeGreaterThan(0);
  });

  it('address + soc returns geo_wage with wages and duties', async () => {
    const response = await lookup(
      {
        address: { fullText: '410 Great Road B9 Unit 7-3, Littleton, MA 01460' },
        socCode: '15-1252',
      },
      { prisma },
    );

    expect(response.kind).toBe('geo_wage');
    expect(response.wages?.level1?.annual).toBeTypeOf('number');
    expect(response.wages?.level2?.annual).toBeTypeOf('number');
    expect(response.wages?.level3?.annual).toBeTypeOf('number');
    expect(response.wages?.level4?.annual).toBeTypeOf('number');
    expect(response.duties?.duties?.length).toBeGreaterThan(0);
  });

  it('uses O*NET 8-digit duties when provided', async () => {
    const response = await lookup(
      {
        address: { fullText: '410 Great Road B9 Unit 7-3, Littleton, MA 01460' },
        socCode: '15-1252.01',
      },
      { prisma },
    );

    expect(response.kind).toBe('geo_wage');
    expect(response.wages?.level1?.annual).toBeTypeOf('number');
    const sources = response.duties?.duties.flatMap((duty) => duty.sources) ?? [];
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.every((source) => source === '15-1252.01')).toBe(true);
  });

  it('falls back to SOC-6 duties when O*NET 8-digit duties are missing', async () => {
    const response = await lookup(
      {
        address: { fullText: '410 Great Road B9 Unit 7-3, Littleton, MA 01460' },
        socCode: '15-1252.02',
      },
      { prisma },
    );

    expect(response.kind).toBe('geo_wage');
    expect(response.duties?.duties?.length).toBeGreaterThan(0);
    expect(response.warnings?.join(' ')).toContain('falling back to SOC-6');
    const sources = response.duties?.duties.flatMap((duty) => duty.sources) ?? [];
    expect(sources.every((source) => source !== '15-1252.02')).toBe(true);
  });

  it('returns 422 when SOC is not found', async () => {
    try {
      await lookup(
        {
          address: { fullText: '410 Great Road B9 Unit 7-3, Littleton, MA 01460' },
          socCode: '11-1111.01',
        },
        { prisma },
      );
      throw new Error('Expected lookup to throw for missing SOC.');
    } catch (error) {
      expect(error).toBeInstanceOf(LookupError);
      const lookupError = error as LookupError;
      expect(lookupError.status).toBe(422);
      expect(lookupError.code).toBe('SOC_NOT_FOUND');
    }
  });

  it('soc only returns soc_extremes with 5 lowest and 5 highest', async () => {
    const response = await lookup({ socCode: '15-1252' }, { prisma });

    expect(response.kind).toBe('soc_extremes');
    expect(response.extremes?.lowest.length).toBe(5);
    expect(response.extremes?.highest.length).toBe(5);
    expect(response.extremes?.lowest[0]?.level1.annual).toBeTypeOf('number');
    expect(response.extremes?.highest[0]?.level4.annual).toBeTypeOf('number');
  });

  it('soc only with 8-digit input returns extremes and 8-digit duties', async () => {
    const response = await lookup({ socCode: '15-1252.01' }, { prisma });

    expect(response.kind).toBe('soc_extremes');
    expect(response.extremes?.lowest.length).toBe(5);
    expect(response.extremes?.highest.length).toBe(5);
    const sources = response.duties?.duties.flatMap((duty) => duty.sources) ?? [];
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.every((source) => source === '15-1252.01')).toBe(true);
  });

  it('soc_extremes ordering is deterministic', async () => {
    const responseA = await lookup({ socCode: '15-1252' }, { prisma });
    const responseB = await lookup({ socCode: '15-1252' }, { prisma });

    const lowestA = responseA.extremes?.lowest ?? [];
    const highestA = responseA.extremes?.highest ?? [];
    const lowestB = responseB.extremes?.lowest ?? [];
    const highestB = responseB.extremes?.highest ?? [];

    expect(lowestA.map((row) => row.area.areaCode)).toEqual(
      lowestB.map((row) => row.area.areaCode),
    );
    expect(highestA.map((row) => row.area.areaCode)).toEqual(
      highestB.map((row) => row.area.areaCode),
    );

    const isSorted = (rows: typeof lowestA, direction: 'asc' | 'desc') =>
      rows.every((row, idx) => {
        if (idx === 0) return true;
        const prev = rows[idx - 1];
        if (row.level1.annual === prev.level1.annual) {
          return row.area.areaCode >= prev.area.areaCode;
        }
        return direction === 'asc'
          ? row.level1.annual > prev.level1.annual
          : row.level1.annual < prev.level1.annual;
      });

    expect(isSorted(lowestA, 'asc')).toBe(true);
    expect(isSorted(highestA, 'desc')).toBe(true);
  });

  it('unknown address returns geo_needs_confirmation', async () => {
    const response = await lookup(
      {
        address: { city: 'Nowhere', state: 'MA', zip: '00000', fullText: 'Nowhere, MA 00000' },
      },
      { prisma },
    );

    expect(response.kind).toBe('geo_needs_confirmation');
  });

  it('override resolves to geo_only', async () => {
    const response = await lookup(
      {
        address: { city: 'Nowhere', state: 'MA', zip: '00000', fullText: 'Nowhere, MA 00000' },
        override: { areaCode: '14460' },
      },
      { prisma },
    );

    expect(response.kind).toBe('geo_only');
    expect(response.geo?.area?.areaCode).toBe('14460');
  });
});
