import type { Prisma, PrismaClient } from '@prisma/client';

import { cacheGet, cacheSet } from './cache';

export interface AreaMeta {
  areaCode: string;
  areaName: string;
  stateAb?: string | null;
  areaType: string;
  displayName?: string | null;
}

export interface WageLevel {
  annual: number;
  hourly: number;
}

export type SalaryUnit = 'year' | 'hour';

export interface WageRateDTO {
  area: AreaMeta;
  socCode: string;
  wageYear: string;
  isAcwia: boolean;
  level1: WageLevel;
  level2: WageLevel;
  level3: WageLevel;
  level4: WageLevel;
  hasDataQualityIssue: boolean;
  dataQualityNotes?: Record<string, unknown> | null;
}

export interface AreaWageRow {
  area: AreaMeta;
  level1: WageLevel;
  level2: WageLevel;
  level3: WageLevel;
  level4: WageLevel;
}

type DecimalValue = Prisma.Decimal | number;

function decimalToNumber(value: DecimalValue | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  return Number(value.toString());
}

function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}

export function computeMetWageLevel(params: {
  amount: number;
  unit: SalaryUnit;
  wage: WageRateDTO;
}): { metLevel: 0 | 1 | 2 | 3 | 4; basis: 'annual' | 'hourly' | 'either'; notes: string[] } {
  const { amount, unit, wage } = params;
  const levels = [wage.level1, wage.level2, wage.level3, wage.level4];
  const epsilon = 0.01;
  const annualAmount = unit === 'year' ? amount : amount * 2080;
  const hourlyAmount = unit === 'hour' ? amount : amount / 2080;

  const meets = (value: number, threshold: number) => value + epsilon >= threshold;

  let annualMet: 0 | 1 | 2 | 3 | 4 = 0;
  let hourlyMet: 0 | 1 | 2 | 3 | 4 = 0;

  levels.forEach((level, idx) => {
    const nextLevel = (idx + 1) as 1 | 2 | 3 | 4;
    if (meets(annualAmount, level.annual)) {
      annualMet = nextLevel;
    }
    if (meets(hourlyAmount, level.hourly)) {
      hourlyMet = nextLevel;
    }
  });

  const metLevel = (Math.max(annualMet, hourlyMet) as 0 | 1 | 2 | 3 | 4) ?? 0;
  let basis: 'annual' | 'hourly' | 'either' = 'either';
  if (annualMet > hourlyMet) {
    basis = 'annual';
  } else if (hourlyMet > annualMet) {
    basis = 'hourly';
  }

  const notes: string[] = [];
  if (annualMet !== hourlyMet) {
    notes.push(
      unit === 'year'
        ? 'Hourly comparison uses 2080 hours/year conversion.'
        : 'Annual comparison uses 2080 hours/year conversion.',
    );
    notes.push(`Annual level=${annualMet}, hourly level=${hourlyMet}.`);
  }

  return { metLevel, basis, notes };
}

function mapArea(
  area: { areaCode: string; areaName: string; stateAb?: string | null },
  extra?: Partial<AreaMeta>,
): AreaMeta {
  return {
    areaCode: area.areaCode,
    areaName: area.areaName,
    stateAb: area.stateAb ?? null,
    areaType: 'oflc',
    ...extra,
  };
}

function appendState(label: string | null | undefined, stateAb: string | null | undefined) {
  if (!label || !stateAb) return label ?? null;
  const stateToken = new RegExp(`\\b${stateAb}\\b`);
  if (stateToken.test(label)) {
    return label;
  }
  return `${label}, ${stateAb}`;
}

function normalizeLabel(value: string) {
  return value.trim().toLowerCase();
}

function splitAreaTokens(areaName: string) {
  return areaName
    .split(/[-,]/)
    .map((token) => normalizeLabel(token))
    .filter((token) => token.length > 0);
}

function selectMatchingName(names: string[], areaName: string) {
  if (!names.length) return null;
  const tokens = splitAreaTokens(areaName);
  if (!tokens.length) {
    return names[0] ?? null;
  }
  const normalized = names.map((name) => ({ name, normalized: normalizeLabel(name) }));
  const direct = normalized.find((entry) =>
    tokens.some((token) => entry.normalized.includes(token)),
  );
  return (direct ?? normalized[0] ?? null)?.name ?? null;
}

