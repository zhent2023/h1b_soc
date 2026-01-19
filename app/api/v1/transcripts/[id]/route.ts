import { NextResponse } from 'next/server';

import { getPrisma } from '../../../../../src/db/prisma';
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

async function resolveUserId(request: Request, prisma: ReturnType<typeof getPrisma>) {
  const access = await requireAccess(request, prisma);
  if (access.source !== 'session') {
    return { error: NextResponse.json({ error: 'Login required' }, { status: 401 }) } as const;
  }

  const user = await prisma.user.findUnique({
    where: { email: access.email },
    select: { id: true },
  });

  if (!user) {
    return { error: NextResponse.json({ error: 'User not found' }, { status: 401 }) } as const;
  }

  return { userId: user.id } as const;
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const prisma = getPrisma();

  try {
    const resolved = await resolveUserId(request, prisma);
    if ('error' in resolved) {
      return resolved.error;
    }

    const transcript = await prisma.transcript.findUnique({
      where: { id: params.id },
      include: {
        document: true,
        courses: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!transcript || transcript.userId !== resolved.userId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
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

    return NextResponse.json({
      transcript: {
        ...transcript,
        courses: passingCourses,
        conflicts,
      },
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

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const prisma = getPrisma();

  try {
    await rateLimitOrThrow({
      key: 'transcript_delete',
      limitPerMin: parseLimit(process.env.RATE_LIMIT_TRANSCRIPT_DELETE_PER_MIN, 20),
      req: request,
    });

    const resolved = await resolveUserId(request, prisma);
    if ('error' in resolved) {
      return resolved.error;
    }

    const transcript = await prisma.transcript.findUnique({
      where: { id: params.id },
      include: { document: true },
    });

    if (!transcript || transcript.userId !== resolved.userId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const storageUrl = transcript.document?.storageUrl ?? null;

    await prisma.transcript.delete({ where: { id: params.id } });

    if (storageUrl) {
      const storageProvider = createStorageProviderFromEnv();
      await storageProvider.deleteObject(storageUrl).catch(() => null);
    }

    return NextResponse.json({ status: 'deleted' });
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
