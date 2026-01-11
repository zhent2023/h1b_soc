import { NextResponse } from 'next/server';

import { getPrisma } from '../../../src/db/prisma';

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const prisma = getPrisma();

  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, db: 'ok' });
  } catch (error) {
    return NextResponse.json(
      { ok: false, db: 'error', message: error instanceof Error ? error.message : 'unknown' },
      { status: 500 },
    );
  }
}
