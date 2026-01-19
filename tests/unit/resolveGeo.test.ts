import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { resolveOflcArea, resolveOflcAreaByTown } from '../../src/lib/resolveGeo';

const baseArea = { areaCode: 'A1', areaName: 'Austin, TX', stateAb: 'TX' };

function createPrisma(): PrismaClient {
  return {
    oflcArea: {
      findUnique: async () => null,
      findMany: async () => [],
    },
    oflcAreaCounty: {
      findFirst: async () => null,
      findMany: async () => [],
    },
    geoCountyToCbsa: {
      findFirst: async () => null,
      findMany: async () => [],
    },
    geoCounty: {
      findFirst: async () => null,
    },
  } as unknown as PrismaClient;
}

describe('resolveOflcArea', () => {
  it('resolves override area codes', async () => {
    const prisma = createPrisma();
    prisma.oflcArea.findUnique = async () => baseArea;
    prisma.geoCountyToCbsa.findFirst = async () => ({
      cbsaCode: '12345',
      cbsa: { cbsaName: 'Metro', isMetropolitan: true },
    });
    prisma.geoCountyToCbsa.findMany = async () => [
      { county: { stateAb: 'TX' } },
      { county: { stateAb: 'OK' } },
    ];

    const result = await resolveOflcArea({
      prisma,
      datasetVersionId: 'oflc',
      geocode: { stateAb: 'TX', confidence: 'high', explain: [], countyFips: '48001' },
      overrideAreaCode: 'A1',
      featureTownMatching: true,
      cbsaVersionId: 'cbsa',
    });

    expect(result.kind).toBe('resolved');
    expect(result.area?.areaCode).toBe('A1');
    expect(result.cbsa?.isCrossState).toBe(true);
  });

  it('returns confirmation when town matches are ambiguous', async () => {
    const prisma = createPrisma();
    prisma.oflcAreaCounty.findMany = async () => [
      { ...baseArea, area: baseArea, areaCode: 'A1', stateAb: 'TX', countyFips: '48001', countyTownName: 'Austin', matchKind: 'town' },
      { ...baseArea, area: baseArea, areaCode: 'A2', stateAb: 'TX', countyFips: '48003', countyTownName: 'Austin', matchKind: 'town' },
    ];

    const result = await resolveOflcArea({
      prisma,
      datasetVersionId: 'oflc',
      geocode: { stateAb: 'TX', confidence: 'high', explain: [], placeName: 'Austin' },
      featureTownMatching: true,
    });

    expect(result.kind).toBe('needs_confirmation');
    expect(result.suggestions?.length).toBe(2);
  });

  it('resolves a single town match', async () => {
    const prisma = createPrisma();
    prisma.oflcAreaCounty.findMany = async () => [
      { area: baseArea, areaCode: 'A1', stateAb: 'TX', countyFips: '48001', countyTownName: 'Austin', matchKind: 'town' },
    ];

    const result = await resolveOflcArea({
      prisma,
      datasetVersionId: 'oflc',
      geocode: { stateAb: 'TX', confidence: 'high', explain: [], placeName: 'Austin' },
      featureTownMatching: true,
    });

    expect(result.kind).toBe('resolved');
    expect(result.area?.areaCode).toBe('A1');
  });

  it('resolves by county fips', async () => {
    const prisma = createPrisma();
    prisma.oflcAreaCounty.findFirst = async () => ({
      area: baseArea,
      areaCode: 'A1',
      stateAb: 'TX',
      countyFips: '48001',
      countyTownName: 'Travis County',
      matchKind: 'county',
    });

    const result = await resolveOflcArea({
      prisma,
      datasetVersionId: 'oflc',
      geocode: { stateAb: 'TX', confidence: 'high', explain: [], countyFips: '48001' },
      featureTownMatching: false,
    });

    expect(result.kind).toBe('resolved');
    expect(result.area?.matchKind).toBe('county');
  });

  it('returns confirmation for multiple county name matches', async () => {
    const prisma = createPrisma();
    prisma.oflcAreaCounty.findMany = async () => [
      { area: baseArea, areaCode: 'A1', stateAb: 'TX', countyFips: '48001', countyTownName: 'Travis County', matchKind: 'county' },
      { area: baseArea, areaCode: 'A2', stateAb: 'TX', countyFips: '48003', countyTownName: 'Travis County', matchKind: 'county' },
    ];

    const result = await resolveOflcArea({
      prisma,
      datasetVersionId: 'oflc',
      geocode: { stateAb: 'TX', confidence: 'high', explain: [], countyName: 'Travis County' },
      featureTownMatching: false,
    });

    expect(result.kind).toBe('needs_confirmation');
    expect(result.suggestions?.length).toBe(2);
  });

  it('resolves a single county name match', async () => {
    const prisma = createPrisma();
    prisma.oflcAreaCounty.findMany = async () => [
      { area: baseArea, areaCode: 'A1', stateAb: 'TX', countyFips: '48001', countyTownName: 'Travis County', matchKind: 'county' },
    ];

    const result = await resolveOflcArea({
      prisma,
      datasetVersionId: 'oflc',
      geocode: { stateAb: 'TX', confidence: 'high', explain: [], countyName: 'Travis County' },
      featureTownMatching: false,
    });

    expect(result.kind).toBe('resolved');
    expect(result.area?.areaCode).toBe('A1');
  });

  it('returns empty suggestions when state is missing', async () => {
    const prisma = createPrisma();
    const result = await resolveOflcArea({
      prisma,
      datasetVersionId: 'oflc',
      geocode: { stateAb: 'NA', confidence: 'low', explain: [] },
      featureTownMatching: false,
    });

    expect(result.kind).toBe('needs_confirmation');
    expect(result.suggestions).toEqual([]);
  });

  it('returns fallback suggestions when no direct match', async () => {
    const prisma = createPrisma();
    prisma.oflcAreaCounty.findMany = async () => [
      { area: baseArea, areaCode: 'A1', stateAb: 'TX', countyFips: '48001', countyTownName: 'Travis County', matchKind: 'county' },
    ];

    const result = await resolveOflcArea({
      prisma,
      datasetVersionId: 'oflc',
      geocode: { stateAb: 'TX', confidence: 'low', explain: [] },
      featureTownMatching: false,
    });

    expect(result.kind).toBe('needs_confirmation');
    expect(result.suggestions?.length).toBe(1);
  });
});

