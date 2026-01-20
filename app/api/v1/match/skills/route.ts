import { NextResponse } from 'next/server';

import { getPrisma } from '../../../../../src/db/prisma';
import { logAuditEvent } from '../../../../../src/lib/auditLog';
import { requireAccess } from '../../../../../src/lib/access';
import { captureDatasetContext } from '../../../../../src/lib/constants';
import { logMetric } from '../../../../../src/lib/metrics';
import { rateLimitOrThrow, RateLimitError } from '../../../../../src/lib/rateLimit';
import { rerankByDomainTags } from '../../../../../src/lib/ska/domainRerank';
import { getSupportingCourses, scoreOccupations } from '../../../../../src/lib/ska/scoreOccupations';
import { loadTranscriptDomainTagWeights } from '../../../../../src/lib/transcripts/domainTags';

export const runtime = 'nodejs';
export const maxDuration = 60;

function clampTopN(raw: unknown, fallback: number) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(6, parsed));
}

function parseNumber(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

export async function POST(request: Request) {
  const prisma = getPrisma();
  const start = Date.now();
  const action = 'match.skills';
  let response: Response | null = null;
  let access = null;
  let transcriptId = '';
  let topN = 0;

  try {
    if (process.env.FEATURE_SKILL_MATCHING !== 'true') {
      response = NextResponse.json({ error: 'Not found' }, { status: 404 });
      return response;
    }

    access = await requireAccess(request, prisma);
    if (access.source !== 'session') {
      response = NextResponse.json({ error: 'Login required' }, { status: 401 });
      return response;
    }

    await rateLimitOrThrow({ key: 'match_skills', limitPerMin: 30, req: request });

    const body = await request.json();
    transcriptId = typeof body?.transcript_id === 'string' ? body.transcript_id : '';
    topN = clampTopN(body?.top_n, 6);

    if (!transcriptId) {
      response = NextResponse.json({ error: 'transcript_id is required' }, { status: 400 });
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

    const transcript = await prisma.transcript.findUnique({
      where: { id: transcriptId },
    });

    if (!transcript || transcript.userId !== user.id) {
      response = NextResponse.json({ error: 'Not found' }, { status: 404 });
      return response;
    }

    if (transcript.status !== 'READY' && transcript.status !== 'NEEDS_REVIEW') {
      response = NextResponse.json({ error: 'Transcript not ready' }, { status: 400 });
      return response;
    }

    const evidenceCount = await prisma.transcriptInferredSka.count({
      where: { transcriptId },
    });

    if (evidenceCount === 0) {
      response = NextResponse.json({ error: 'Skills evidence missing' }, { status: 400 });
      return response;
    }

    const skillsCandidateCount = Math.max(
      topN,
      parseNumber(process.env.SKILLS_DOMAIN_CANDIDATES, 60),
    );
    const domainBoost = parseNumber(process.env.SKILLS_DOMAIN_BOOST, 0.12);
    let results = await scoreOccupations(transcriptId, skillsCandidateCount);
    let rerankMeta: ReturnType<typeof rerankByDomainTags>['meta'] = null;

    if (results.length > 0 && domainBoost > 0) {
      try {
        const tagWeights = await loadTranscriptDomainTagWeights(prisma, [transcriptId]);
        if (tagWeights.size > 0) {
          const datasetContext = await captureDatasetContext(prisma);
          const onetTitles = await prisma.onetOccupation.findMany({
            where: {
              datasetVersionId: datasetContext.onetVersionId,
              onetCode: { in: results.map((entry) => entry.onetCode) },
            },
            select: { onetCode: true, title: true },
          });
          const titleByCode = new Map(onetTitles.map((row) => [row.onetCode, row.title]));
          const reranked = rerankByDomainTags({
            scores: results,
            titleByCode,
            tagWeights,
            boost: domainBoost,
          });
          results = reranked.results;
          rerankMeta = reranked.meta;
        }
      } catch {
        rerankMeta = null;
      }
    }

    results = results.slice(0, topN);
    const enriched = await Promise.all(
      results.map(async (result) => ({
        ...result,
        supportingCourses: await getSupportingCourses(
          transcriptId,
          result.topContributingSkills,
        ),
      })),
    );

    response = NextResponse.json({ occupations: enriched, skills_meta: rerankMeta });
    return response;
  } catch (error) {
    if (error instanceof RateLimitError) {
      response = NextResponse.json(
        { error: 'Rate limit exceeded' },
        { status: error.status, headers: error.headers },
      );
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
      route: 'match_skills',
      status: response?.status ?? 500,
    });

    await logAuditEvent({
      prisma,
      req: request,
      access,
      action,
      statusCode: response?.status ?? 500,
      success: (response?.status ?? 500) < 400,
      resource: transcriptId ? 'transcript' : 'match',
      resourceId: transcriptId || null,
      metadata: topN ? { topN } : undefined,
    });
  }
}
