import { NextResponse } from 'next/server';

import { getPrisma } from '../../../../../../src/db/prisma';
import { logAuditEvent } from '../../../../../../src/lib/auditLog';
import {
  getAuditFilterConfig,
  getEnvAuditFilterConfig,
  getStoredAuditFilterConfig,
  setAuditFilterConfig,
} from '../../../../../../src/lib/auditFilters';
import { requireAdmin } from '../../../../../../src/lib/adminAccess';
import { AccessError, getOptionalAccess } from '../../../../../../src/lib/access';

export const runtime = 'nodejs';

type AuditFilterPayload = {
  ignoreUserAgents?: string[];
  ignoreActions?: string[];
};

function normalizeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
}

export async function GET(req: Request) {
  const prisma = getPrisma();
  const action = 'admin.audit_logs.config';
  let access = null;

  try {
    access = await getOptionalAccess(req, prisma);
    const adminAccess = await requireAdmin(req, prisma);
    access = adminAccess;

    const stored = await getStoredAuditFilterConfig(prisma);
    const env = getEnvAuditFilterConfig();
    const effective = await getAuditFilterConfig(prisma, { bypassCache: true });

    const response = NextResponse.json({ stored, env, effective });
    await logAuditEvent({
      prisma,
      req,
      access,
      action,
      statusCode: 200,
      success: true,
      resource: 'audit_log',
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

export async function PUT(req: Request) {
  const prisma = getPrisma();
  const action = 'admin.audit_logs.config_update';
  let access = null;

  try {
    access = await getOptionalAccess(req, prisma);
    const adminAccess = await requireAdmin(req, prisma);
    access = adminAccess;

    const body = (await req.json().catch(() => ({}))) as AuditFilterPayload;
    const ignoreUserAgents = normalizeList(body.ignoreUserAgents);
    const ignoreActions = normalizeList(body.ignoreActions);

    await setAuditFilterConfig(prisma, {
      ignoreUserAgents,
      ignoreActions,
    });
    const stored = await getStoredAuditFilterConfig(prisma);
    const env = getEnvAuditFilterConfig();
    const effective = await getAuditFilterConfig(prisma, { bypassCache: true });

    const response = NextResponse.json({ stored, env, effective });
    await logAuditEvent({
      prisma,
      req,
      access,
      action,
      statusCode: 200,
      success: true,
      resource: 'audit_log',
      metadata: { ignoreUserAgents, ignoreActions },
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