describe('resolveOflcAreaByTown', () => {
  it('returns confirmation for multiple town matches', async () => {
    const prisma = createPrisma();
    prisma.oflcAreaCounty.findMany = async () => [
      { area: baseArea, areaCode: 'A1', stateAb: 'TX', countyFips: '48001', countyTownName: 'Austin', matchKind: 'town' },
      { area: baseArea, areaCode: 'A2', stateAb: 'TX', countyFips: '48003', countyTownName: 'Austin', matchKind: 'town' },
    ];

    const result = await resolveOflcAreaByTown({
      prisma,
      datasetVersionId: 'oflc',
      stateAb: 'TX',
      townName: 'Austin',
    });

    expect(result.result.kind).toBe('needs_confirmation');
  });

  it('resolves a single town match and county name', async () => {
    const prisma = createPrisma();
    prisma.oflcAreaCounty.findMany = async () => [
      { area: baseArea, areaCode: 'A1', stateAb: 'TX', countyFips: '48001', countyTownName: 'Austin', matchKind: 'town' },
    ];
    prisma.geoCountyToCbsa.findFirst = async () => ({
      cbsaCode: '12345',
      cbsa: { cbsaName: 'Metro', isMetropolitan: true },
    });
    prisma.geoCountyToCbsa.findMany = async () => [{ county: { stateAb: 'TX' } }];
    prisma.geoCounty.findFirst = async () => ({ countyName: 'Travis County' });

    const result = await resolveOflcAreaByTown({
      prisma,
      datasetVersionId: 'oflc',
      stateAb: 'TX',
      townName: 'Austin',
      cbsaVersionId: 'cbsa',
    });

    expect(result.result.kind).toBe('resolved');
    expect(result.countyName).toBe('Travis County');
  });

  it('resolves exact area name match', async () => {
    const prisma = createPrisma();
    prisma.oflcAreaCounty.findMany = async () => [];
    prisma.oflcArea.findMany = async () => [
      { areaCode: 'A1', areaName: 'Austin, TX', stateAb: 'TX' },
    ];
    prisma.oflcAreaCounty.findFirst = async () => ({ countyFips: '48001' });

    const result = await resolveOflcAreaByTown({
      prisma,
      datasetVersionId: 'oflc',
      stateAb: 'TX',
      townName: 'Austin',
    });

    expect(result.result.kind).toBe('resolved');
    expect(result.result.area?.matchKind).toBe('area_name');
  });

  it('resolves a single area name match', async () => {
    const prisma = createPrisma();
    prisma.oflcAreaCounty.findMany = async () => [];
    prisma.oflcArea.findMany = async () => [
      { areaCode: 'A1', areaName: 'Austin Region', stateAb: 'TX' },
    ];
    prisma.oflcAreaCounty.findFirst = async () => ({ countyFips: '48001' });

    const result = await resolveOflcAreaByTown({
      prisma,
      datasetVersionId: 'oflc',
      stateAb: 'TX',
      townName: 'Austin',
    });

    expect(result.result.kind).toBe('resolved');
    expect(result.result.area?.areaCode).toBe('A1');
  });

  it('returns confirmation for multiple area name matches', async () => {
    const prisma = createPrisma();
    prisma.oflcAreaCounty.findMany = async () => [];
    prisma.oflcArea.findMany = async () => [
      { areaCode: 'A1', areaName: 'Austin North', stateAb: 'TX' },
      { areaCode: 'A2', areaName: 'Austin South', stateAb: 'TX' },
    ];

    const result = await resolveOflcAreaByTown({
      prisma,
      datasetVersionId: 'oflc',
      stateAb: 'TX',
      townName: 'Austin',
    });

    expect(result.result.kind).toBe('needs_confirmation');
    expect(result.result.suggestions?.length).toBe(2);
  });

  it('returns fallback suggestions when no matches', async () => {
    const prisma = createPrisma();
    prisma.oflcAreaCounty.findMany = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { area: baseArea, areaCode: 'A1', stateAb: 'TX', countyFips: '48001', countyTownName: 'Travis County', matchKind: 'county' },
      ]);

    const result = await resolveOflcAreaByTown({
      prisma,
      datasetVersionId: 'oflc',
      stateAb: 'TX',
      townName: 'Austin',
    });

    expect(result.result.kind).toBe('needs_confirmation');
    expect(result.result.suggestions?.length).toBe(1);
  });
});
