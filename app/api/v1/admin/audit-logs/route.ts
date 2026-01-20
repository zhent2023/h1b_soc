import { NextResponse } from 'next/server';

import { Prisma } from '@prisma/client';

import { getPrisma } from '../../../../../src/db/prisma';
import { logAuditEvent } from '../../../../../src/lib/auditLog';
import { getAuditFilterConfig } from '../../../../../src/lib/auditFilters';
import { requireAdmin } from '../../../../../src/lib/adminAccess';
import { AccessError, getOptionalAccess } from '../../../../../src/lib/access';

export const runtime = 'nodejs';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function parseLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.floor(parsed), 1), MAX_LIMIT);
}

function parseDate(raw: string | null): Date | null {
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function parseBool(raw: string | null): boolean | undefined {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return undefined;
}

function parseCsv(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseStatusCode(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.trunc(parsed);
}

function buildActionExcludeFilter(entry: string): Prisma.AuditLogWhereInput | null {
  const trimmed = entry.trim();
  if (!trimmed) return null;
  if (trimmed.endsWith('*')) {
    const prefix = trimmed.slice(0, -1);
    if (!prefix) return null;
    return { action: { startsWith: prefix, mode: 'insensitive' } };
  }
  return { action: { contains: trimmed, mode: 'insensitive' } };
}

export async function GET(req: Request) {
  const prisma = getPrisma();
  const action = 'admin.audit_logs.list';
  let access = null;

  try {
    access = await getOptionalAccess(req, prisma);
    const adminAccess = await requireAdmin(req, prisma);
    access = adminAccess;

    const url = new URL(req.url);
    const cursor = url.searchParams.get('cursor')?.trim() || null;
    const limit = parseLimit(url.searchParams.get('limit'));
    const actorEmail = url.searchParams.get('actorEmail')?.trim() || '';
    const actionFilter = url.searchParams.get('action')?.trim() || '';
    const resource = url.searchParams.get('resource')?.trim() || '';
    const resourceId = url.searchParams.get('resourceId')?.trim() || '';
    const method = url.searchParams.get('method')?.trim().toUpperCase() || '';
    const path = url.searchParams.get('path')?.trim() || '';
    const userAgent = url.searchParams.get('userAgent')?.trim() || '';
    const excludeUserAgent = url.searchParams.get('excludeUserAgent')?.trim() || '';
    const excludeActions = url.searchParams.get('excludeActions')?.trim() || '';
    const includeIgnored = url.searchParams.get('includeIgnored') === 'true';
    const success = parseBool(url.searchParams.get('success'));
    const statusCode = parseStatusCode(url.searchParams.get('statusCode'));
    const from = parseDate(url.searchParams.get('from'));
    const to = parseDate(url.searchParams.get('to'));

    const where: Prisma.AuditLogWhereInput = {};
    if (actorEmail) {
      where.actorEmail = { contains: actorEmail, mode: 'insensitive' };
    }
    if (actionFilter) {
      where.action = { contains: actionFilter, mode: 'insensitive' };
    }
    if (resource) {
      where.resource = { contains: resource, mode: 'insensitive' };
    }
    if (resourceId) {
      where.resourceId = { contains: resourceId, mode: 'insensitive' };
    }
    if (method) {
      where.method = method;
    }
    if (path) {
      where.path = { contains: path, mode: 'insensitive' };
    }
    if (userAgent) {
      where.userAgent = { contains: userAgent, mode: 'insensitive' };
    }
    if (typeof success === 'boolean') {
      where.success = success;
    }
    if (typeof statusCode === 'number') {
      where.statusCode = statusCode;
    }
    if (from || to) {
      where.createdAt = {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      };
    }

    const excludeAgents = parseCsv(excludeUserAgent);
    const excludeActionList = parseCsv(excludeActions);
    const ignoredConfig = includeIgnored ? null : await getAuditFilterConfig(prisma);
    const ignoredAgents = ignoredConfig?.ignoreUserAgents ?? [];
    const ignoredActions = ignoredConfig?.ignoreActions ?? [];

    const allExcludedAgents = [...ignoredAgents, ...excludeAgents];
    const allExcludedActions = [...ignoredActions, ...excludeActionList];
    const notFilters: Prisma.AuditLogWhereInput[] = [];
    if (allExcludedAgents.length > 0) {
      notFilters.push(
        ...allExcludedAgents.map((agent) => ({
          userAgent: { contains: agent, mode: 'insensitive' },
        })),
      );
    }
    if (allExcludedActions.length > 0) {
      const actionFilters = allExcludedActions
        .map((entry) => buildActionExcludeFilter(entry))
        .filter((filter): filter is Prisma.AuditLogWhereInput => Boolean(filter));
      notFilters.push(...actionFilters);
    }
    if (notFilters.length > 0) {
      where.NOT = notFilters;
    }

    const logs = await prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = logs.length > limit;
    const items = hasMore ? logs.slice(0, limit) : logs;
    const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

    const response = NextResponse.json({ items, nextCursor });
    await logAuditEvent({
      prisma,
      req,
      access,
      action,
      statusCode: 200,
      success: true,
      resource: 'audit_log',
      metadata: {
        limit,
        cursor: cursor || null,
        filters: {
          actorEmail: actorEmail || null,
          action: actionFilter || null,
          resource: resource || null,
          resourceId: resourceId || null,
          method: method || null,
          path: path || null,
          userAgent: userAgent || null,
          excludeUserAgent: excludeUserAgent || null,
          excludeActions: excludeActions || null,
          includeIgnored,
          success: typeof success === 'boolean' ? success : null,
          statusCode: typeof statusCode === 'number' ? statusCode : null,
          from: from?.toISOString() ?? null,
          to: to?.toISOString() ?? null,
        },
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
