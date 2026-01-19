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

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const prisma = getPrisma();

  try {
    const storageProvider = createStorageProviderFromEnv();
    if (storageProvider.providerId !== 'local' || !storageProvider.writeObject) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const access = await requireAccess(request, prisma);
    if (access.source !== 'session') {
      return NextResponse.json({ error: 'Login required' }, { status: 401 });
    }

    await rateLimitOrThrow({
      key: 'transcript_upload',
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

    const body = Buffer.from(await request.arrayBuffer());
    if (body.length === 0) {
      return NextResponse.json({ error: 'Empty upload' }, { status: 400 });
    }

    const maxBytes = parseMaxBytes();
    if (body.length > maxBytes) {
      return NextResponse.json({ error: 'File too large' }, { status: 413 });
    }

    const storageUrl = transcript.document?.storageUrl;
    if (!storageUrl) {
      return NextResponse.json({ error: 'Upload target missing' }, { status: 400 });
    }

    await storageProvider.writeObject(storageUrl, body);

    return NextResponse.json({ storageUrl, sizeBytes: body.length });
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
