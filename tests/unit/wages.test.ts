import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { computeMetWageLevel, getSocExtremes, getWageRate } from '../../src/lib/wages';

const cacheGet = vi.fn();
const cacheSet = vi.fn();

vi.mock('../../src/lib/cache', () => ({
  cacheGet: (...args: unknown[]) => cacheGet(...args),
  cacheSet: (...args: unknown[]) => cacheSet(...args),
}));

describe('wages', () => {
  beforeEach(() => {
    cacheGet.mockReset();
    cacheSet.mockReset();
  });

  it('computes met wage levels and notes', () => {
    const wage = {
      area: { areaCode: 'A1', areaName: 'Austin', areaType: 'oflc' },
      socCode: '15-0000',
      wageYear: '2024',
      isAcwia: false,
      level1: { annual: 50000, hourly: 30 },
      level2: { annual: 100000, hourly: 40 },
      level3: { annual: 130000, hourly: 55 },
      level4: { annual: 160000, hourly: 70 },
      hasDataQualityIssue: false,
    };

    const result = computeMetWageLevel({ amount: 90000, unit: 'year', wage });
    expect(result.metLevel).toBe(2);
    expect(result.notes.length).toBeGreaterThan(0);
  });

  it('prefers annual basis when annual meets exceed hourly meets', () => {
    const wage = {
      area: { areaCode: 'A1', areaName: 'Austin', areaType: 'oflc' },
      socCode: '15-0000',
      wageYear: '2024',
      isAcwia: false,
      level1: { annual: 50000, hourly: 50 },
      level2: { annual: 70000, hourly: 60 },
      level3: { annual: 90000, hourly: 70 },
      level4: { annual: 110000, hourly: 80 },
      hasDataQualityIssue: false,
    };

    const result = computeMetWageLevel({ amount: 80000, unit: 'year', wage });
    expect(result.basis).toBe('annual');
    expect(result.notes.length).toBeGreaterThan(0);
  });

  it('prefers hourly basis when hourly meets exceed annual meets', () => {
    const wage = {
      area: { areaCode: 'A1', areaName: 'Austin', areaType: 'oflc' },
      socCode: '15-0000',
      wageYear: '2024',
      isAcwia: false,
      level1: { annual: 120000, hourly: 30 },
      level2: { annual: 150000, hourly: 40 },
      level3: { annual: 180000, hourly: 50 },
      level4: { annual: 210000, hourly: 60 },
      hasDataQualityIssue: false,
    };

    const result = computeMetWageLevel({ amount: 45, unit: 'hour', wage });
    expect(result.basis).toBe('hourly');
    expect(result.notes.length).toBeGreaterThan(0);
  });

  it('uses either basis when annual and hourly meets are equal', () => {
    const wage = {
      area: { areaCode: 'A1', areaName: 'Austin', areaType: 'oflc' },
      socCode: '15-0000',
      wageYear: '2024',
      isAcwia: false,
      level1: { annual: 83200, hourly: 40 },
      level2: { annual: 100000, hourly: 48 },
      level3: { annual: 120000, hourly: 58 },
      level4: { annual: 140000, hourly: 68 },
      hasDataQualityIssue: false,
    };

    const result = computeMetWageLevel({ amount: 40, unit: 'hour', wage });
    expect(result.basis).toBe('either');
    expect(result.notes).toHaveLength(0);
  });

  it('returns cached wage rates', async () => {
    cacheGet.mockResolvedValue({ socCode: '15-0000' });
    const prisma = {
      wageRate: { findFirst: vi.fn() },
    } as unknown as PrismaClient;

    const result = await getWageRate({
      prisma,
      datasetVersionId: 'oflc',
      wageYear: '2024',
      isAcwia: false,
      areaCode: 'A1',
      socCode: '15-0000',
    });

    expect(result).toEqual({ socCode: '15-0000' });
    expect(prisma.wageRate.findFirst).not.toHaveBeenCalled();
  });

  it('caches null when wage rate is missing', async () => {
    cacheGet.mockResolvedValue(null);
    const prisma = {
      wageRate: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient;

    const result = await getWageRate({
      prisma,
      datasetVersionId: 'oflc',
      wageYear: '2024',
      isAcwia: false,
      areaCode: 'A1',
      socCode: '15-0000',
    });

    expect(result).toBeNull();
    expect(cacheSet).toHaveBeenCalledWith(
      expect.stringContaining('wage:'),
      null,
      3600,
    );
  });

  it('maps wage records with data quality notes', async () => {
    cacheGet.mockResolvedValue(null);
    const prisma = {
      wageRate: {
        findFirst: vi.fn().mockResolvedValue({
          area: { areaCode: 'A1', areaName: 'Austin', stateAb: 'TX' },
          areaCode: 'A1',
          socCode: '15-0000',
          wageYear: '2024',
          isAcwia: false,
          l1Annual: 50000,
          l1Hourly: { toString: () => '25.5' },
          l2Annual: null,
          l2Hourly: null,
          l3Annual: null,
          l3Hourly: null,
          l4Annual: null,
          l4Hourly: null,
          hasDataQualityIssue: true,
          dataQualityNotes: { issues: ['low sample'] },
        }),
      },
    } as unknown as PrismaClient;

    const result = await getWageRate({
      prisma,
      datasetVersionId: 'oflc',
      wageYear: '2024',
      isAcwia: false,
      areaCode: 'A1',
      socCode: '15-0000',
    });

    expect(result?.level2.annual).toBeGreaterThan(result!.level1.annual);
    expect(result?.dataQualityNotes).toEqual({ issues: ['low sample'] });
  });

  it('fills wage fallbacks when hourly values are missing', async () => {
    cacheGet.mockResolvedValue(null);
    const prisma = {
      wageRate: {
        findFirst: vi.fn().mockResolvedValue({
          area: { areaCode: 'A1', areaName: 'Austin', stateAb: 'TX' },
          areaCode: 'A1',
          socCode: '15-0000',
          wageYear: '2024',
          isAcwia: false,
          l1Annual: 52000,
          l1Hourly: null,
          l2Annual: null,
          l2Hourly: null,
          l3Annual: null,
          l3Hourly: null,
          l4Annual: null,
          l4Hourly: null,
          hasDataQualityIssue: false,
          dataQualityNotes: null,
        }),
      },
    } as unknown as PrismaClient;

    const result = await getWageRate({
      prisma,
      datasetVersionId: 'oflc',
      wageYear: '2024',
      isAcwia: false,
      areaCode: 'A1',
      socCode: '15-0000',
    });

    const baseHourly = Math.round((52000 / 2080) * 100) / 100;
    expect(result?.level1.hourly).toBe(baseHourly);
    expect(result?.level2.annual).toBe(67000);
    expect(result?.level2.hourly).toBe(Math.round((baseHourly + 8) * 100) / 100);
    expect(result?.level4.annual).toBe(97000);
  });

  it('falls back to null data quality notes for invalid data', async () => {
    cacheGet.mockResolvedValue(null);
    const prisma = {
      wageRate: {
        findFirst: vi.fn().mockResolvedValue({
          area: { areaCode: 'A1', areaName: 'Austin', stateAb: 'TX' },
          areaCode: 'A1',
          socCode: '15-0000',
          wageYear: '2024',
          isAcwia: false,
          l1Annual: 50000,
          l1Hourly: 25,
          l2Annual: null,
          l2Hourly: null,
          l3Annual: null,
          l3Hourly: null,
          l4Annual: null,
          l4Hourly: null,
          hasDataQualityIssue: false,
          dataQualityNotes: ['bad'],
        }),
      },
    } as unknown as PrismaClient;

    const result = await getWageRate({
      prisma,
      datasetVersionId: 'oflc',
      wageYear: '2024',
      isAcwia: false,
      areaCode: 'A1',
      socCode: '15-0000',
    });

    expect(result?.dataQualityNotes).toBeNull();
  });

  it('returns cached extremes', async () => {
    cacheGet.mockResolvedValue({ lowest: [], highest: [] });
    const prisma = {
      wageRate: { findMany: vi.fn() },
      oflcAreaCounty: { findMany: vi.fn() },
    } as unknown as PrismaClient;

    const result = await getSocExtremes({
      prisma,
      datasetVersionId: 'oflc',
      wageYear: '2024',
      isAcwia: false,
      socCode: '15-0000',
      metric: 'l1Annual',
      n: 2,
    });

    expect(result.lowest).toEqual([]);
    expect(prisma.wageRate.findMany).not.toHaveBeenCalled();
  });

  it('builds extremes with display names', async () => {
    cacheGet.mockResolvedValue(null);
    const prisma = {
      wageRate: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([
            {
              areaCode: 'A1',
              area: { areaCode: 'A1', areaName: 'Austin', stateAb: 'TX' },
              l1Annual: 50000,
              l1Hourly: { toString: () => '25.5' },
              l2Annual: null,
              l2Hourly: null,
              l3Annual: null,
              l3Hourly: null,
              l4Annual: null,
              l4Hourly: null,
            },
          ])
          .mockResolvedValueOnce([
            {
              areaCode: 'A1',
              area: { areaCode: 'A1', areaName: 'Austin', stateAb: 'TX' },
              l1Annual: 60000,
              l1Hourly: { toString: () => '28.5' },
              l2Annual: null,
              l2Hourly: null,
              l3Annual: null,
              l3Hourly: null,
              l4Annual: null,
              l4Hourly: null,
            },
          ]),
      },
      oflcAreaCounty: {
        findMany: vi.fn().mockResolvedValue([
          {
            areaCode: 'A1',
            countyTownName: 'Travis County',
            matchKind: 'county',
            stateAb: 'TX',
          },
        ]),
      },
    } as unknown as PrismaClient;

    const result = await getSocExtremes({
      prisma,
      datasetVersionId: 'oflc',
      wageYear: '2024',
      isAcwia: false,
      socCode: '15-0000',
      metric: 'l1Annual',
      n: 1,
    });

    expect(result.lowest[0]?.area.displayName).toContain('Travis County');
    expect(cacheSet).toHaveBeenCalled();
  });

  it('uses town matches to build display names when county names are missing', async () => {
    cacheGet.mockResolvedValue(null);
    const prisma = {
      wageRate: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([
            {
              areaCode: 'A1',
              area: { areaCode: 'A1', areaName: 'Austin-Round Rock, TX', stateAb: 'TX' },
              l1Annual: 50000,
              l1Hourly: { toString: () => '25.0' },
              l2Annual: null,
              l2Hourly: null,
              l3Annual: null,
              l3Hourly: null,
              l4Annual: null,
              l4Hourly: null,
            },
          ])
          .mockResolvedValueOnce([
            {
              areaCode: 'A1',
              area: { areaCode: 'A1', areaName: 'Austin-Round Rock, TX', stateAb: 'TX' },
              l1Annual: 60000,
              l1Hourly: { toString: () => '28.0' },
              l2Annual: null,
              l2Hourly: null,
              l3Annual: null,
              l3Hourly: null,
              l4Annual: null,
              l4Hourly: null,
            },
          ]),
      },
      oflcAreaCounty: {
        findMany: vi.fn().mockResolvedValue([
          {
            areaCode: 'A1',
            countyTownName: 'Round Rock',
            matchKind: 'town',
            stateAb: 'TX',
          },
        ]),
      },
    } as unknown as PrismaClient;

    const result = await getSocExtremes({
      prisma,
      datasetVersionId: 'oflc',
      wageYear: '2024',
      isAcwia: false,
      socCode: '15-0000',
      metric: 'l1Annual',
      n: 1,
    });

    const displayName = result.lowest[0]?.area.displayName ?? '';
    expect(displayName).toContain('Round Rock');
    expect(displayName).toContain('TX');
  });
});
