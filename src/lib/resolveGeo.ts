import type { PrismaClient } from '@prisma/client';

import type { GeocodeResult } from './geocoder';

export interface ResolveGeoArea {
  areaCode: string;
  areaName: string;
  stateAb?: string | null;
  matchKind?: string | null;
}

export interface ResolveGeoCbsa {
  cbsaCode: string;
  cbsaName: string;
  isMetropolitan: boolean;
  isCrossState: boolean;
  statesInMsa: string[];
}

export interface ResolveGeoSuggestion {
  areaCode: string;
  areaName: string;
  areaType?: string;
  stateAb: string;
  countyFips: string;
  countyTownName: string;
  matchKind: string;
}

export interface ResolveGeoResult {
  kind: 'resolved' | 'needs_confirmation';
  area?: ResolveGeoArea;
  suggestions?: ResolveGeoSuggestion[];
  cbsa?: ResolveGeoCbsa;
  explain: string[];
}

export interface ResolveTownResult {
  result: ResolveGeoResult;
  countyFips?: string;
  countyName?: string;
  placeName: string;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function normalizePlaceName(value: string): string {
  return normalizeText(value).replace(/\b(town|city|village|borough|township)\b$/i, '').trim();
}

async function resolveCbsaMeta(params: {
  prisma: PrismaClient;
  cbsaVersionId?: string;
  countyFips?: string;
}): Promise<ResolveGeoCbsa | undefined> {
  const { prisma, cbsaVersionId, countyFips } = params;
  if (!cbsaVersionId || !countyFips) {
    return undefined;
  }

  const link = await prisma.geoCountyToCbsa.findFirst({
    where: { datasetVersionId: cbsaVersionId, countyFips },
    include: { cbsa: true },
  });

  if (!link) {
    return undefined;
  }

  const counties = await prisma.geoCountyToCbsa.findMany({
    where: { datasetVersionId: cbsaVersionId, cbsaCode: link.cbsaCode },
    include: { county: true },
  });

  const statesInMsa = Array.from(
    new Set(counties.map((entry) => entry.county.stateAb)),
  ).sort();

  return {
    cbsaCode: link.cbsaCode,
    cbsaName: link.cbsa.cbsaName,
    isMetropolitan: link.cbsa.isMetropolitan,
    isCrossState: statesInMsa.length > 1,
    statesInMsa,
  };
}

function buildSuggestions(entries: Array<{
  areaCode: string;
  stateAb: string;
  countyFips: string;
  countyTownName: string;
  matchKind: string;
  area: { areaName: string };
}>): ResolveGeoSuggestion[] {
  return entries.map((entry) => ({
    areaCode: entry.areaCode,
    areaName: entry.area.areaName,
    areaType: 'oflc',
    stateAb: entry.stateAb,
    countyFips: entry.countyFips,
    countyTownName: entry.countyTownName,
    matchKind: entry.matchKind,
  }));
}

export async function resolveOflcArea(params: {
  prisma: PrismaClient;
  datasetVersionId: string;
  geocode: GeocodeResult;
  overrideAreaCode?: string;
  featureTownMatching: boolean;
  cbsaVersionId?: string;
}): Promise<ResolveGeoResult> {
  const {
    prisma,
    datasetVersionId,
    geocode,
    overrideAreaCode,
    featureTownMatching,
    cbsaVersionId,
  } = params;
  const explain: string[] = [];

  if (overrideAreaCode) {
    const area = await prisma.oflcArea.findUnique({
      where: {
        datasetVersionId_areaCode: {
          datasetVersionId,
          areaCode: overrideAreaCode,
        },
      },
    });

    explain.push(`Override area code provided: ${overrideAreaCode}.`);
    const cbsa = await resolveCbsaMeta({
      prisma,
      cbsaVersionId,
      countyFips: geocode.countyFips,
    });

    return {
      kind: 'resolved',
      area: {
        areaCode: overrideAreaCode,
        areaName: area?.areaName ?? 'Override area',
        stateAb: area?.stateAb ?? geocode.stateAb,
        matchKind: 'override',
      },
      cbsa,
      explain,
    };
  }

  if (featureTownMatching && geocode.placeName) {
    const townMatches = await prisma.oflcAreaCounty.findMany({
      where: {
        datasetVersionId,
        stateAb: geocode.stateAb,
        countyTownNameNorm: normalizePlaceName(geocode.placeName),
        matchKind: 'town',
      },
      include: {
        area: true,
      },
    });

    if (townMatches.length > 1) {
      explain.push(`Multiple town matches for ${geocode.placeName}.`);
      return {
        kind: 'needs_confirmation',
        explain,
        suggestions: buildSuggestions(townMatches),
      };
    }

    if (townMatches.length === 1) {
      const townMatch = townMatches[0];
      explain.push(`Matched town name ${geocode.placeName}.`);
      const cbsa = await resolveCbsaMeta({
        prisma,
        cbsaVersionId,
        countyFips: townMatch.countyFips,
      });
      return {
        kind: 'resolved',
        area: {
          areaCode: townMatch.areaCode,
          areaName: townMatch.area.areaName,
          stateAb: townMatch.area.stateAb,
          matchKind: townMatch.matchKind,
        },
        cbsa,
        explain,
      };
    }
  }

  if (geocode.countyFips) {
    const countyMatch = await prisma.oflcAreaCounty.findFirst({
      where: {
        datasetVersionId,
        countyFips: geocode.countyFips,
        matchKind: 'county',
      },
      include: {
        area: true,
      },
    });

    if (countyMatch) {
      explain.push(`Matched county FIPS ${geocode.countyFips}.`);
      const cbsa = await resolveCbsaMeta({
        prisma,
        cbsaVersionId,
        countyFips: countyMatch.countyFips,
      });
      return {
        kind: 'resolved',
        area: {
          areaCode: countyMatch.areaCode,
          areaName: countyMatch.area.areaName,
          stateAb: countyMatch.area.stateAb,
          matchKind: countyMatch.matchKind,
        },
        cbsa,
        explain,
      };
    }
  }

  if (geocode.countyName) {
    const countyNameMatches = await prisma.oflcAreaCounty.findMany({
      where: {
        datasetVersionId,
        stateAb: geocode.stateAb,
        countyTownNameNorm: normalizeText(geocode.countyName),
        matchKind: 'county',
      },
      include: {
        area: true,
      },
    });

    if (countyNameMatches.length > 1) {
      explain.push(`Multiple county matches for ${geocode.countyName}.`);
      return {
        kind: 'needs_confirmation',
        explain,
        suggestions: buildSuggestions(countyNameMatches),
      };
    }

    if (countyNameMatches.length === 1) {
      const countyNameMatch = countyNameMatches[0];
      explain.push(`Matched county name ${geocode.countyName}.`);
      const cbsa = await resolveCbsaMeta({
        prisma,
        cbsaVersionId,
        countyFips: countyNameMatch.countyFips,
      });
      return {
        kind: 'resolved',
        area: {
          areaCode: countyNameMatch.areaCode,
          areaName: countyNameMatch.area.areaName,
          stateAb: countyNameMatch.area.stateAb,
          matchKind: countyNameMatch.matchKind,
        },
        cbsa,
        explain,
      };
    }
  }

  if (geocode.stateAb === 'NA') {
    explain.push('Missing state; unable to generate confirmation candidates.');
    return { kind: 'needs_confirmation', explain, suggestions: [] };
  }

  const suggestions = await prisma.oflcAreaCounty.findMany({
    where: {
      datasetVersionId,
      stateAb: geocode.stateAb,
    },
    include: {
      area: true,
    },
    distinct: ['areaCode'],
    orderBy: [{ countyTownNameNorm: 'asc' }, { areaCode: 'asc' }],
    take: 10,
  });

  explain.push('No direct match; returning confirmation candidates.');

  return {
    kind: 'needs_confirmation',
    explain,
    suggestions: buildSuggestions(suggestions),
  };
}

export async function resolveOflcAreaByTown(params: {
  prisma: PrismaClient;
  datasetVersionId: string;
  stateAb: string;
  townName: string;
  cbsaVersionId?: string;
}): Promise<ResolveTownResult> {
  const { prisma, datasetVersionId, stateAb, townName, cbsaVersionId } = params;
  const explain: string[] = [`City-only match: ${townName}.`];
  const normalizedTown = normalizePlaceName(townName);

  const townMatches = await prisma.oflcAreaCounty.findMany({
    where: {
      datasetVersionId,
      stateAb,
      countyTownNameNorm: normalizedTown,
      matchKind: 'town',
    },
    include: {
      area: true,
    },
  });

  if (townMatches.length > 1) {
    explain.push(`Multiple town matches for ${townName}.`);
    return {
      result: {
        kind: 'needs_confirmation',
        explain,
        suggestions: buildSuggestions(townMatches),
      },
      placeName: townName,
    };
  }

  if (townMatches.length === 1) {
    const townMatch = townMatches[0];
    explain.push(`Matched town name ${townName}.`);
    const cbsa = await resolveCbsaMeta({
      prisma,
      cbsaVersionId,
      countyFips: townMatch.countyFips,
    });

    const countyName =
      cbsaVersionId && townMatch.countyFips
        ? (
          await prisma.geoCounty.findFirst({
            where: { datasetVersionId: cbsaVersionId, countyFips: townMatch.countyFips },
            select: { countyName: true },
          })
        )?.countyName
        : undefined;

    return {
      result: {
        kind: 'resolved',
        area: {
          areaCode: townMatch.areaCode,
          areaName: townMatch.area.areaName,
          stateAb: townMatch.area.stateAb,
          matchKind: townMatch.matchKind,
        },
        cbsa,
        explain,
      },
      countyFips: townMatch.countyFips,
      countyName,
      placeName: townName,
    };
  }

  const areaMatches = await prisma.oflcArea.findMany({
    where: {
      datasetVersionId,
      stateAb,
      areaName: { contains: townName, mode: 'insensitive' },
    },
  });
  if (areaMatches.length > 0) {
    const exactName = `${townName}, ${stateAb}`;
    const exactMatch = areaMatches.find(
      (entry) => entry.areaName.toLowerCase() === exactName.toLowerCase(),
    );
    if (exactMatch) {
      explain.push(`Matched area name ${exactMatch.areaName}.`);
      const countyFips = (
        await prisma.oflcAreaCounty.findFirst({
          where: { datasetVersionId, areaCode: exactMatch.areaCode, stateAb },
          select: { countyFips: true },
        })
      )?.countyFips;
      const cbsa = await resolveCbsaMeta({
        prisma,
        cbsaVersionId,
        countyFips,
      });
      return {
        result: {
          kind: 'resolved',
          area: {
            areaCode: exactMatch.areaCode,
            areaName: exactMatch.areaName,
            stateAb: exactMatch.stateAb,
            matchKind: 'area_name',
          },
          cbsa,
          explain,
        },
        placeName: townName,
      };
    }

    if (areaMatches.length === 1) {
      const onlyMatch = areaMatches[0];
      explain.push(`Matched area name ${onlyMatch.areaName}.`);
      const countyFips = (
        await prisma.oflcAreaCounty.findFirst({
          where: { datasetVersionId, areaCode: onlyMatch.areaCode, stateAb },
          select: { countyFips: true },
        })
      )?.countyFips;
      const cbsa = await resolveCbsaMeta({
        prisma,
        cbsaVersionId,
        countyFips,
      });
      return {
        result: {
          kind: 'resolved',
          area: {
            areaCode: onlyMatch.areaCode,
            areaName: onlyMatch.areaName,
            stateAb: onlyMatch.stateAb,
            matchKind: 'area_name',
          },
          cbsa,
          explain,
        },
        placeName: townName,
      };
    }

    explain.push(`Area name contains ${townName}.`);
    const suggestions: ResolveGeoSuggestion[] = areaMatches.map((entry) => ({
      areaCode: entry.areaCode,
      areaName: entry.areaName,
      areaType: 'oflc',
      stateAb: entry.stateAb ?? stateAb,
      countyFips: '',
      countyTownName: townName,
      matchKind: 'area_name',
    }));
    return {
      result: {
        kind: 'needs_confirmation',
        explain,
        suggestions,
      },
      placeName: townName,
    };
  }

  const suggestions = await prisma.oflcAreaCounty.findMany({
    where: {
      datasetVersionId,
      stateAb,
    },
    include: {
      area: true,
    },
    distinct: ['areaCode'],
    orderBy: [{ countyTownNameNorm: 'asc' }, { areaCode: 'asc' }],
    take: 10,
  });

  explain.push('No direct town match; returning confirmation candidates.');

  return {
    result: {
      kind: 'needs_confirmation',
      explain,
      suggestions: buildSuggestions(suggestions),
    },
    placeName: townName,
  };
}
