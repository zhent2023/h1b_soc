import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getPrisma } from '../../../../../../../src/db/prisma';
import { logAuditEvent } from '../../../../../../../src/lib/auditLog';
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
  const action = 'transcript.update_courses';
  let access = null;

  try {
    await rateLimitOrThrow({
      key: 'transcript_edit_courses',
      limitPerMin: parseLimit(process.env.RATE_LIMIT_TRANSCRIPT_EDIT_PER_MIN, 20),
      req: request,
    });

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

    const response = NextResponse.json({ status: 'READY' });
    await logAuditEvent({
      prisma,
      req: request,
      access,
      action,
      statusCode: 200,
      success: true,
      resource: 'transcript',
      resourceId: params.id,
      metadata: { courseCount: courseData.length },
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

    if (error instanceof z.ZodError) {
      const response = NextResponse.json(
        { error: 'Invalid payload', details: error.flatten() },
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
        metadata: { reason: 'invalid_payload' },
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
