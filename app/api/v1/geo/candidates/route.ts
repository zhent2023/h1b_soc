import { NextResponse } from 'next/server';

import { getPrisma } from '../../../../../src/db/prisma';
import { logAuditEvent } from '../../../../../src/lib/auditLog';
import { getOptionalAccess } from '../../../../../src/lib/access';
import { rateLimitOrThrow, RateLimitError } from '../../../../../src/lib/rateLimit';

export const runtime = "nodejs";

export async function GET(req: Request) {
  const prisma = getPrisma();
  const action = 'geo.candidates';
  const access = await getOptionalAccess(req, prisma);
  const url = new URL(req.url);
  const state = (url.searchParams.get('state') ?? '').trim().toUpperCase();
  const query = (url.searchParams.get('q') ?? '').trim().toLowerCase();
  const limitParam = url.searchParams.get('limit');
  const cursor = (url.searchParams.get('cursor') ?? '').trim();

  if (!state) {
    const response = NextResponse.json({ error: 'state is required' }, { status: 400 });
    await logAuditEvent({
      prisma,
      req,
      access,
      action,
      statusCode: 400,
      success: false,
      resource: 'geo',
      metadata: { reason: 'missing_state' },
    });
    return response;
  }

  try {
    const limitPerMin = Number(process.env.RATE_LIMIT_GEO_CANDIDATES_PER_MIN ?? '120');
    await rateLimitOrThrow({
      key: 'geo_candidates',
      limitPerMin: Number.isFinite(limitPerMin) ? limitPerMin : 120,
      req,
    });
  } catch (error) {
    if (error instanceof RateLimitError) {
      const response = NextResponse.json(
        { error: 'Rate limit exceeded' },
        { status: error.status, headers: error.headers },
      );
      await logAuditEvent({
        prisma,
        req,
        access,
        action,
        statusCode: error.status,
        success: false,
        resource: 'geo',
        metadata: { reason: 'rate_limited' },
      });
      return response;
    }
    throw error;
  }

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
      resource: 'geo',
      metadata: { reason: 'dataset_missing' },
    });
    return response;
  }

  const limitRaw = limitParam ? Number(limitParam) : 50;
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 50;

  const results = await prisma.oflcAreaCounty.findMany({
    where: {
      datasetVersionId: datasetVersion.id,
      stateAb: state,
      ...(query
        ? {
            countyTownNameNorm: {
              contains: query,
            },
          }
        : {}),
    },
    include: {
      area: true,
    },
    orderBy: [{ countyTownNameNorm: 'asc' }, { areaCode: 'asc' }, { id: 'asc' }],
    ...(cursor
      ? {
          cursor: { id: cursor },
          skip: 1,
        }
      : {}),
    take: limit + 1,
  });

  const items = results.slice(0, limit).map((entry) => ({
    areaCode: entry.areaCode,
    areaName: entry.area.areaName,
    areaType: 'oflc',
    stateAb: entry.stateAb,
    countyFips: entry.countyFips,
    countyTownName: entry.countyTownName,
    matchKind: entry.matchKind,
  }));
  const nextCursor = results.length > limit ? results[limit - 1]?.id : undefined;

  const response = NextResponse.json({
    items,
    nextCursor,
  });
  await logAuditEvent({
    prisma,
    req,
    access,
    action,
    statusCode: 200,
    success: true,
    resource: 'geo',
    metadata: { state, queryPresent: Boolean(query), limit },
  });
  return response;
}
