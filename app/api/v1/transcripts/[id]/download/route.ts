import { NextResponse } from 'next/server';

import { getPrisma } from '../../../../../../src/db/prisma';
import { requireAccess } from '../../../../../../src/lib/access';
import { createStorageProviderFromEnv } from '../../../../../../src/lib/storage';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const prisma = getPrisma();

  try {
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
      include: { document: true },
    });

    if (!transcript || transcript.userId !== user.id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const storageUrl = transcript.document?.storageUrl;
    if (!storageUrl) {
      return NextResponse.json({ error: 'Source file unavailable' }, { status: 404 });
    }

    const storage = createStorageProviderFromEnv();
    const buffer = await storage.readObject(storageUrl);
    const filename = `transcript-${params.id}.pdf`;

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Unknown error' }, { status: 500 });
  }
}