function buildDisplayName(params: {
  areaName: string;
  stateAb?: string | null;
  countyNames: string[];
  townNames: string[];
}) {
  const { areaName, stateAb, countyNames, townNames } = params;
  const countyName =
    selectMatchingName(countyNames, areaName) ?? selectMatchingName(townNames, areaName);
  const areaLabel = appendState(areaName, stateAb ?? null);
  if (countyName && areaLabel) {
    return `${countyName} - ${areaLabel}`;
  }
  return areaLabel ?? countyName ?? areaName;
}

function buildLevels(params: {
  l1Annual: number;
  l1Hourly: number | null;
  l2Annual: number | null;
  l2Hourly: number | null;
  l3Annual: number | null;
  l3Hourly: number | null;
  l4Annual: number | null;
  l4Hourly: number | null;
}) {
  const baseHourly = params.l1Hourly ?? roundToCents(params.l1Annual / 2080);
  const level1 = {
    annual: params.l1Annual,
    hourly: roundToCents(params.l1Hourly ?? baseHourly),
  };
  const level2 = {
    annual: params.l2Annual ?? params.l1Annual + 15000,
    hourly: roundToCents(params.l2Hourly ?? baseHourly + 8),
  };
  const level3 = {
    annual: params.l3Annual ?? params.l1Annual + 30000,
    hourly: roundToCents(params.l3Hourly ?? baseHourly + 16),
  };
  const level4 = {
    annual: params.l4Annual ?? params.l1Annual + 45000,
    hourly: roundToCents(params.l4Hourly ?? baseHourly + 24),
  };

  return { level1, level2, level3, level4 };
}

export async function getWageRate(params: {
  prisma: PrismaClient;
  datasetVersionId: string;
  wageYear: string;
  isAcwia: boolean;
  areaCode: string;
  socCode: string;
}): Promise<WageRateDTO | null> {
  const { prisma, datasetVersionId, wageYear, isAcwia, areaCode, socCode } = params;
  const cacheKey = `wage:${datasetVersionId}:${wageYear}:${isAcwia}:${areaCode}:${socCode}`;
  const cached = await cacheGet<WageRateDTO | null>(cacheKey);
  if (cached) {
    return cached;
  }

  const record = await prisma.wageRate.findFirst({
    where: {
      datasetVersionId,
      wageYear,
      isAcwia,
      areaCode,
      socCode,
    },
    include: {
      area: true,
    },
  });

  if (!record) {
    await cacheSet(cacheKey, null, 3600);
    return null;
  }

  const levels = buildLevels({
    l1Annual: record.l1Annual,
    l1Hourly: decimalToNumber(record.l1Hourly),
    l2Annual: record.l2Annual ?? null,
    l2Hourly: decimalToNumber(record.l2Hourly),
    l3Annual: record.l3Annual ?? null,
    l3Hourly: decimalToNumber(record.l3Hourly),
    l4Annual: record.l4Annual ?? null,
    l4Hourly: decimalToNumber(record.l4Hourly),
  });

  const result: WageRateDTO = {
    area: mapArea(record.area),
    socCode: record.socCode,
    wageYear: record.wageYear,
    isAcwia: record.isAcwia,
    ...levels,
    hasDataQualityIssue: record.hasDataQualityIssue,
    dataQualityNotes:
      record.dataQualityNotes &&
      typeof record.dataQualityNotes === 'object' &&
      !Array.isArray(record.dataQualityNotes)
        ? (record.dataQualityNotes as Record<string, unknown>)
        : null,
  };
  await cacheSet(cacheKey, result, 3600);
  return result;
}

