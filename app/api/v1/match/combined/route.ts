import { NextResponse } from 'next/server';

import { getPrisma } from '../../../../../src/db/prisma';
import { requireAccess } from '../../../../../src/lib/access';
import { captureDatasetContext } from '../../../../../src/lib/constants';
import { matchDuties, EmbeddingsNotReadyError, DutiesMatchTimeoutError } from '../../../../../src/lib/match/dutiesMatch';
import { logMetric } from '../../../../../src/lib/metrics';
import { rateLimitOrThrow, RateLimitError } from '../../../../../src/lib/rateLimit';
import { buildSkillsEvidenceByOnet, type SkillsEvidenceSummary } from '../../../../../src/lib/ska/skillsEvidence';
import { rerankByDomainTags } from '../../../../../src/lib/ska/domainRerank';
import { scoreOccupations } from '../../../../../src/lib/ska/scoreOccupations';
import { loadTranscriptDomainTagWeights } from '../../../../../src/lib/transcripts/domainTags';

export const runtime = 'nodejs';
export const maxDuration = 60;

type OnetDutyInfo = {
  duties: string[];
  count: number;
};

function clampTopN(raw: unknown, fallback: number) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(6, parsed));
}

function parseLimit(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, parsed);
}

function parseNumber(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

async function fetchOnetDetails(
  prisma: ReturnType<typeof getPrisma>,
  onetCodes: string[],
  datasetVersionId: string,
) {
  if (onetCodes.length === 0) {
    return {
      titleByCode: new Map<string, string>(),
      dutiesByCode: new Map<string, OnetDutyInfo>(),
      jobZoneByCode: new Map<string, number | null>(),
    };
  }

  const [onetTitles, dutyRows] = await Promise.all([
    prisma.onetOccupation.findMany({
      where: { datasetVersionId, onetCode: { in: onetCodes } },
      select: { onetCode: true, title: true, jobZone: true },
    }),
    prisma.onetDuty.findMany({
      where: { datasetVersionId, onetCode: { in: onetCodes } },
      select: { onetCode: true, dutyText: true, sortOrder: true },
      orderBy: [{ onetCode: 'asc' }, { sortOrder: 'asc' }],
    }),
  ]);

  const titleByCode = new Map(onetTitles.map((row) => [row.onetCode, row.title]));
  const jobZoneByCode = new Map(
    onetTitles.map((row) => [row.onetCode, row.jobZone ?? null]),
  );
  const dutiesByCode = new Map<string, OnetDutyInfo>();

  for (const row of dutyRows) {
    let entry = dutiesByCode.get(row.onetCode);
    if (!entry) {
      entry = { duties: [], count: 0 };
      dutiesByCode.set(row.onetCode, entry);
    }
    entry.count += 1;
    entry.duties.push(row.dutyText);
  }

  return { titleByCode, dutiesByCode, jobZoneByCode };
}

export async function POST(request: Request) {
  const prisma = getPrisma();
  const start = Date.now();
  let response: Response | null = null;

  try {
    const access = await requireAccess(request, prisma);
    await rateLimitOrThrow({ key: 'match_combined', limitPerMin: 30, req: request });

    const body = await request.json();
    const dutiesText = typeof body?.dutiesText === 'string' ? body.dutiesText.trim() : '';
    const transcriptId = typeof body?.transcript_id === 'string' ? body.transcript_id.trim() : '';
    const rawTranscriptIds: unknown[] = Array.isArray(body?.transcript_ids)
      ? body.transcript_ids
      : [];
    const transcriptIds = rawTranscriptIds
      .filter((id): id is string => typeof id === 'string')
      .map((id) => id.trim())
      .filter(Boolean);
    const uniqueTranscriptIds = Array.from(
      new Set([...transcriptIds, ...(transcriptId ? [transcriptId] : [])]),
    );
    const topN = clampTopN(body?.top_n, 6);

    if (!dutiesText && uniqueTranscriptIds.length === 0) {
      response = NextResponse.json(
        { error: 'dutiesText or transcript_id(s) is required' },
        { status: 400 },
      );
      return response;
    }

    const featureSkills = process.env.FEATURE_SKILL_MATCHING === 'true';
    const featureFusion = process.env.FEATURE_MATCH_FUSION === 'true';

    const dutiesInternalTopK = Math.max(
      topN,
      parseLimit(process.env.SOC_RECOMMEND_INTERNAL_TOPK, 30),
    );
    const dutiesStatementTimeoutMs = parseLimit(
      process.env.SOC_RECOMMEND_STATEMENT_TIMEOUT_MS,
      1500,
    );

    const dutiesCandidateCount = Math.max(
      topN,
      parseLimit(process.env.SOC_RECOMMEND_FUSION_CANDIDATES, 18),
    );
    const skillsCandidateCount = Math.max(
      topN,
      parseLimit(process.env.SKILLS_DOMAIN_CANDIDATES, 60),
    );
    const domainBoost = parseNumber(process.env.SKILLS_DOMAIN_BOOST, 0.12);
    const dutiesOutputTopK = dutiesText && featureSkills ? dutiesCandidateCount : topN;

    const dutiesResult = dutiesText
      ? await matchDuties({
          prisma,
          dutiesText,
          internalTopK: dutiesInternalTopK,
          outputTopK: dutiesOutputTopK,
          statementTimeoutMs: dutiesStatementTimeoutMs,
        })
      : null;

    let skillsResult: Awaited<ReturnType<typeof scoreOccupations>> | null = null;
    let skillsSkippedReason: string | null = null;
    let skillsEvidenceCount: number | null = null;
    let readyTranscriptIds: string[] = [];

    if (uniqueTranscriptIds.length > 0 && featureSkills) {
      if (access.source !== 'session') {
        response = NextResponse.json({ error: 'Login required' }, { status: 401 });
        return response;
      }

      const user = await prisma.user.findUnique({
        where: { email: access.email },
        select: { id: true },
      });

      if (!user) {
        response = NextResponse.json({ error: 'User not found' }, { status: 401 });
        return response;
      }

      const transcripts = await prisma.transcript.findMany({
        where: { id: { in: uniqueTranscriptIds } },
      });
      const idsMatch = transcripts.length === uniqueTranscriptIds.length;
      const ownsAll = transcripts.every((entry) => entry.userId === user.id);

      if (!idsMatch || !ownsAll) {
        response = NextResponse.json({ error: 'Not found' }, { status: 404 });
        return response;
      }

      readyTranscriptIds = transcripts
        .filter((entry) => entry.status === 'READY' || entry.status === 'NEEDS_REVIEW')
        .map((entry) => entry.id);

      if (readyTranscriptIds.length === 0) {
        skillsSkippedReason = 'TRANSCRIPT_NOT_READY';
      } else {
        const evidenceCount = await prisma.transcriptInferredSka.count({
          where: { transcriptId: { in: readyTranscriptIds } },
        });
        skillsEvidenceCount = evidenceCount;

        if (evidenceCount === 0) {
          skillsSkippedReason = 'SKILLS_NOT_READY';
        } else {
          const dutiesCodes = dutiesResult?.items.map((item) => item.onetCode) ?? null;
          const skillsTopN = dutiesCodes ? dutiesCodes.length : skillsCandidateCount;
          skillsResult = await scoreOccupations(
            readyTranscriptIds,
            skillsTopN,
            dutiesCodes ? { restrictOnetCodes: dutiesCodes } : undefined,
          );
        }
      }
    }

    if (!dutiesResult && !skillsResult) {
      response = NextResponse.json(
        { error: skillsSkippedReason ?? 'No results available' },
        { status: 400 },
      );
      return response;
    }

    if (!featureFusion || !dutiesResult || !skillsResult) {
      const onetCodes =
        skillsResult && !dutiesResult
          ? skillsResult.map((item) => item.onetCode)
          : dutiesResult?.items.slice(0, topN).map((item) => item.onetCode) ?? [];
      let titleByCode = new Map<string, string>();
      let dutiesByCode = new Map<string, OnetDutyInfo>();
      let jobZoneByCode = new Map<string, number | null>();
      try {
        const datasetContext = await captureDatasetContext(prisma);
        const onetDatasetVersionId =
          dutiesResult?.onetDatasetVersionId ?? datasetContext.onetVersionId;
        const details = await fetchOnetDetails(prisma, onetCodes, onetDatasetVersionId);
        titleByCode = details.titleByCode;
        dutiesByCode = details.dutiesByCode;
        jobZoneByCode = details.jobZoneByCode;
      } catch {
        titleByCode = new Map();
        dutiesByCode = new Map();
        jobZoneByCode = new Map();
      }

      if (skillsResult && !dutiesResult) {
        let skillsEvidence = new Map<string, SkillsEvidenceSummary>();
        try {
          skillsEvidence = await buildSkillsEvidenceByOnet({
            prisma,
            transcriptIds: readyTranscriptIds,
            onetCodes: skillsResult.map((item) => item.onetCode),
          });
        } catch {
          skillsEvidence = new Map();
        }
        const tagWeights = await loadTranscriptDomainTagWeights(prisma, readyTranscriptIds);
        const rerank = rerankByDomainTags({
          scores: skillsResult,
          titleByCode,
          tagWeights,
          boost: domainBoost,
        });
        const rankedSkills = rerank.results.slice(0, topN);
        response = NextResponse.json({
          results: rankedSkills.map((item, idx) => {
            const dutyInfo = dutiesByCode.get(item.onetCode);
            return {
              onet_code: item.onetCode,
              onet_title: titleByCode.get(item.onetCode) ?? null,
              job_zone: jobZoneByCode.get(item.onetCode) ?? null,
              duties: dutyInfo?.duties ?? [],
              duties_count: dutyInfo?.count ?? 0,
              duties_available: (dutyInfo?.count ?? 0) > 0,
              final_rank: idx + 1,
              source: 'skills',
              score: item.final,
              coverage: item.coverage,
              match: item.match,
              skills_evidence: skillsEvidence.get(item.onetCode) ?? null,
            };
          }),
          fusion_applied: false,
          skills_meta: rerank.meta,
        });
        return response;
      }

      const dutiesItems = dutiesResult?.items.slice(0, topN) ?? [];
      response = NextResponse.json({
        results: dutiesItems.map((item, idx) => {
          const dutyInfo = dutiesByCode.get(item.onetCode);
          return {
            onet_code: item.onetCode,
            onet_title: titleByCode.get(item.onetCode) ?? null,
            job_zone: jobZoneByCode.get(item.onetCode) ?? null,
            duties: dutyInfo?.duties ?? [],
            duties_count: dutyInfo?.count ?? 0,
            duties_available: (dutyInfo?.count ?? 0) > 0,
            final_rank: idx + 1,
            source: 'duties',
            similarity: item.similarity,
            confidence: item.confidence,
          };
        }),
        fusion_applied: false,
        duties_meta: dutiesResult
          ? {
              input_truncated: dutiesResult.inputTruncated,
              input_length: dutiesResult.inputLength,
            }
          : null,
      });
      return response;
    }

    const skillsRank = new Map(
      skillsResult.map((item, idx) => [item.onetCode, idx + 1]),
    );
    const skillsMap = new Map(skillsResult.map((item) => [item.onetCode, item]));
    const minEvidence = parseLimit(process.env.SKILLS_GATE_MIN_EVIDENCE, 10);
    const minCoverage = parseNumber(process.env.SKILLS_GATE_MIN_COVERAGE, 0.15);
    const tieBreakEps = parseNumber(process.env.SKILLS_TIEBREAK_EPS, 0.01);
    const gateEnabled =
      typeof skillsEvidenceCount === 'number' && skillsEvidenceCount >= minEvidence;

    const candidates = dutiesResult.items.map((item, idx) => {
      const skills = skillsMap.get(item.onetCode) ?? null;
      const coverage = skills?.coverage ?? 0;
      const skillsGate = gateEnabled ? (coverage >= minCoverage ? 'pass' : 'fail') : 'skipped';
      return {
        onet_code: item.onetCode,
        similarity: item.similarity,
        confidence: item.confidence,
        duties_rank: idx + 1,
        skills_rank: skillsRank.get(item.onetCode) ?? null,
        skills_score: skills?.final ?? null,
        skills_coverage: skills?.coverage ?? null,
        skills_match: skills?.match ?? null,
        skills_gate: skillsGate,
        idx,
      };
    });

    const compareByDuties = (a: typeof candidates[number], b: typeof candidates[number]) => {
      const diff = (b.similarity ?? 0) - (a.similarity ?? 0);
      if (Math.abs(diff) >= tieBreakEps) {
        return diff;
      }
      if (gateEnabled) {
        const skillsDiff = (b.skills_score ?? -Infinity) - (a.skills_score ?? -Infinity);
        if (skillsDiff !== 0) {
          return skillsDiff;
        }
      }
      return a.idx - b.idx;
    };

    const passList = gateEnabled
      ? candidates.filter((entry) => entry.skills_gate === 'pass')
      : candidates;
    const failList = gateEnabled
      ? candidates.filter((entry) => entry.skills_gate === 'fail')
      : [];

    passList.sort(compareByDuties);
    failList.sort(compareByDuties);

    const ranked = gateEnabled ? [...passList, ...failList] : passList;
    const topRanked = ranked.slice(0, topN);

    let titleByCode = new Map<string, string>();
    let dutiesByCode = new Map<string, OnetDutyInfo>();
    let jobZoneByCode = new Map<string, number | null>();
    try {
      const datasetContext = await captureDatasetContext(prisma);
      const onetDatasetVersionId =
        dutiesResult?.onetDatasetVersionId ?? datasetContext.onetVersionId;
      const details = await fetchOnetDetails(
        prisma,
        topRanked.map((entry) => entry.onet_code),
        onetDatasetVersionId,
      );
      titleByCode = details.titleByCode;
      dutiesByCode = details.dutiesByCode;
      jobZoneByCode = details.jobZoneByCode;
    } catch {
      titleByCode = new Map();
      dutiesByCode = new Map();
      jobZoneByCode = new Map();
    }

    let skillsEvidence = new Map<string, SkillsEvidenceSummary>();
    if (skillsResult && readyTranscriptIds.length > 0) {
      try {
        skillsEvidence = await buildSkillsEvidenceByOnet({
          prisma,
          transcriptIds: readyTranscriptIds,
          onetCodes: topRanked.map((entry) => entry.onet_code),
        });
      } catch {
        skillsEvidence = new Map();
      }
    }

    response = NextResponse.json({
      results: topRanked.map((entry, idx) => {
        const dutyInfo = dutiesByCode.get(entry.onet_code);
        return {
          ...entry,
          onet_title: titleByCode.get(entry.onet_code) ?? null,
          job_zone: jobZoneByCode.get(entry.onet_code) ?? null,
          duties: dutyInfo?.duties ?? [],
          duties_count: dutyInfo?.count ?? 0,
          duties_available: (dutyInfo?.count ?? 0) > 0,
          final_rank: idx + 1,
          source: 'duties',
          skills_evidence: skillsEvidence.get(entry.onet_code) ?? null,
        };
      }),
      fusion_applied: true,
      fusion_meta: {
        skills_gate_enabled: gateEnabled,
        skills_evidence_count: skillsEvidenceCount,
        skills_gate_min_evidence: minEvidence,
        skills_gate_min_coverage: minCoverage,
      },
    });
    return response;
  } catch (error) {
    if (error instanceof RateLimitError) {
      response = NextResponse.json(
        { error: 'Rate limit exceeded' },
        { status: error.status, headers: error.headers },
      );
      return response;
    }

    if (error instanceof EmbeddingsNotReadyError) {
      response = NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
      return response;
    }

    if (error instanceof DutiesMatchTimeoutError) {
      response = NextResponse.json({ error: error.message }, { status: error.status });
      return response;
    }

    if (error instanceof Error && 'status' in error) {
      const status = (error as { status?: number }).status ?? 400;
      response = NextResponse.json({ error: error.message }, { status });
      return response;
    }

    if (error instanceof Error) {
      response = NextResponse.json({ error: error.message }, { status: 400 });
      return response;
    }

    response = NextResponse.json({ error: 'Unknown error' }, { status: 500 });
    return response;
  } finally {
    logMetric('skills_match_latency_ms', Date.now() - start, {
      route: 'match_combined',
      status: response?.status ?? 500,
    });
  }
}
