import { NextResponse } from 'next/server';

import { getPrisma } from '../../../../../src/db/prisma';
import { logAuditEvent } from '../../../../../src/lib/auditLog';
import { getOptionalAccess } from '../../../../../src/lib/access';

export const runtime = "nodejs";

export async function GET(req: Request) {
  const prisma = getPrisma();
  const action = 'soc.codes';
  const access = await getOptionalAccess(req, prisma);
  const url = new URL(req.url);
  const query = (url.searchParams.get('q') ?? '').trim();

  const datasetVersion = await prisma.datasetVersion.findFirst({
    where: { datasetName: 'oflc', isActive: true },
  });

  if (!datasetVersion) {
    const response = NextResponse.json(
      { error: 'Active OFLC dataset version not found' },
      { status: 500 },
    );
    await logAuditEvent({
      prisma,
      req,
      access,
      action,
      statusCode: 500,
      success: false,
      resource: 'soc',
      metadata: { reason: 'dataset_missing' },
    });
    return response;
  }

  const results = await prisma.socTitle.findMany({
    where: {
      datasetVersionId: datasetVersion.id,
      ...(query
        ? {
            OR: [
              { socCode: { contains: query, mode: 'insensitive' } },
              { title: { contains: query, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: { socCode: 'asc' },
    take: 200,
  });

  const response = NextResponse.json(
    results.map((entry) => ({ code: entry.socCode, title: entry.title })),
  );
  await logAuditEvent({
    prisma,
    req,
    access,
    action,
    statusCode: 200,
    success: true,
    resource: 'soc',
    metadata: { queryPresent: Boolean(query), resultCount: results.length },
  });
  return response;
}
