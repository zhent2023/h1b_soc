import { NextResponse } from 'next/server';

import { getPrisma } from '../../../../../../src/db/prisma';
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

  try {
    const debugParam = new URL(request.url).searchParams.get('debug') === '1';
    const debugEnabled =
      process.env.TRANSCRIPT_SKILL_DEBUG === 'true' || process.env.NODE_ENV !== 'production';
    const captureDebug = debugParam && debugEnabled;

    if (process.env.FEATURE_SKILL_MATCHING !== 'true') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const access = await requireAccess(request, prisma);
    if (access.source !== 'session') {
      return NextResponse.json({ error: 'Login required' }, { status: 401 });
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
      return NextResponse.json({ error: 'User not found' }, { status: 401 });
    }

    const transcript = await prisma.transcript.findUnique({
      where: { id: params.id },
    });

    if (!transcript || transcript.userId !== user.id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (transcript.status !== 'READY' && transcript.status !== 'NEEDS_REVIEW') {
      return NextResponse.json({ error: 'Transcript not ready' }, { status: 400 });
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
      return NextResponse.json(
        { error: 'Transcript has no courses with skill evidence' },
        { status: 400 },
      );
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
    return NextResponse.json({
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
  } catch (error) {
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
