import { NextResponse } from 'next/server';

import { getPrisma } from '../../../../../src/db/prisma';
import { logAuditEvent } from '../../../../../src/lib/auditLog';
import { getOptionalAccess } from '../../../../../src/lib/access';

export const runtime = "nodejs";

function parseLimit(raw: string | null): number {
  if (!raw) return 50;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 50;
  return Math.min(Math.max(parsed, 1), 200);
}

export async function GET(req: Request) {
  const prisma = getPrisma();
  const action = 'onet.occupations';
  const access = await getOptionalAccess(req, prisma);
  const url = new URL(req.url);
  const query = (url.searchParams.get('q') ?? '').trim();
  const limit = parseLimit(url.searchParams.get('limit'));

  if (!query) {
    const response = NextResponse.json({ items: [] });
    await logAuditEvent({
      prisma,
      req,
      access,
      action,
      statusCode: 200,
      success: true,
      resource: 'onet',
      metadata: { queryPresent: false },
    });
    return response;
  }

  const datasetVersion = await prisma.datasetVersion.findFirst({
    where: { datasetName: 'onet', isActive: true },
  });

  if (!datasetVersion) {
    const response = NextResponse.json(
      { error: 'Active O*NET dataset version not found' },
      { status: 500 },
    );
    await logAuditEvent({
      prisma,
      req,
      access,
      action,
      statusCode: 500,
      success: false,
      resource: 'onet',
      metadata: { reason: 'dataset_missing' },
    });
    return response;
  }

  const [codeMatches, titleMatches] = await Promise.all([
    prisma.onetOccupation.findMany({
      where: {
        datasetVersionId: datasetVersion.id,
        onetCode: { startsWith: query },
      },
      orderBy: { onetCode: 'asc' },
      take: limit,
      select: { onetCode: true, title: true, jobZone: true },
    }),
    prisma.onetOccupation.findMany({
      where: {
        datasetVersionId: datasetVersion.id,
        title: { contains: query, mode: 'insensitive' },
      },
      orderBy: { onetCode: 'asc' },
      take: limit,
      select: { onetCode: true, title: true, jobZone: true },
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

  const response = NextResponse.json({ items: merged.slice(0, limit) });
  await logAuditEvent({
    prisma,
    req,
    access,
    action,
    statusCode: 200,
    success: true,
    resource: 'onet',
    metadata: { queryPresent: true, limit, resultCount: merged.length },
  });
  return response;
}
