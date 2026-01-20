import { NextResponse } from 'next/server';

import { getPrisma } from '../../../../../src/db/prisma';
import { logAuditEvent } from '../../../../../src/lib/auditLog';
import { AccessError, requireAccess } from '../../../../../src/lib/access';

export const runtime = "nodejs";

export async function GET(req: Request) {
  const accessMode = process.env.ACCESS_MODE ?? 'invite';
  if (accessMode === 'public') {
    return NextResponse.json({ mode: 'public' });
  }

  const prisma = getPrisma();
  const action = 'auth.me';

  try {
    const context = await requireAccess(req, prisma);
    const response = NextResponse.json({ email: context.email, source: context.source ?? 'session' });
    await logAuditEvent({
      prisma,
      req,
      access: context,
      action,
      statusCode: 200,
      success: true,
    });
    return response;
  } catch (error) {
    if (error instanceof AccessError) {
      const response = NextResponse.json({ error: error.message }, { status: error.status });
      await logAuditEvent({
        prisma,
        req,
        action,
        statusCode: error.status,
        success: false,
        metadata: { reason: 'access_error', message: error.message },
      });
      return response;
    }

    if (error instanceof Error && 'status' in error) {
      const status = (error as { status?: number }).status ?? 401;
      const response = NextResponse.json({ error: error.message }, { status });
      await logAuditEvent({
        prisma,
        req,
        action,
        statusCode: status,
        success: false,
        metadata: { reason: 'error', message: error.message },
      });
      return response;
    }

    if (error instanceof Error) {
      const response = NextResponse.json({ error: error.message }, { status: 401 });
      await logAuditEvent({
        prisma,
        req,
        action,
        statusCode: 401,
        success: false,
        metadata: { reason: 'error', message: error.message },
      });
      return response;
    }

    const response = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    await logAuditEvent({
      prisma,
      req,
      action,
      statusCode: 401,
      success: false,
      metadata: { reason: 'unauthorized' },
    });
    return response;
  }
}
