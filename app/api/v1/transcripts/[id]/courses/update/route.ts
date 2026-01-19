import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getPrisma } from '../../../../../../../src/db/prisma';
import { requireAccess } from '../../../../../../../src/lib/access';
import { rateLimitOrThrow, RateLimitError } from '../../../../../../../src/lib/rateLimit';
import { computeCourseKey } from '../../../../../../../src/lib/transcripts/courseKey';
import { extractSummarySkills } from '../../../../../../../src/lib/transcripts/summarySkills';

export const runtime = 'nodejs';

const courseSchema = z.object({
  title: z.string().min(1),
  credits: z.number().optional().nullable(),
  grade: z.string().optional().nullable(),
  summary: z.string().optional().nullable(),
  hasSkillEvidence: z.boolean().optional().nullable(),
  rawLine: z.string().optional().nullable(),
});

const payloadSchema = z.object({
  courses: z.array(courseSchema),
});

function parseLimit(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, parsed);
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const prisma = getPrisma();

  try {
    await rateLimitOrThrow({
      key: 'transcript_edit_courses',
      limitPerMin: parseLimit(process.env.RATE_LIMIT_TRANSCRIPT_EDIT_PER_MIN, 20),
      req: request,
    });

    const access = await requireAccess(request, prisma);
    if (access.source !== 'session') {
      return NextResponse.json({ error: 'Login required' }, { status: 401 });
    }

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

    const body = await request.json();
    const payload = payloadSchema.parse(body);

    const courseData = payload.courses.map((course, idx) => ({
      transcriptId: params.id,
      courseKey: computeCourseKey(
        course.title,
        course.credits ?? undefined,
        course.grade ?? undefined,
        course.rawLine ?? undefined,
        idx,
      ),
      title: course.title,
      credits: course.credits ?? undefined,
      grade: course.grade ?? undefined,
      passStatus: null,
      summary: course.summary?.trim() || undefined,
      hasSkillEvidence: extractSummarySkills(course.summary ?? null).length >= 2,
      rawLine: course.rawLine ?? undefined,
      isUserEdited: true,
    }));

    await prisma.$transaction([
      prisma.transcriptCourse.deleteMany({ where: { transcriptId: params.id } }),
      prisma.transcriptInferredSka.deleteMany({ where: { transcriptId: params.id } }),
      ...(courseData.length ? [prisma.transcriptCourse.createMany({ data: courseData })] : []),
      prisma.transcript.update({
        where: { id: params.id },
        data: { status: 'READY' },
      }),
    ]);

    return NextResponse.json({ status: 'READY' });
  } catch (error) {
    if (error instanceof RateLimitError) {
      return NextResponse.json(
        { error: 'Rate limit exceeded' },
        { status: error.status, headers: error.headers },
      );
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid payload', details: error.flatten() }, { status: 400 });
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
