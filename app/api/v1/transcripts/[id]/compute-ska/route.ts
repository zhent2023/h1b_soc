import { NextResponse } from 'next/server';

import { getPrisma } from '../../../../../../src/db/prisma';
import { logAuditEvent } from '../../../../../../src/lib/auditLog';
import { requireAccess } from '../../../../../../src/lib/access';
import { getCourseEmbeddings } from '../../../../../../src/lib/courses/getCourseEmbeddings';
import { createEmbeddingProviderFromEnv } from '../../../../../../src/lib/embeddings/providerFactory';
import { rateLimitOrThrow, RateLimitError } from '../../../../../../src/lib/rateLimit';
import { mapCoursesToSka, type CourseSkaDebug } from '../../../../../../src/lib/ska/mapCoursesToSka';
import { filterTranscriptCourses } from '../../../../../../src/lib/transcripts/courseFilters';

export const runtime = 'nodejs';
export const maxDuration = 60;

function parseLimit(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, parsed);
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const prisma = getPrisma();
  const action = 'transcript.compute_ska';
  let access = null;

  try {
    const debugParam = new URL(request.url).searchParams.get('debug') === '1';
    const debugEnabled =
      process.env.TRANSCRIPT_SKILL_DEBUG === 'true' || process.env.NODE_ENV !== 'production';
    const captureDebug = debugParam && debugEnabled;

    if (process.env.FEATURE_SKILL_MATCHING !== 'true') {
      const response = NextResponse.json({ error: 'Not found' }, { status: 404 });
      await logAuditEvent({
        prisma,
        req: request,
        action,
        statusCode: 404,
        success: false,
        resource: 'transcript',
        resourceId: params.id,
        metadata: { reason: 'feature_disabled' },
      });
      return response;
    }

    access = await requireAccess(request, prisma);
    if (access.source !== 'session') {
      const response = NextResponse.json({ error: 'Login required' }, { status: 401 });
      await logAuditEvent({
        prisma,
        req: request,
        access,
        action,
        statusCode: 401,
        success: false,
        resource: 'transcript',
        resourceId: params.id,
        metadata: { reason: 'login_required' },
      });
      return response;
    }

    await rateLimitOrThrow({
      key: 'transcript_compute_ska',
      limitPerMin: parseLimit(process.env.RATE_LIMIT_TRANSCRIPT_COMPUTE_PER_MIN, 10),
      req: request,
    });

    const user = await prisma.user.findUnique({
      where: { email: access.email },
      select: { id: true },
    });

    if (!user) {
      const response = NextResponse.json({ error: 'User not found' }, { status: 401 });
      await logAuditEvent({
        prisma,
        req: request,
        access,
        action,
        statusCode: 401,
        success: false,
        resource: 'transcript',
        resourceId: params.id,
        metadata: { reason: 'user_not_found' },
      });
      return response;
    }

    const transcript = await prisma.transcript.findUnique({
      where: { id: params.id },
    });

    if (!transcript || transcript.userId !== user.id) {
      const response = NextResponse.json({ error: 'Not found' }, { status: 404 });
      await logAuditEvent({
        prisma,
        req: request,
        access,
        action,
        statusCode: 404,
        success: false,
        resource: 'transcript',
        resourceId: params.id,
        metadata: { reason: 'not_found' },
      });
      return response;
    }

    if (transcript.status !== 'READY' && transcript.status !== 'NEEDS_REVIEW') {
      const response = NextResponse.json({ error: 'Transcript not ready' }, { status: 400 });
      await logAuditEvent({
        prisma,
        req: request,
        access,
        action,
        statusCode: 400,
        success: false,
        resource: 'transcript',
        resourceId: params.id,
        metadata: { reason: 'transcript_not_ready', status: transcript.status },
      });
      return response;
    }

    const courses = await prisma.transcriptCourse.findMany({
      where: { transcriptId: params.id },
      select: {
        courseKey: true,
        title: true,
        credits: true,
        grade: true,
        passStatus: true,
        summary: true,
        hasSkillEvidence: true,
        rawLine: true,
      },
    });

    const filteredCourses = filterTranscriptCourses(courses);
    const eligibleCourses = filteredCourses.filter(
      (course) => course.hasSkillEvidence !== false,
    );

    if (eligibleCourses.length === 0) {
      const response = NextResponse.json(
        { error: 'Transcript has no courses with skill evidence' },
        { status: 400 },
      );
      await logAuditEvent({
        prisma,
        req: request,
        access,
        action,
        statusCode: 400,
        success: false,
        resource: 'transcript',
        resourceId: params.id,
        metadata: { reason: 'no_skill_evidence', courseCount: courses.length },
      });
      return response;
    }

    await prisma.transcriptInferredSka.deleteMany({ where: { transcriptId: params.id } });

    const embeddings = await getCourseEmbeddings(
      eligibleCourses.map((course) => ({
        courseKey: course.courseKey,
        title: course.title,
        summary: course.summary ?? undefined,
      })),
    );

    const provider = createEmbeddingProviderFromEnv();
    const enrichedCourses = eligibleCourses
      .map((course) => {
        const entry = embeddings.get(course.courseKey);
        if (!entry) return null;
        return {
          courseKey: course.courseKey,
          title: course.title,
          credits: course.credits ?? undefined,
          grade: course.grade ?? undefined,
          passStatus: course.passStatus ?? undefined,
          hasSkillEvidence: course.hasSkillEvidence ?? undefined,
          embedding: entry.embedding,
          embeddingModelId: provider.model,
        };
      })
      .filter((course): course is NonNullable<typeof course> => Boolean(course));

    const debugEntries: CourseSkaDebug[] = [];
    const results = await mapCoursesToSka(params.id, enrichedCourses, {
      debug: captureDebug ? (entry) => debugEntries.push(entry) : undefined,
    });
    const response = NextResponse.json({
      evidenceCount: results.length,
      debug: captureDebug
        ? {
            totalCourses: courses.length,
            eligibleCourses: eligibleCourses.length,
            scoredCourses: enrichedCourses.length,
            courses: debugEntries,
          }
        : undefined,
    });
    await logAuditEvent({
      prisma,
      req: request,
      access,
      action,
      statusCode: 200,
      success: true,
      resource: 'transcript',
      resourceId: params.id,
      metadata: {
        evidenceCount: results.length,
        eligibleCourses: eligibleCourses.length,
        scoredCourses: enrichedCourses.length,
      },
    });
    return response;
  } catch (error) {
    if (error instanceof RateLimitError) {
      const response = NextResponse.json(
        { error: 'Rate limit exceeded' },
        { status: error.status, headers: error.headers },
      );
      await logAuditEvent({
        prisma,
        req: request,
        access,
        action,
        statusCode: error.status,
        success: false,
        resource: 'transcript',
        resourceId: params.id,
        metadata: { reason: 'rate_limited' },
      });
      return response;
    }

    if (error instanceof Error && 'status' in error) {
      const status = (error as { status?: number }).status ?? 400;
      const response = NextResponse.json({ error: error.message }, { status });
      await logAuditEvent({
        prisma,
        req: request,
        access,
        action,
        statusCode: status,
        success: false,
        resource: 'transcript',
        resourceId: params.id,
        metadata: { reason: 'error', message: error.message },
      });
      return response;
    }

    if (error instanceof Error) {
      const response = NextResponse.json({ error: error.message }, { status: 400 });
      await logAuditEvent({
        prisma,
        req: request,
        access,
        action,
        statusCode: 400,
        success: false,
        resource: 'transcript',
        resourceId: params.id,
        metadata: { reason: 'error', message: error.message },
      });
      return response;
    }

    const response = NextResponse.json({ error: 'Unknown error' }, { status: 500 });
    await logAuditEvent({
      prisma,
      req: request,
      access,
      action,
      statusCode: 500,
      success: false,
      resource: 'transcript',
      resourceId: params.id,
      metadata: { reason: 'unknown_error' },
    });
    return response;
  }
}
