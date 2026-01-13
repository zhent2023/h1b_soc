import { NextResponse } from 'next/server';

import { getPrisma } from '../../../../../src/db/prisma';

export const runtime = "nodejs";

function parseLimit(raw: string | null): number {
  if (!raw) return 50;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 50;
  return Math.min(Math.max(parsed, 1), 200);
}

export async function GET(req: Request) {
  const prisma = getPrisma();
  const url = new URL(req.url);
  const query = (url.searchParams.get('q') ?? '').trim();
  const limit = parseLimit(url.searchParams.get('limit'));

  if (!query) {
    return NextResponse.json({ items: [] });
  }

  const datasetVersion = await prisma.datasetVersion.findFirst({
    where: { datasetName: 'onet', isActive: true },
  });

  if (!datasetVersion) {
    return NextResponse.json({ error: 'Active O*NET dataset version not found' }, { status: 500 });
  }

  const [codeMatches, titleMatches] = await Promise.all([
    prisma.onetOccupation.findMany({
      where: {
        datasetVersionId: datasetVersion.id,
        onetCode: { startsWith: query },
      },
      orderBy: { onetCode: 'asc' },
      take: limit,
      select: { onetCode: true, title: true },
    }),
    prisma.onetOccupation.findMany({
      where: {
        datasetVersionId: datasetVersion.id,
        title: { contains: query, mode: 'insensitive' },
      },
      orderBy: { onetCode: 'asc' },
      take: limit,
      select: { onetCode: true, title: true },
    }),
  ]);

  const seen = new Set<string>();
  const merged = [...codeMatches, ...titleMatches].filter((entry) => {
    if (seen.has(entry.onetCode)) {
      return false;
    }
    seen.add(entry.onetCode);
    return true;
  });

  return NextResponse.json({ items: merged.slice(0, limit) });
}
