import { NextResponse } from 'next/server';

import { getPrisma } from '../../../../../src/db/prisma';
import { AccessError, requireAccess } from '../../../../../src/lib/access';

export const runtime = "nodejs";

export async function GET(req: Request) {
  const accessMode = process.env.ACCESS_MODE ?? 'invite';
  if (accessMode === 'public') {
    return NextResponse.json({ mode: 'public' });
  }

  const prisma = getPrisma();

  try {
    const context = await requireAccess(req, prisma);
    return NextResponse.json({ email: context.email, source: context.source ?? 'session' });
  } catch (error) {
    if (error instanceof AccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof Error && 'status' in error) {
      const status = (error as { status?: number }).status ?? 401;
      return NextResponse.json({ error: error.message }, { status });
    }

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}
