import { NextResponse } from 'next/server';

import { getPrisma } from '../../../../../../src/db/prisma';
import { logAuditEvent } from '../../../../../../src/lib/auditLog';
import { requireAccess } from '../../../../../../src/lib/access';
import { rateLimitOrThrow, RateLimitError } from '../../../../../../src/lib/rateLimit';
import { createStorageProviderFromEnv } from '../../../../../../src/lib/storage';

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

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const prisma = getPrisma();
  const action = 'transcript.complete_upload';
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
        resource: 'transcript',
        resourceId: params.id,
        metadata: { reason: 'login_required' },
      });
      return response;
    }

    await rateLimitOrThrow({
      key: 'transcript_complete_upload',
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
        resource: 'transcript',
        resourceId: params.id,
        metadata: { reason: 'user_not_found' },
      });
      return response;
    }

    const transcript = await prisma.transcript.findUnique({
      where: { id: params.id },
      include: { document: true },
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

    const body = await request.json().catch(() => ({}));
    const storageUrlFromBody =
      typeof body?.storageUrl === 'string' ? body.storageUrl.trim() : '';
    const storageUrl = transcript.document?.storageUrl ?? storageUrlFromBody;

    if (!storageUrl) {
      const response = NextResponse.json({ error: 'storageUrl is required' }, { status: 400 });
      await logAuditEvent({
        prisma,
        req: request,
        access,
        action,
        statusCode: 400,
        success: false,
        resource: 'transcript',
        resourceId: params.id,
        metadata: { reason: 'missing_storage_url' },
      });
      return response;
    }

    const storageProvider = createStorageProviderFromEnv();
    const meta = await storageProvider.headObject(storageUrl);
    if (!meta) {
      const response = NextResponse.json({ error: 'Uploaded file not found' }, { status: 404 });
      await logAuditEvent({
        prisma,
        req: request,
        access,
        action,
        statusCode: 404,
        success: false,
        resource: 'transcript',
        resourceId: params.id,
        metadata: { reason: 'upload_not_found' },
      });
      return response;
    }

    const maxBytes = parseMaxBytes();
    if (meta.size > maxBytes) {
      await storageProvider.deleteObject(storageUrl);
      const response = NextResponse.json({ error: 'File too large' }, { status: 413 });
      await logAuditEvent({
        prisma,
        req: request,
        access,
        action,
        statusCode: 413,
        success: false,
        resource: 'transcript',
        resourceId: params.id,
        metadata: { reason: 'file_too_large', sizeBytes: meta.size, maxBytes },
      });
      return response;
    }

    await prisma.$transaction([
      prisma.transcript.update({
        where: { id: params.id },
        data: { status: 'UPLOADED' },
      }),
      prisma.transcriptDocument.update({
        where: { transcriptId: params.id },
        data: { storageUrl },
      }),
    ]);

    const response = NextResponse.json({ status: 'UPLOADED', sizeBytes: meta.size });
    await logAuditEvent({
      prisma,
      req: request,
      access,
      action,
      statusCode: 200,
      success: true,
      resource: 'transcript',
      resourceId: params.id,
      metadata: { sizeBytes: meta.size },
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