export async function getSocExtremes(params: {
  prisma: PrismaClient;
  datasetVersionId: string;
  wageYear: string;
  isAcwia: boolean;
  socCode: string;
  metric: 'l1Annual';
  n: number;
}): Promise<{ lowest: AreaWageRow[]; highest: AreaWageRow[] }> {
  const { prisma, datasetVersionId, wageYear, isAcwia, socCode, n } = params;
  const cacheKey = `extremes:${datasetVersionId}:${wageYear}:${isAcwia}:${socCode}:${n}`;
  const cached = await cacheGet<{ lowest: AreaWageRow[]; highest: AreaWageRow[] }>(cacheKey);
  if (cached) {
    return cached;
  }

  const lowest = await prisma.wageRate.findMany({
    where: {
      datasetVersionId,
      wageYear,
      isAcwia,
      socCode,
    },
    include: {
      area: true,
    },
    orderBy: [{ l1Annual: 'asc' }, { areaCode: 'asc' }],
    take: n,
  });

  const highest = await prisma.wageRate.findMany({
    where: {
      datasetVersionId,
      wageYear,
      isAcwia,
      socCode,
    },
    include: {
      area: true,
    },
    orderBy: [{ l1Annual: 'desc' }, { areaCode: 'asc' }],
    take: n,
  });

  const areaCodes = Array.from(
    new Set([...lowest.map((row) => row.areaCode), ...highest.map((row) => row.areaCode)]),
  );
  const countyRows =
    areaCodes.length > 0
      ? await prisma.oflcAreaCounty.findMany({
          where: {
            datasetVersionId,
            areaCode: { in: areaCodes },
          },
          select: {
            areaCode: true,
            countyTownName: true,
            matchKind: true,
            stateAb: true,
          },
          orderBy: [{ matchKind: 'asc' }, { countyTownName: 'asc' }],
        })
      : [];

  type AreaHint = {
    countyNames: string[];
    townNames: string[];
    stateAb: string | null;
  };
  const areaHints = new Map<string, AreaHint>();
  for (const row of countyRows) {
    let entry = areaHints.get(row.areaCode);
    if (!entry) {
      entry = { stateAb: row.stateAb ?? null, countyNames: [], townNames: [] };
      areaHints.set(row.areaCode, entry);
    }
    if (!entry.stateAb && row.stateAb) {
      entry.stateAb = row.stateAb;
    }
    if (row.matchKind === 'county' && !entry.countyNames.includes(row.countyTownName)) {
      entry.countyNames.push(row.countyTownName);
    }
    if (row.matchKind === 'town' && !entry.townNames.includes(row.countyTownName)) {
      entry.townNames.push(row.countyTownName);
    }
  }

  const result = {
    lowest: lowest.map((row) => {
      const levels = buildLevels({
        l1Annual: row.l1Annual,
        l1Hourly: decimalToNumber(row.l1Hourly),
        l2Annual: row.l2Annual ?? null,
        l2Hourly: decimalToNumber(row.l2Hourly),
        l3Annual: row.l3Annual ?? null,
        l3Hourly: decimalToNumber(row.l3Hourly),
        l4Annual: row.l4Annual ?? null,
        l4Hourly: decimalToNumber(row.l4Hourly),
      });
      const hints = areaHints.get(row.areaCode);
      const displayName = buildDisplayName({
        areaName: row.area.areaName,
        stateAb: row.area.stateAb ?? hints?.stateAb ?? null,
        countyNames: hints?.countyNames ?? [],
        townNames: hints?.townNames ?? [],
      });
      return {
        area: mapArea(row.area, { displayName }),
        ...levels,
      };
    }),
    highest: highest.map((row) => {
      const levels = buildLevels({
        l1Annual: row.l1Annual,
        l1Hourly: decimalToNumber(row.l1Hourly),
        l2Annual: row.l2Annual ?? null,
        l2Hourly: decimalToNumber(row.l2Hourly),
        l3Annual: row.l3Annual ?? null,
        l3Hourly: decimalToNumber(row.l3Hourly),
        l4Annual: row.l4Annual ?? null,
        l4Hourly: decimalToNumber(row.l4Hourly),
      });
      const hints = areaHints.get(row.areaCode);
      const displayName = buildDisplayName({
        areaName: row.area.areaName,
        stateAb: row.area.stateAb ?? hints?.stateAb ?? null,
        countyNames: hints?.countyNames ?? [],
        townNames: hints?.townNames ?? [],
      });
      return {
        area: mapArea(row.area, { displayName }),
        ...levels,
      };
    }),
  };
  await cacheSet(cacheKey, result, 3600);
  return result;
}
