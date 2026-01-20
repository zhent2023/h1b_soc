import { NextResponse } from 'next/server';

import { getPrisma } from '../../../../../src/db/prisma';
import { logAuditEvent } from '../../../../../src/lib/auditLog';
import { requireAccess } from '../../../../../src/lib/access';
import { rateLimitOrThrow, RateLimitError } from '../../../../../src/lib/rateLimit';
import { createStorageProviderFromEnv } from '../../../../../src/lib/storage';
import {
  getRuleFailReason,
  resolveCoursePassStatus,
} from '../../../../../src/lib/transcripts/courseFilters';

export const runtime = 'nodejs';

function parseLimit(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, parsed);
}

async function resolveUserContext(request: Request, prisma: ReturnType<typeof getPrisma>) {
  const access = await requireAccess(request, prisma);
  if (access.source !== 'session') {
    return {
      error: NextResponse.json({ error: 'Login required' }, { status: 401 }),
      statusCode: 401,
      reason: 'login_required',
      access,
    } as const;
  }

  const user = await prisma.user.findUnique({
    where: { email: access.email },
    select: { id: true },
  });

  if (!user) {
    return {
      error: NextResponse.json({ error: 'User not found' }, { status: 401 }),
      statusCode: 401,
      reason: 'user_not_found',
      access,
    } as const;
  }

  return { userId: user.id, access } as const;
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const prisma = getPrisma();
  const action = 'transcript.get';
  let access = null;

  try {
    const resolved = await resolveUserContext(request, prisma);
    if ('error' in resolved) {
      access = resolved.access;
      await logAuditEvent({
        prisma,
        req: request,
        access,
        action,
        statusCode: resolved.statusCode ?? 401,
        success: false,
        resource: 'transcript',
        resourceId: params.id,
        metadata: { reason: resolved.reason },
      });
      return resolved.error;
    }
    access = resolved.access;

    const transcript = await prisma.transcript.findUnique({
      where: { id: params.id },
      include: {
        document: true,
        courses: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!transcript || transcript.userId !== resolved.userId) {
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

    const evaluated = transcript.courses.map((course) => {
      const { modelStatus, ruleStatus, finalStatus, conflict } = resolveCoursePassStatus(
        course.passStatus,
        course.grade,
      );
      const ruleReason = ruleStatus === 'fail' ? getRuleFailReason(course.grade) : undefined;
      const reason = conflict
        ? modelStatus === 'pass'
          ? `Model: pass, rule: fail${ruleReason ? ` (${ruleReason})` : ''}.`
          : 'Model: fail, rule: pass.'
        : undefined;

      return {
        course,
        finalStatus,
        conflictReason: reason,
      };
    });

    const conflicts = evaluated
      .filter((entry) => Boolean(entry.conflictReason))
      .map((entry) => ({
        courseKey: entry.course.courseKey,
        title: entry.course.title,
        grade: entry.course.grade,
        passStatus: entry.course.passStatus,
        rawLine: entry.course.rawLine,
        reason: entry.conflictReason,
      }));

    const passingCourses = evaluated
      .filter((entry) => entry.finalStatus !== 'fail')
      .map((entry) => entry.course);

    const response = NextResponse.json({
      transcript: {
        ...transcript,
        courses: passingCourses,
        conflicts,
      },
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

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const prisma = getPrisma();
  const action = 'transcript.delete';
  let access = null;

  try {
    await rateLimitOrThrow({
      key: 'transcript_delete',
      limitPerMin: parseLimit(process.env.RATE_LIMIT_TRANSCRIPT_DELETE_PER_MIN, 20),
      req: request,
    });

    const resolved = await resolveUserContext(request, prisma);
    if ('error' in resolved) {
      access = resolved.access;
      await logAuditEvent({
        prisma,
        req: request,
        access,
        action,
        statusCode: resolved.statusCode ?? 401,
        success: false,
        resource: 'transcript',
        resourceId: params.id,
        metadata: { reason: resolved.reason },
      });
      return resolved.error;
    }
    access = resolved.access;

    const transcript = await prisma.transcript.findUnique({
      where: { id: params.id },
      include: { document: true },
    });

    if (!transcript || transcript.userId !== resolved.userId) {
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

    const storageUrl = transcript.document?.storageUrl ?? null;

    await prisma.transcript.delete({ where: { id: params.id } });

    if (storageUrl) {
      const storageProvider = createStorageProviderFromEnv();
      await storageProvider.deleteObject(storageUrl).catch(() => null);
    }

    const response = NextResponse.json({ status: 'deleted' });
    await logAuditEvent({
      prisma,
      req: request,
      access,
      action,
      statusCode: 200,
      success: true,
      resource: 'transcript',
      resourceId: params.id,
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
