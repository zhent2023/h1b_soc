import type { PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { lookup, LookupError } from '../../src/lib/lookup';
import { geocode } from '../../src/lib/geocoder';
import { resolveOflcArea } from '../../src/lib/resolveGeo';
import { getSocExtremes, getWageRate } from '../../src/lib/wages';
import { getDutiesForOnetCode, getDutiesForSoc } from '../../src/lib/duties';
import { captureDatasetContext } from '../../src/lib/constants';

vi.mock('../../src/lib/geocoder', () => ({ geocode: vi.fn() }));
vi.mock('../../src/lib/resolveGeo', () => ({ resolveOflcArea: vi.fn() }));
vi.mock('../../src/lib/wages', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/wages')>();
  return {
    ...actual,
    getSocExtremes: vi.fn(),
    getWageRate: vi.fn(),
  };
});
vi.mock('../../src/lib/duties', () => ({
  getDutiesForOnetCode: vi.fn(),
  getDutiesForSoc: vi.fn(),
}));
vi.mock('../../src/lib/constants', () => ({ captureDatasetContext: vi.fn() }));

const geocodeMock = geocode as unknown as ReturnType<typeof vi.fn>;
const resolveOflcAreaMock = resolveOflcArea as unknown as ReturnType<typeof vi.fn>;
const getSocExtremesMock = getSocExtremes as unknown as ReturnType<typeof vi.fn>;
const getWageRateMock = getWageRate as unknown as ReturnType<typeof vi.fn>;
const getDutiesForOnetCodeMock = getDutiesForOnetCode as unknown as ReturnType<typeof vi.fn>;
const getDutiesForSocMock = getDutiesForSoc as unknown as ReturnType<typeof vi.fn>;
const captureDatasetContextMock = captureDatasetContext as unknown as ReturnType<typeof vi.fn>;

function createPrisma(): PrismaClient {
  return {
    datasetVersion: { findFirst: vi.fn().mockResolvedValue(null) },
    socTitle: { findFirst: vi.fn().mockResolvedValue({ socCode: '15-0000' }) },
    geoCityCounty: { findMany: vi.fn().mockResolvedValue([]) },
    oflcAreaCounty: { findMany: vi.fn().mockResolvedValue([]) },
  } as unknown as PrismaClient;
}

