import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';

import { getPrisma } from '../../../../../src/db/prisma';
import { logAuditEvent } from '../../../../../src/lib/auditLog';
import { requireAccess } from '../../../../../src/lib/access';
import { rateLimitOrThrow, RateLimitError } from '../../../../../src/lib/rateLimit';
import { createStorageProviderFromEnv } from '../../../../../src/lib/storage';

export const runtime = 'nodejs';
export const maxDuration = 30;

function parseLimit(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, parsed);
}

function parseMaxBytes(): number {
  return parseLimit(process.env.TRANSCRIPT_MAX_BYTES, 10 * 1024 * 1024);
}

export async function POST(request: Request) {
  const prisma = getPrisma();
  const action = 'transcript.create';
  let access = null;

  try {
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
        metadata: { reason: 'login_required' },
      });
      return response;
    }

    await rateLimitOrThrow({
      key: 'transcript_create',
      limitPerMin: parseLimit(process.env.RATE_LIMIT_TRANSCRIPT_CREATE_PER_MIN, 20),
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
        metadata: { reason: 'user_not_found' },
      });
      return response;
    }

    const transcriptId = randomUUID();
    const storageProvider = createStorageProviderFromEnv();
    const uploadTarget = await storageProvider.createUploadTarget({
      userId: user.id,
      transcriptId,
      contentType: 'application/pdf',
      maxBytes: parseMaxBytes(),
    });

    await prisma.$transaction([
      prisma.transcript.create({
        data: {
          id: transcriptId,
          userId: user.id,
        },
      }),
      prisma.transcriptDocument.create({
        data: {
          transcriptId,
          storageUrl: uploadTarget.storageUrl ?? null,
        },
      }),
    ]);

    const response = NextResponse.json({
      transcriptId,
      upload: uploadTarget,
    });
    await logAuditEvent({
      prisma,
      req: request,
      access,
      action,
      statusCode: 200,
      success: true,
      resource: 'transcript',
      resourceId: transcriptId,
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
      metadata: { reason: 'unknown_error' },
    });
    return response;
  }
}
