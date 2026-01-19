import { NextResponse } from 'next/server';

import { getPrisma } from '../../../../../../src/db/prisma';
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

  try {
    const access = await requireAccess(request, prisma);
    if (access.source !== 'session') {
      return NextResponse.json({ error: 'Login required' }, { status: 401 });
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
      return NextResponse.json({ error: 'User not found' }, { status: 401 });
    }

    const transcript = await prisma.transcript.findUnique({
      where: { id: params.id },
      include: { document: true },
    });

    if (!transcript || transcript.userId !== user.id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const storageUrlFromBody =
      typeof body?.storageUrl === 'string' ? body.storageUrl.trim() : '';
    const storageUrl = transcript.document?.storageUrl ?? storageUrlFromBody;

    if (!storageUrl) {
      return NextResponse.json({ error: 'storageUrl is required' }, { status: 400 });
    }

    const storageProvider = createStorageProviderFromEnv();
    const meta = await storageProvider.headObject(storageUrl);
    if (!meta) {
      return NextResponse.json({ error: 'Uploaded file not found' }, { status: 404 });
    }

    const maxBytes = parseMaxBytes();
    if (meta.size > maxBytes) {
      await storageProvider.deleteObject(storageUrl);
      return NextResponse.json({ error: 'File too large' }, { status: 413 });
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

    return NextResponse.json({ status: 'UPLOADED', sizeBytes: meta.size });
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
