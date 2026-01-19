import { NextResponse } from 'next/server';

import { getPrisma } from '../../../../../src/db/prisma';
import { requireAccess } from '../../../../../src/lib/access';
import { captureDatasetContext } from '../../../../../src/lib/constants';
import { rateLimitOrThrow, RateLimitError } from '../../../../../src/lib/rateLimit';
import { matchDuties, EmbeddingsNotReadyError, DutiesMatchTimeoutError } from '../../../../../src/lib/match/dutiesMatch';

export const runtime = "nodejs";

class TimeoutError extends Error {}

function parseLimit(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, parsed);
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === 'true';
}

function toSocCode(onetCode: string): string {
  const trimmed = onetCode.trim();
  const match = trimmed.match(/^(\d{2}-\d{4})(?:\.\d{2})?$/);
  if (match) {
    return match[1];
  }
  const base = trimmed.split('.')[0];
  return base || trimmed;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) {
    return promise;
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError('Enrichment timed out.')), ms);
    promise
      .then((result) => resolve(result))
      .catch((error) => reject(error))
      .finally(() => clearTimeout(timer));
  });
}

function shouldInjectDelay(): number | null {
  if (process.env.NODE_ENV !== 'test') return null;
  const raw = process.env.TEST_INJECT_ENRICHMENT_DELAY_MS;
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeDataQualityNotes(
  value: unknown,
): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export async function POST(req: Request) {
  const prisma = getPrisma();
  const startTime = Date.now();

  if (process.env.FEATURE_SOC_RECOMMENDER !== 'true') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    await requireAccess(req, prisma);
    await rateLimitOrThrow({
      key: 'soc_recommend',
      limitPerMin: parseLimit(process.env.RATE_LIMIT_LOOKUP_PER_MIN, 50),
      req,
    });

    const body = await req.json();
    const rawInput = typeof body?.dutiesText === 'string' ? body.dutiesText.trim() : '';

    if (!rawInput) {
      return NextResponse.json({ error: 'dutiesText is required' }, { status: 400 });
    }

    const internalTopK = parseLimit(process.env.SOC_RECOMMEND_INTERNAL_TOPK, 30);
    const outputTopK = parseLimit(process.env.SOC_RECOMMEND_OUTPUT_TOPK, 6);
    const statementTimeoutMs = parseLimit(
      process.env.SOC_RECOMMEND_STATEMENT_TIMEOUT_MS,
      1500,
    );
    const enrichmentTimeoutMs = parseLimit(
      process.env.SOC_RECOMMEND_ENRICHMENT_TIMEOUT_MS,
      300,
    );

    const dutiesMatch = await matchDuties({
      prisma,
      dutiesText: rawInput,
      internalTopK,
      outputTopK,
      statementTimeoutMs,
    });

    const onetCodes = dutiesMatch.onetCodes;
    const socCodes = Array.from(new Set(onetCodes.map((code) => toSocCode(code))));

    const datasetContext = await captureDatasetContext(prisma);
    const oflcVersionId = datasetContext.oflcVersionId;

    const warnings: string[] = [];
    if (datasetContext.onetVersionId !== dutiesMatch.onetDatasetVersionId) {
      warnings.push('Active O*NET dataset version differs from the embedding dataset version.');
    }

    const fetchDuties = async () => {
      const delayMs = shouldInjectDelay();
      if (delayMs) {
        await delay(delayMs);
      }

      const dutyRows = await prisma.onetDuty.findMany({
        where: {
          datasetVersionId: dutiesMatch.onetDatasetVersionId,
          onetCode: { in: onetCodes },
        },
        select: { onetCode: true, dutyText: true, sortOrder: true },
        orderBy: [{ onetCode: 'asc' }, { sortOrder: 'asc' }],
      });

      const dutiesByCode = new Map<string, { duties: string[]; count: number }>();
      for (const row of dutyRows) {
        let entry = dutiesByCode.get(row.onetCode);
        if (!entry) {
          entry = { duties: [], count: 0 };
          dutiesByCode.set(row.onetCode, entry);
        }
        entry.count += 1;
        entry.duties.push(row.dutyText);
      }

      return dutiesByCode;
    };

    const fetchWages = async () => {
      const areaCodeRaw = typeof body?.areaCode === 'string' ? body.areaCode.trim() : '';
      const fallbackAreaCode = (process.env.WAGE_NATIONAL_AREA_CODE ?? '').trim();
      const defaultWageYear = process.env.DEFAULT_WAGE_YEAR ?? '2025-2026';
      const defaultIsAcwia = parseBoolean(process.env.DEFAULT_IS_ACWIA, false);
      const wageYear = typeof body?.wageYear === 'string' && body.wageYear.trim()
        ? body.wageYear.trim()
        : defaultWageYear;
      const isAcwia =
        typeof body?.isAcwia === 'boolean' ? body.isAcwia : defaultIsAcwia;

      if (process.env.NODE_ENV === 'test' && process.env.TEST_INJECT_WAGE_ERROR === 'true') {
        throw new Error('Injected wage error');
      }

      if (!areaCodeRaw && !fallbackAreaCode) {
        return {
          wageYear,
          isAcwia,
          wagesBySoc: new Map<string, unknown>(),
          sourceBySoc: new Map<string, 'LOCAL' | 'NATIONAL'>(),
          areaBySoc: new Map<string, string>(),
          skipped: 'MISSING_WAGE_CONTEXT' as const,
        };
      }

      const delayMs = shouldInjectDelay();
      if (delayMs) {
        await delay(delayMs);
      }

      const wagesBySoc = new Map<string, any>();
      const sourceBySoc = new Map<string, 'LOCAL' | 'NATIONAL'>();
      const areaBySoc = new Map<string, string>();

      if (areaCodeRaw) {
        const localRows = await prisma.wageRate.findMany({
          where: {
            datasetVersionId: oflcVersionId,
            wageYear,
            isAcwia,
            areaCode: areaCodeRaw,
            socCode: { in: socCodes },
          },
          select: {
            socCode: true,
            l1Annual: true,
            l1Hourly: true,
            hasDataQualityIssue: true,
            dataQualityNotes: true,
          },
        });
        for (const row of localRows) {
          wagesBySoc.set(row.socCode, row);
          sourceBySoc.set(row.socCode, 'LOCAL');
          areaBySoc.set(row.socCode, areaCodeRaw);
        }
      }

      if (fallbackAreaCode) {
        const missingSocCodes = socCodes.filter((code) => !wagesBySoc.has(code));
        if (missingSocCodes.length > 0) {
          const fallbackRows = await prisma.wageRate.findMany({
            where: {
              datasetVersionId: oflcVersionId,
              wageYear,
              isAcwia,
              areaCode: fallbackAreaCode,
              socCode: { in: missingSocCodes },
            },
            select: {
              socCode: true,
              l1Annual: true,
              l1Hourly: true,
              hasDataQualityIssue: true,
              dataQualityNotes: true,
            },
          });
          for (const row of fallbackRows) {
            wagesBySoc.set(row.socCode, row);
            sourceBySoc.set(row.socCode, 'NATIONAL');
            areaBySoc.set(row.socCode, fallbackAreaCode);
          }
        }
      }

      return { wageYear, isAcwia, wagesBySoc, sourceBySoc, areaBySoc };
    };

    const [dutiesResult, wagesResult] = await Promise.allSettled([
      withTimeout(fetchDuties(), enrichmentTimeoutMs),
      withTimeout(fetchWages(), enrichmentTimeoutMs),
    ]);

    let dutiesByCode = new Map<string, { duties: string[]; count: number }>();
    let wagesBySoc = new Map<string, any>();
    let sourceBySoc = new Map<string, 'LOCAL' | 'NATIONAL'>();
    let areaBySoc = new Map<string, string>();
    let dutiesIncluded = false;
    let wageIncluded = false;
    let skippedReason: 'TIMEOUT' | 'MISSING_WAGE_CONTEXT' | 'ERROR' | undefined;
    let wageYear: string | null = null;
    let wageIsAcwia: boolean | null = null;

    if (dutiesResult.status === 'fulfilled') {
      dutiesByCode = dutiesResult.value;
      dutiesIncluded = true;
    } else {
      if (dutiesResult.reason instanceof TimeoutError) {
        skippedReason = 'TIMEOUT';
      } else {
        skippedReason = skippedReason ?? 'ERROR';
      }
      warnings.push('Duties enrichment failed.');
    }

    if (wagesResult.status === 'fulfilled') {
      const value = wagesResult.value as {
        wageYear: string;
        isAcwia: boolean;
        wagesBySoc: Map<string, any>;
        sourceBySoc: Map<string, 'LOCAL' | 'NATIONAL'>;
        areaBySoc: Map<string, string>;
        skipped?: 'MISSING_WAGE_CONTEXT';
      };
      wageYear = value.wageYear;
      wageIsAcwia = value.isAcwia;
      wagesBySoc = value.wagesBySoc;
      sourceBySoc = value.sourceBySoc;
      areaBySoc = value.areaBySoc;
      if (value.skipped) {
        skippedReason = skippedReason ?? value.skipped;
      } else {
        wageIncluded = true;
      }
    } else {
      if (wagesResult.reason instanceof TimeoutError) {
        skippedReason = 'TIMEOUT';
      } else {
        skippedReason = skippedReason ?? 'ERROR';
      }
      warnings.push('Wage enrichment failed.');
    }

    const [onetTitles, socTitles] = await Promise.all([
      prisma.onetOccupation.findMany({
        where: {
          datasetVersionId: dutiesMatch.onetDatasetVersionId,
          onetCode: { in: onetCodes },
        },
        select: { onetCode: true, title: true, jobZone: true },
      }),
      prisma.socTitle.findMany({
        where: {
          datasetVersionId: oflcVersionId,
          socCode: { in: socCodes },
        },
        select: { socCode: true, title: true },
      }),
    ]);

    const onetTitleMap = new Map(onetTitles.map((row) => [row.onetCode, row.title]));
    const onetJobZoneMap = new Map(
      onetTitles.map((row) => [row.onetCode, row.jobZone ?? null]),
    );
    const socTitleMap = new Map(socTitles.map((row) => [row.socCode, row.title]));

    const items = dutiesMatch.items.map((match) => {
      const onetCode = match.onetCode;
      const socCode = toSocCode(onetCode);
      const dutyInfo = dutiesByCode.get(onetCode);
      const wageInfo = wagesBySoc.get(socCode);
      const wageSource = sourceBySoc.get(socCode) ?? 'NONE';
      const wageAreaCode = areaBySoc.get(socCode) ?? null;
      const similarity = match.similarity;
      const confidence = match.confidence;

      return {
        matchedOnetCode: onetCode,
        matchedOnetTitle: onetTitleMap.get(onetCode) ?? null,
        jobZone: onetJobZoneMap.get(onetCode) ?? null,
        socCode,
        socTitle: socTitleMap.get(socCode) ?? null,
        similarity,
        confidence,
        duties: dutyInfo?.duties ?? [],
        dutiesCount: dutyInfo?.count ?? 0,
        dutiesAvailable: (dutyInfo?.count ?? 0) > 0,
        wageLevel1Hourly: wageInfo?.l1Hourly ? wageInfo.l1Hourly.toString() : null,
        wageLevel1Annual: wageInfo?.l1Annual ?? null,
        wageYear: wageInfo ? wageYear : null,
        wageAreaCode: wageInfo ? wageAreaCode : null,
        wageIsAcwia: wageInfo ? wageIsAcwia : null,
        wageAvailable: Boolean(wageInfo),
        wageHasDataQualityIssue: wageInfo?.hasDataQualityIssue ?? null,
        wageDataQualityNotes: normalizeDataQualityNotes(wageInfo?.dataQualityNotes ?? null),
        wageSource,
      };
    });

    const response = {
      items,
      warnings,
      meta: {
        embeddingVersionId: dutiesMatch.embeddingVersionId,
        onetDatasetVersionId: dutiesMatch.onetDatasetVersionId,
        oflcDatasetVersionId: oflcVersionId,
        internalTopK,
        outputTopK,
        inputLength: dutiesMatch.inputLength,
        inputTruncated: dutiesMatch.inputTruncated,
        queryTimeMs: Date.now() - startTime,
        enrichment: {
          dutiesIncluded,
          wageIncluded,
          skippedReason,
        },
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof RateLimitError) {
      return NextResponse.json(
        { error: 'Rate limit exceeded' },
        { status: error.status, headers: error.headers },
      );
    }

    if (error instanceof EmbeddingsNotReadyError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }

    if (error instanceof DutiesMatchTimeoutError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof Error && 'status' in error) {
      const status = (error as { status?: number }).status ?? 400;
      return NextResponse.json({ error: error.message }, { status });
    }

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ error: 'Unknown error' }, { status: 500 });
  }
}
