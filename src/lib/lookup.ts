import type { PrismaClient } from '@prisma/client';

import type { GeocodeInput, GeocodeResult } from './geocoder';
import { geocode } from './geocoder';
import type { ResolveGeoSuggestion } from './resolveGeo';
import { resolveOflcArea } from './resolveGeo';
import type { WageRateDTO, AreaWageRow, WageLevel, SalaryUnit } from './wages';
import { computeMetWageLevel, getSocExtremes, getWageRate } from './wages';
import { getDutiesForOnetCode, getDutiesForSoc } from './duties';
import { normalizeSocInput } from './soc';
import { parseFullAddress } from './address';
import type { DatasetVersionLabel } from './constants';
import { captureDatasetContext } from './constants';

export type LookupKind =
  | 'geo_only'
  | 'geo_wage'
  | 'soc_extremes'
  | 'geo_needs_confirmation';

export type DatasetVersionInfo = DatasetVersionLabel;

export interface ExplainBlock {
  summary: string[];
}

export interface LookupRequest {
  address?: GeocodeInput;
  socCode?: string;
  wageYear?: string;
  isAcwia?: boolean;
  proposedSalary?: number;
  salaryUnit?: SalaryUnit;
  override?: {
    areaCode?: string;
  };
}

export interface LookupResponse {
  kind: LookupKind;
  datasetVersions: {
    oflc?: DatasetVersionInfo;
    onet?: DatasetVersionInfo;
    cbsa?: DatasetVersionInfo;
  };
  featureFlags?: {
    wageQualityBanner: boolean;
  };
  explain: ExplainBlock;
  geo?: {
    geocode: GeocodeResult;
    area?: { areaCode: string; areaName: string; stateAb?: string | null; matchKind?: string | null };
    countyName?: string;
    placeName?: string;
    cbsa?: {
      cbsaCode: string;
      cbsaName: string;
      isMetropolitan: boolean;
      isCrossState: boolean;
      statesInMsa: string[];
    };
  };
  wages?: {
    wageYear: string;
    isAcwia: boolean;
    area?: WageRateDTO['area'];
    level1?: WageLevel;
    level2?: WageLevel;
    level3?: WageLevel;
    level4?: WageLevel;
    hasDataQualityIssue?: boolean;
    proposedSalary?: {
      amount: number;
      unit: SalaryUnit;
    };
    metWageLevel?: {
      metLevel: 0 | 1 | 2 | 3 | 4;
      basis: 'annual' | 'hourly' | 'either';
      notes: string[];
    };
    dataQuality?: {
      hasIssue: boolean;
      notes?: string[];
      meta?: Record<string, unknown> | null;
    };
  };
  duties?: {
    duties: { text: string; sources: string[] }[];
    note?: string;
  };
  extremes?: {
    lowest: AreaWageRow[];
    highest: AreaWageRow[];
  };
  confirmation?: {
    suggestions: ResolveGeoSuggestion[];
  };
  warnings?: string[];
}

export class LookupError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  return value === 'true';
}