describe('lookup', () => {
  const previousEnv = {
    DEFAULT_WAGE_YEAR: process.env.DEFAULT_WAGE_YEAR,
    DEFAULT_IS_ACWIA: process.env.DEFAULT_IS_ACWIA,
    FEATURE_WAGE_QUALITY_BANNER: process.env.FEATURE_WAGE_QUALITY_BANNER,
    FEATURE_TOWN_MATCHING: process.env.FEATURE_TOWN_MATCHING,
    LOOKUP_DELAY_MS: process.env.LOOKUP_DELAY_MS,
  };

  beforeEach(() => {
    geocodeMock.mockReset();
    resolveOflcAreaMock.mockReset();
    getSocExtremesMock.mockReset();
    getWageRateMock.mockReset();
    getDutiesForOnetCodeMock.mockReset();
    getDutiesForSocMock.mockReset();
    captureDatasetContextMock.mockReset();
    captureDatasetContextMock.mockResolvedValue({
      oflcVersionId: 'oflc',
      onetVersionId: 'onet',
      cbsaVersionId: 'cbsa',
      labels: {
        oflc: { id: 'oflc', datasetName: 'oflc', versionLabel: '2024' },
        onet: { id: 'onet', datasetName: 'onet', versionLabel: '2024' },
        cbsa: { id: 'cbsa', datasetName: 'cbsa', versionLabel: '2024' },
      },
    });
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key as keyof typeof previousEnv];
      } else {
        process.env[key as keyof typeof previousEnv] = value;
      }
    }
  });

  it('throws when neither address nor soc is provided', async () => {
    const prisma = createPrisma();
    await expect(lookup({}, { prisma })).rejects.toThrow(/Either address or socCode/);
  });

  it('throws when SOC is not found', async () => {
    const prisma = createPrisma();
    prisma.socTitle.findFirst = vi.fn().mockResolvedValue(null);

    await expect(lookup({ socCode: '15-9999' }, { prisma })).rejects.toBeInstanceOf(LookupError);
    expect(geocodeMock).not.toHaveBeenCalled();
  });

  it('returns geo_only for address-only lookups', async () => {
    const prisma = createPrisma();
    geocodeMock.mockResolvedValue({
      stateAb: 'TX',
      confidence: 'high',
      explain: ['geocode ok'],
      countyFips: '48001',
    });
    resolveOflcAreaMock.mockResolvedValue({
      kind: 'resolved',
      area: { areaCode: 'A1', areaName: 'Austin', stateAb: 'TX' },
      cbsa: undefined,
      explain: ['resolved'],
    });

    const result = await lookup({ address: { city: 'Austin', state: 'TX' } }, { prisma });
    expect(result.kind).toBe('geo_only');
    expect(result.geo?.area?.areaCode).toBe('A1');
  });

  it('returns geo_wage for address + soc lookups with wages', async () => {
    const prisma = createPrisma();
    geocodeMock.mockResolvedValue({
      stateAb: 'TX',
      confidence: 'high',
      explain: ['geocode ok'],
      countyFips: '48001',
    });
    resolveOflcAreaMock.mockResolvedValue({
      kind: 'resolved',
      area: { areaCode: 'A1', areaName: 'Austin', stateAb: 'TX' },
      cbsa: undefined,
      explain: ['resolved'],
    });
    getWageRateMock.mockResolvedValue({
      area: { areaCode: 'A1', areaName: 'Austin', stateAb: 'TX', areaType: 'oflc' },
      socCode: '15-0000',
      wageYear: '2024',
      isAcwia: false,
      level1: { annual: 50000, hourly: 25 },
      level2: { annual: 65000, hourly: 32 },
      level3: { annual: 80000, hourly: 40 },
      level4: { annual: 95000, hourly: 47 },
      hasDataQualityIssue: true,
      dataQualityNotes: { issues: ['low sample'] },
    });
    getSocExtremesMock.mockResolvedValue({ lowest: [], highest: [] });
    getDutiesForOnetCodeMock.mockResolvedValue({ duties: [] });
    getDutiesForSocMock.mockResolvedValue({ duties: [{ text: 'Duty', sources: ['15-0000'] }] });

    const result = await lookup(
      {
        address: { fullText: 'Austin, TX 78759' },
        socCode: '15-0000.00',
        proposedSalary: 70000,
        salaryUnit: 'year',
      },
      { prisma },
    );

    expect(result.kind).toBe('geo_wage');
    expect(result.wages?.metWageLevel).toBeDefined();
    expect(result.wages?.dataQuality?.hasIssue).toBe(true);
    expect(result.warnings?.join(' ')).toContain('falling back');
  });

  it('returns wage payload without wages when lookup has no rate data', async () => {
    const prisma = createPrisma();
    geocodeMock.mockResolvedValue({
      stateAb: 'TX',
      confidence: 'high',
      explain: ['geocode ok'],
      countyFips: '48001',
    });
    resolveOflcAreaMock.mockResolvedValue({
      kind: 'resolved',
      area: { areaCode: 'A1', areaName: 'Austin', stateAb: 'TX' },
      cbsa: undefined,
      explain: ['resolved'],
    });
    getWageRateMock.mockResolvedValue(null);
    getSocExtremesMock.mockResolvedValue({ lowest: [], highest: [] });
    getDutiesForSocMock.mockResolvedValue({ duties: [] });

    const result = await lookup(
      {
        address: { city: 'Austin', state: 'TX' },
        socCode: '15-0000',
        proposedSalary: 40,
        salaryUnit: 'hour',
      },
      { prisma },
    );

    expect(result.kind).toBe('geo_wage');
    expect(result.wages?.level1).toBeUndefined();
    expect(result.wages?.proposedSalary?.unit).toBe('hour');
  });

  it('uses onet8 duties when they exist', async () => {
    const prisma = createPrisma();
    geocodeMock.mockResolvedValue({
      stateAb: 'TX',
      confidence: 'high',
      explain: ['geocode ok'],
      countyFips: '48001',
    });
    resolveOflcAreaMock.mockResolvedValue({
      kind: 'resolved',
      area: { areaCode: 'A1', areaName: 'Austin', stateAb: 'TX' },
      cbsa: undefined,
      explain: ['resolved'],
    });
    getWageRateMock.mockResolvedValue(null);
    getSocExtremesMock.mockResolvedValue({ lowest: [], highest: [] });
    getDutiesForOnetCodeMock.mockResolvedValue({ duties: [{ text: 'Direct duty', sources: ['15-0000.01'] }] });
    getDutiesForSocMock.mockResolvedValue({ duties: [] });

    const result = await lookup(
      {
        address: { city: 'Austin', state: 'TX' },
        socCode: '15-0000.01',
      },
      { prisma },
    );

    expect(result.duties?.duties[0]?.sources).toContain('15-0000.01');
    expect(getDutiesForSocMock).not.toHaveBeenCalled();
  });

  it('returns geo_needs_confirmation when resolver requests it', async () => {
    const prisma = createPrisma();
    geocodeMock.mockResolvedValue({
      stateAb: 'TX',
      confidence: 'low',
      explain: ['geocode ok'],
    });
    resolveOflcAreaMock.mockResolvedValue({
      kind: 'needs_confirmation',
      explain: ['needs confirmation'],
      suggestions: [{ areaCode: 'A1', areaName: 'Austin', stateAb: 'TX', countyFips: '48001', countyTownName: 'Travis', matchKind: 'county' }],
    });
    getSocExtremesMock.mockResolvedValue({ lowest: [], highest: [] });

    const result = await lookup(
      { address: { city: 'Austin', state: 'TX' }, socCode: '15-0000' },
      { prisma },
    );

    expect(result.kind).toBe('geo_needs_confirmation');
    expect(result.confirmation?.suggestions.length).toBe(1);
  });

  it('returns soc_extremes when no address is provided', async () => {
    const prisma = createPrisma();
    getSocExtremesMock.mockResolvedValue({ lowest: [], highest: [] });
    getDutiesForSocMock.mockResolvedValue({ duties: [] });

    const result = await lookup({ socCode: '15-0000' }, { prisma });
    expect(result.kind).toBe('soc_extremes');
  });

  it('handles city-only lookup with a single county match', async () => {
    const prisma = createPrisma();
    prisma.datasetVersion.findFirst = vi.fn().mockResolvedValue({ id: 'city_county' });
    prisma.geoCityCounty.findMany = vi.fn().mockResolvedValue([
      { countyName: 'Travis County', countyNameNorm: 'travis county', countyFips: '48001' },
    ]);

    geocodeMock.mockResolvedValue({
      stateAb: 'TX',
      confidence: 'low',
      explain: ['geocode ok'],
    });
    resolveOflcAreaMock.mockResolvedValue({
      kind: 'resolved',
      area: { areaCode: 'A1', areaName: 'Austin', stateAb: 'TX' },
      cbsa: undefined,
      explain: ['resolved'],
    });

    const result = await lookup(
      { address: { city: 'Austin', state: 'TX' } },
      { prisma },
    );

    expect(result.kind).toBe('geo_only');
    expect(resolveOflcAreaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        geocode: expect.objectContaining({ countyFips: '48001' }),
      }),
    );
  });

  it('returns confirmation when city-only lookup yields multiple counties', async () => {
    const prisma = createPrisma();
    prisma.datasetVersion.findFirst = vi.fn().mockResolvedValue({ id: 'city_county' });
    prisma.geoCityCounty.findMany = vi.fn().mockResolvedValue([
      { countyName: 'Travis County', countyNameNorm: 'travis county', countyFips: '48001' },
      { countyName: 'Williamson County', countyNameNorm: 'williamson county', countyFips: '48491' },
    ]);
    prisma.oflcAreaCounty.findMany = vi.fn().mockResolvedValue([
      { area: { areaName: 'Austin', areaCode: 'A1' }, areaCode: 'A1', stateAb: 'TX', countyFips: '48001', countyTownName: 'Travis County', matchKind: 'county' },
      { area: { areaName: 'Austin', areaCode: 'A2' }, areaCode: 'A2', stateAb: 'TX', countyFips: '48491', countyTownName: 'Williamson County', matchKind: 'county' },
    ]);

    geocodeMock.mockResolvedValue({
      stateAb: 'TX',
      confidence: 'low',
      explain: ['geocode ok'],
    });
    getSocExtremesMock.mockResolvedValue({ lowest: [], highest: [] });

    const result = await lookup(
      { address: { city: 'Austin', state: 'TX' }, socCode: '15-0000' },
      { prisma },
    );

    expect(result.kind).toBe('geo_needs_confirmation');
    expect(result.confirmation?.suggestions.length).toBe(2);
    expect(resolveOflcAreaMock).not.toHaveBeenCalled();
  });

  it('returns confirmation for city-only matches resolved by county names', async () => {
    const prisma = createPrisma();
    prisma.datasetVersion.findFirst = vi.fn().mockResolvedValue({ id: 'city_county' });
    prisma.geoCityCounty.findMany = vi.fn().mockResolvedValue([
      { countyName: 'Travis County', countyNameNorm: 'travis county', countyFips: null },
      { countyName: 'Williamson County', countyNameNorm: 'williamson county', countyFips: null },
    ]);
    prisma.oflcAreaCounty.findMany = vi.fn().mockResolvedValue([
      { area: { areaName: 'Austin', areaCode: 'A1' }, areaCode: 'A1', stateAb: 'TX', countyFips: '00000', countyTownName: 'Travis County', matchKind: 'county' },
      { area: { areaName: 'Austin', areaCode: 'A2' }, areaCode: 'A2', stateAb: 'TX', countyFips: '00000', countyTownName: 'Williamson County', matchKind: 'county' },
    ]);

    geocodeMock.mockResolvedValue({
      stateAb: 'TX',
      confidence: 'low',
      explain: ['geocode ok'],
    });

    const result = await lookup(
      { address: { city: 'Austin', state: 'TX' } },
      { prisma },
    );

    expect(result.kind).toBe('geo_needs_confirmation');
    expect(result.confirmation?.suggestions.length).toBe(2);
  });

  it('overrides county hints when provided', async () => {
    const prisma = createPrisma();
    geocodeMock.mockResolvedValue({
      stateAb: 'TX',
      confidence: 'high',
      explain: ['geocode ok'],
    });
    resolveOflcAreaMock.mockResolvedValue({
      kind: 'resolved',
      area: { areaCode: 'A1', areaName: 'Austin', stateAb: 'TX' },
      cbsa: undefined,
      explain: ['resolved'],
    });

    await lookup(
      {
        address: { city: 'Austin', state: 'TX' },
        override: { countyName: 'Travis County', countyFips: '48001' },
      },
      { prisma },
    );

    expect(resolveOflcAreaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        geocode: expect.objectContaining({ countyName: 'Travis County', countyFips: '48001' }),
      }),
    );
  });

  it('respects default flags from environment', async () => {
    const prisma = createPrisma();
    process.env.DEFAULT_WAGE_YEAR = '2023';
    process.env.DEFAULT_IS_ACWIA = 'true';
    process.env.FEATURE_WAGE_QUALITY_BANNER = 'false';
    process.env.LOOKUP_DELAY_MS = '1';

    geocodeMock.mockResolvedValue({
      stateAb: 'TX',
      confidence: 'high',
      explain: ['geocode ok'],
      countyFips: '48001',
    });
    resolveOflcAreaMock.mockResolvedValue({
      kind: 'resolved',
      area: { areaCode: 'A1', areaName: 'Austin', stateAb: 'TX' },
      cbsa: undefined,
      explain: ['resolved'],
    });
    getWageRateMock.mockResolvedValue(null);
    getSocExtremesMock.mockResolvedValue({ lowest: [], highest: [] });
    getDutiesForSocMock.mockResolvedValue({ duties: [] });

    const result = await lookup(
      { address: { city: 'Austin', state: 'TX' }, socCode: '15-0000' },
      { prisma },
    );

    expect(result.wages?.wageYear).toBe('2023');
    expect(result.wages?.isAcwia).toBe(true);
    expect(result.featureFlags?.wageQualityBanner).toBe(false);
  });

  it('ignores invalid SOC formats but still resolves address', async () => {
    const prisma = createPrisma();
    geocodeMock.mockResolvedValue({
      stateAb: 'TX',
      confidence: 'high',
      explain: ['geocode ok'],
      countyFips: '48001',
    });
    resolveOflcAreaMock.mockResolvedValue({
      kind: 'resolved',
      area: { areaCode: 'A1', areaName: 'Austin', stateAb: 'TX' },
      cbsa: undefined,
      explain: ['resolved'],
    });

    const result = await lookup(
      { address: { city: 'Austin', state: 'TX' }, socCode: 'invalid' },
      { prisma },
    );

    expect(result.kind).toBe('geo_only');
    expect(result.warnings?.join(' ')).toContain('SOC code ignored');
  });
});
