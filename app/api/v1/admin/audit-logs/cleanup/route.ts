import { NextResponse } from 'next/server';

import { getPrisma } from '../../../../../../src/db/prisma';
import { logAuditEvent } from '../../../../../../src/lib/auditLog';
import { requireAdmin } from '../../../../../../src/lib/adminAccess';
import { AccessError, getOptionalAccess } from '../../../../../../src/lib/access';

export const runtime = 'nodejs';

const DEFAULT_TTL_DAYS = 180;

function parseTtlDays(raw: string | undefined, fallback = DEFAULT_TTL_DAYS): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
}

export async function POST(req: Request) {
  const prisma = getPrisma();
  const action = 'admin.audit_logs.cleanup';
  let access = null;

  try {
    access = await getOptionalAccess(req, prisma);
    const adminAccess = await requireAdmin(req, prisma);
    access = adminAccess;

    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const bodyTtl =
      body && typeof (body as { ttlDays?: unknown }).ttlDays === 'number'
        ? (body as { ttlDays: number }).ttlDays
        : undefined;
    const ttlDays = parseTtlDays(
      typeof bodyTtl === 'number' ? String(bodyTtl) : process.env.AUDIT_LOG_TTL_DAYS,
    );
    const cutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000);

    const result = await prisma.auditLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });

    const response = NextResponse.json({
      deleted: result.count,
      ttlDays,
      cutoff: cutoff.toISOString(),
    });

    await logAuditEvent({
      prisma,
      req,
      access,
      action,
      statusCode: 200,
      success: true,
      resource: 'audit_log',
      metadata: {
        deleted: result.count,
        ttlDays,
        cutoff: cutoff.toISOString(),
      },
    });

    return response;
  } catch (error) {
    if (error instanceof AccessError) {
      const response = NextResponse.json({ error: error.message }, { status: error.status });
      await logAuditEvent({
        prisma,
        req,
        access,
        action,
        statusCode: error.status,
        success: false,
        resource: 'audit_log',
        metadata: { reason: 'access_denied', message: error.message },
      });
      return response;
    }

    if (error instanceof Error) {
      const response = NextResponse.json({ error: error.message }, { status: 400 });
      await logAuditEvent({
        prisma,
        req,
        access,
        action,
        statusCode: 400,
        success: false,
        resource: 'audit_log',
        metadata: { reason: 'error', message: error.message },
      });
      return response;
    }

    const response = NextResponse.json({ error: 'Unknown error' }, { status: 500 });
    await logAuditEvent({
      prisma,
      req,
      access,
      action,
      statusCode: 500,
      success: false,
      resource: 'audit_log',
      metadata: { reason: 'unknown_error' },
    });
    return response;
  }
}