async function maybeDelay() {
  const raw = process.env.LOOKUP_DELAY_MS;
  if (!raw) return;
  const delayMs = Number(raw);
  if (!Number.isFinite(delayMs) || delayMs <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function lookup(
  req: LookupRequest,
  deps: { prisma: PrismaClient },
): Promise<LookupResponse> {
  const { prisma } = deps;
  const warnings: string[] = [];
  const explainSummary: string[] = [];
  const getSummary = () => {
    const trimmed = explainSummary.filter((entry) => entry.trim().length > 0);
    if (trimmed.length === 0) {
      trimmed.push('No explanation available.');
    }
    return trimmed.slice(0, 5);
  };

  const datasetContext = await captureDatasetContext(prisma);
  const versionsByName = datasetContext.labels;
  const oflcVersionId = datasetContext.oflcVersionId;
  const onetVersionId = datasetContext.onetVersionId;
  const cbsaVersionId = datasetContext.cbsaVersionId;
  await maybeDelay();

  const defaultWageYear = process.env.DEFAULT_WAGE_YEAR ?? '2025-2026';
  const defaultIsAcwia = parseBoolean(process.env.DEFAULT_IS_ACWIA, false);
  const wageYear = req.wageYear ?? defaultWageYear;
  const isAcwia = req.isAcwia ?? defaultIsAcwia;
  const salaryUnit: SalaryUnit = req.salaryUnit === 'hour' ? 'hour' : 'year';
  const featureFlags = {
    wageQualityBanner: parseBoolean(process.env.FEATURE_WAGE_QUALITY_BANNER, true),
  };

  let address = req.address;
  if (address?.fullText) {
    const parsed = parseFullAddress(address.fullText);
    if (parsed.warnings.length) {
      warnings.push(...parsed.warnings);
    }
    const baseLine1 = address.line1?.trim() || parsed.line1;
    const line1 =
      baseLine1 && parsed.line2 && !baseLine1.toLowerCase().includes(parsed.line2.toLowerCase())
        ? `${baseLine1} ${parsed.line2}`.trim()
        : baseLine1;
    address = {
      ...address,
      line1: address.line1 ?? (line1 || undefined),
      city: address.city ?? (parsed.city || undefined),
      state: address.state ?? (parsed.state || undefined),
      zip: address.zip ?? (parsed.zip || undefined),
    };
  }

  const normalizedSoc = req.socCode ? normalizeSocInput(req.socCode) : null;
  if (normalizedSoc?.warnings?.length) {
    warnings.push(...normalizedSoc.warnings);
  }
  const soc6 = normalizedSoc?.soc6 ?? null;
  const onet8 = normalizedSoc?.onet8 ?? null;

  if (req.socCode && !soc6) {
    warnings.push('SOC code ignored due to invalid format.');
  }

  if (!address && !soc6) {
    throw new Error('Either address or socCode is required.');
  }

  if (soc6) {
    const socExists = await prisma.socTitle.findFirst({
      where: { datasetVersionId: oflcVersionId, socCode: soc6 },
      select: { socCode: true },
    });

    if (!socExists) {
      throw new LookupError(
        `SOC ${soc6} was not found in the active dataset.`,
        422,
        'SOC_NOT_FOUND',
      );
    }
  }

  const resolveDuties = async (socCode: string) => {
    if (!onetVersionId) {
      return { duties: [], note: 'Active O*NET dataset version not found.' };
    }

    if (onet8) {
      const direct = await getDutiesForOnetCode({
        prisma,
        datasetVersionId: onetVersionId,
        onetCode: onet8,
      });
      if (direct.duties.length > 0) {
        return direct;
      }
      warnings.push(`No duties found for ${onet8}; falling back to SOC-6 mapping.`);
    }

    return getDutiesForSoc({ prisma, datasetVersionId: onetVersionId, socCode });
  };

  if (address) {
    const geocodeResult = await geocode(address);
    explainSummary.push(...geocodeResult.explain);

    const resolveResult = await resolveOflcArea({
      prisma,
      datasetVersionId: oflcVersionId,
      geocode: geocodeResult,
      overrideAreaCode: req.override?.areaCode,
      featureTownMatching: parseBoolean(process.env.FEATURE_TOWN_MATCHING, true),
      cbsaVersionId,
    });

    explainSummary.push(...resolveResult.explain);

    if (resolveResult.kind === 'needs_confirmation') {
      const extremes = soc6
        ? await getSocExtremes({
            prisma,
            datasetVersionId: oflcVersionId,
            wageYear,
            isAcwia,
            socCode: soc6,
            metric: 'l1Annual',
            n: 8,
          })
        : undefined;
      return {
        kind: 'geo_needs_confirmation',
        datasetVersions: {
          oflc: versionsByName.oflc,
          onet: versionsByName.onet,
          cbsa: versionsByName.cbsa,
        },
        featureFlags,
        explain: { summary: getSummary() },
        geo: {
          geocode: geocodeResult,
          countyName: geocodeResult.countyName,
          placeName: geocodeResult.placeName,
        },
        confirmation: {
          suggestions: resolveResult.suggestions ?? [],
        },
        extremes,
        warnings: warnings.length ? warnings : undefined,
      };
    }

    const geoArea = resolveResult.area;
    const geo = {
      geocode: geocodeResult,
      area: geoArea,
      countyName: geocodeResult.countyName,
      placeName: geocodeResult.placeName,
      cbsa: resolveResult.cbsa,
    };

    if (!soc6) {
      return {
        kind: 'geo_only',
        datasetVersions: {
          oflc: versionsByName.oflc,
          onet: versionsByName.onet,
          cbsa: versionsByName.cbsa,
        },
        featureFlags,
        explain: { summary: getSummary() },
        geo,
        warnings: warnings.length ? warnings : undefined,
      };
    }

    const wages = await getWageRate({
      prisma,
      datasetVersionId: oflcVersionId,
      wageYear,
      isAcwia,
      areaCode: geoArea?.areaCode ?? '',
      socCode: soc6,
    });

    const duties = await resolveDuties(soc6);
    const extremes = await getSocExtremes({
      prisma,
      datasetVersionId: oflcVersionId,
      wageYear,
      isAcwia,
      socCode: soc6,
      metric: 'l1Annual',
      n: 8,
    });

    const proposedSalary =
      typeof req.proposedSalary === 'number' && Number.isFinite(req.proposedSalary)
        ? { amount: req.proposedSalary, unit: salaryUnit }
        : undefined;

    const dataQuality =
      wages && (wages.hasDataQualityIssue || wages.dataQualityNotes)
        ? {
            hasIssue: wages.hasDataQualityIssue,
            notes: Array.isArray((wages.dataQualityNotes as any)?.issues)
              ? ((wages.dataQualityNotes as any).issues as string[])
              : undefined,
            meta: wages.dataQualityNotes ?? null,
          }
        : undefined;

    const metWageLevel =
      wages && proposedSalary
        ? computeMetWageLevel({
            amount: proposedSalary.amount,
            unit: proposedSalary.unit,
            wage: wages,
          })
        : undefined;

    const wagePayload = wages
      ? {
          wageYear,
          isAcwia,
          area: wages.area,
          level1: wages.level1,
          level2: wages.level2,
          level3: wages.level3,
          level4: wages.level4,
          hasDataQualityIssue: wages.hasDataQualityIssue,
          ...(proposedSalary ? { proposedSalary } : {}),
          ...(metWageLevel ? { metWageLevel } : {}),
          ...(dataQuality ? { dataQuality } : {}),
        }
      : {
          wageYear,
          isAcwia,
          ...(proposedSalary ? { proposedSalary } : {}),
        };

    return {
      kind: 'geo_wage',
      datasetVersions: {
        oflc: versionsByName.oflc,
        onet: versionsByName.onet,
        cbsa: versionsByName.cbsa,
      },
      featureFlags,
      explain: { summary: getSummary() },
      geo,
      wages: wagePayload,
      duties,
      extremes,
      warnings: warnings.length ? warnings : undefined,
    };
  }

  explainSummary.push(`SOC-only lookup for ${soc6 ?? 'unknown'}.`);

  const extremes = await getSocExtremes({
    prisma,
    datasetVersionId: oflcVersionId,
    wageYear,
    isAcwia,
    socCode: soc6 ?? '',
    metric: 'l1Annual',
    n: 8,
  });

  const duties = soc6 ? await resolveDuties(soc6) : { duties: [] };

  return {
    kind: 'soc_extremes',
    datasetVersions: {
      oflc: versionsByName.oflc,
      onet: versionsByName.onet,
      cbsa: versionsByName.cbsa,
    },
    featureFlags,
    explain: { summary: getSummary() },
    extremes,
    duties,
    warnings: warnings.length ? warnings : undefined,
  };
}
