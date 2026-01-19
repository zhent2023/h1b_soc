import { NextResponse } from 'next/server';

import { PrismaPromise } from '@prisma/client';

import { getPrisma } from '../../../../../../src/db/prisma';
import { requireAccess } from '../../../../../../src/lib/access';
import { rateLimitOrThrow, RateLimitError } from '../../../../../../src/lib/rateLimit';
import { createStorageProviderFromEnv } from '../../../../../../src/lib/storage';
import { logMetric } from '../../../../../../src/lib/metrics';
import { computeCourseKey } from '../../../../../../src/lib/transcripts/courseKey';
import { filterTranscriptCourses } from '../../../../../../src/lib/transcripts/courseFilters';
import { pdfTextProvider } from '../../../../../../src/lib/transcripts/providers/pdfTextProvider';
import { geminiOcrProvider } from '../../../../../../src/lib/transcripts/providers/geminiOcrProvider';

export const runtime = 'nodejs';
export const maxDuration = 60;

const CONFIDENCE_THRESHOLD = 0.75;
const DEFAULT_MIN_COURSE_COUNT = 3;

function parseLimit(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, parsed);
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const prisma = getPrisma();

  try {
    const access = await requireAccess(request, prisma);
    if (access.source !== 'session') {
      return NextResponse.json({ error: 'Login required' }, { status: 401 });
    }

    await rateLimitOrThrow({
      key: 'transcript_process',
      limitPerMin: parseLimit(process.env.RATE_LIMIT_TRANSCRIPT_PROCESS_PER_MIN, 10),
      req: request,
    });

    const user = await prisma.user.findUnique({
      where: { email: access.email },
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 401 });
    }

    const transcript = await prisma.transcript.findUnique({
      where: { id: params.id },
      include: { document: true },
    });

    if (!transcript || transcript.userId !== user.id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const storageUrl = transcript.document?.storageUrl;
    if (!storageUrl) {
      return NextResponse.json({ error: 'Transcript document missing' }, { status: 404 });
    }

    const parseStart = Date.now();

    await prisma.transcript.update({
      where: { id: params.id },
      data: { status: 'PARSING' },
    });

    let activeProvider = pdfTextProvider;
    let result = await pdfTextProvider.parseFromUrl(storageUrl);
    let filteredCourses = filterTranscriptCourses(result.courses);
    const minCourseCount = parseLimit(
      process.env.TRANSCRIPT_MIN_COURSE_COUNT,
      DEFAULT_MIN_COURSE_COUNT,
    );
    const shouldForceOcr = result.confidence < 0.5 || result.courses.length === 0;
    const pageCount = result.pageCount ?? 0;
    const shouldTryOcr =
      shouldForceOcr ||
      (filteredCourses.length < minCourseCount && pageCount > 1);

    if (shouldTryOcr) {
      const ocrResult = await geminiOcrProvider.parseFromUrl(storageUrl);
      const ocrFiltered = filterTranscriptCourses(ocrResult.courses);
      const preferOcr = shouldForceOcr || ocrFiltered.length > filteredCourses.length;
      if (preferOcr) {
        activeProvider = geminiOcrProvider;
        result = ocrResult;
        filteredCourses = ocrFiltered;
      }
    }
    const adjustedConfidence = filteredCourses.length === 0 ? 0 : result.confidence;

    const courseData = filteredCourses.map((course, idx) => ({
      transcriptId: params.id,
      courseKey: computeCourseKey(
        course.title,
        course.credits,
        course.grade,
        course.rawLine,
        idx,
      ),
      title: course.title,
      credits: course.credits,
      grade: course.grade,
      passStatus: course.passStatus ?? null,
      summary: course.summary ?? undefined,
      hasSkillEvidence:
        typeof course.hasSkillEvidence === 'boolean' ? course.hasSkillEvidence : null,
      rawLine: course.rawLine,
    }));

    const operations: PrismaPromise<unknown>[] = [
      prisma.transcriptCourse.deleteMany({ where: { transcriptId: params.id } }),
      prisma.transcriptInferredSka.deleteMany({ where: { transcriptId: params.id } }),
    ];

    if (courseData.length > 0) {
      operations.push(
        prisma.transcriptCourse.createMany({ data: courseData }),
      );
    }

    const finalStatus =
      adjustedConfidence >= CONFIDENCE_THRESHOLD ? 'READY' : 'NEEDS_REVIEW';
    operations.push(
      prisma.transcript.update({
        where: { id: params.id },
        data: {
          status: finalStatus,
          parseConfidence: adjustedConfidence,
          parserProvider: activeProvider.providerId,
          parserVersion: result.parserVersion ?? activeProvider.version,
        },
      }),
    );

    if (typeof result.pageCount === 'number') {
      operations.push(
        prisma.transcriptDocument.update({
          where: { transcriptId: params.id },
          data: { pageCount: result.pageCount },
        }),
      );
    }

    await prisma.$transaction(operations);

    const parseDurationMs = Date.now() - parseStart;
    logMetric('transcript_parse_latency_ms', parseDurationMs, {
      transcript_id: params.id,
      provider: activeProvider.providerId,
      status: finalStatus,
      course_count: filteredCourses.length,
    });

    const deleteAfterParse = process.env.TRANSCRIPT_DELETE_AFTER_PARSE !== 'false';
    if (deleteAfterParse) {
      const storageProvider = createStorageProviderFromEnv();
      let deletedAt: Date | null = null;

      try {
        await storageProvider.deleteObject(storageUrl);
        deletedAt = new Date();
      } catch {
        deletedAt = null;
      }

      if (deletedAt) {
        await prisma.transcriptDocument.update({
          where: { transcriptId: params.id },
          data: { storageUrl: null, deletedAt },
        });
      }
    }

    return NextResponse.json({
      status: 'success',
      courseCount: filteredCourses.length,
      usedPath: result.usedPath,
      parseDurationMs,
    });
  } catch (error) {
    await prisma.transcript.update({
      where: { id: params.id },
      data: { status: 'FAILED' },
    }).catch(() => null);

    if (error instanceof RateLimitError) {
      return NextResponse.json(
        { error: 'Rate limit exceeded' },
        { status: error.status, headers: error.headers },
      );
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
