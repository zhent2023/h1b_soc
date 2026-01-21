import { NextResponse } from 'next/server';

import { Prisma } from '@prisma/client';

import { getPrisma } from '../../../../../../src/db/prisma';
import { logAuditEvent } from '../../../../../../src/lib/auditLog';
import { getAuditFilterConfig } from '../../../../../../src/lib/auditFilters';
import { requireAdmin } from '../../../../../../src/lib/adminAccess';
import { AccessError, getOptionalAccess } from '../../../../../../src/lib/access';

export const runtime = 'nodejs';

const DEFAULT_DAYS = 14;
const TOP_LIMIT = 8;

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

function parseStatusCode(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.trunc(parsed);
}

function parseCsv(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function toLikePattern(raw: string): string {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return '%';
  if (normalized.endsWith('*')) {
    return `${normalized.slice(0, -1)}%`;
  }
  return `%${normalized}%`;
}

function buildWhereClause(filters: {
  actorEmail: string;
  action: string;
  resource: string;
  resourceId: string;
  method: string;
  path: string;
  userAgent: string;
  success?: boolean;
  statusCode?: number;
  from: Date;
  to: Date;
  excludeActions: string[];
  excludeUserAgents: string[];
}): Prisma.Sql {
  const conditions: Prisma.Sql[] = [];

  if (filters.actorEmail) {
    conditions.push(
      Prisma.sql`LOWER("actorEmail") LIKE ${toLikePattern(filters.actorEmail)}`,
    );
  }
  if (filters.action) {
    conditions.push(Prisma.sql`LOWER("action") LIKE ${toLikePattern(filters.action)}`);
  }
  if (filters.resource) {
    conditions.push(
      Prisma.sql`LOWER("resource") LIKE ${toLikePattern(filters.resource)}`,
    );
  }
  if (filters.resourceId) {
    conditions.push(
      Prisma.sql`LOWER("resourceId") LIKE ${toLikePattern(filters.resourceId)}`,
    );
  }
  if (filters.method) {
    conditions.push(Prisma.sql`"method" = ${filters.method}`);
  }
  if (filters.path) {
    conditions.push(Prisma.sql`LOWER("path") LIKE ${toLikePattern(filters.path)}`);
  }
  if (filters.userAgent) {
    conditions.push(
      Prisma.sql`COALESCE(LOWER("userAgent"), '') LIKE ${toLikePattern(filters.userAgent)}`,
    );
  }
  if (typeof filters.success === 'boolean') {
    conditions.push(Prisma.sql`"success" = ${filters.success}`);
  }
  if (typeof filters.statusCode === 'number') {
    conditions.push(Prisma.sql`"statusCode" = ${filters.statusCode}`);
  }
  conditions.push(Prisma.sql`"createdAt" >= ${filters.from}`);
  conditions.push(Prisma.sql`"createdAt" <= ${filters.to}`);

  if (filters.excludeUserAgents.length > 0) {
    const agentConditions = filters.excludeUserAgents.map((entry) => {
      const pattern = toLikePattern(entry);
      return Prisma.sql`COALESCE(LOWER("userAgent"), '') LIKE ${pattern}`;
    });
    conditions.push(Prisma.sql`NOT (${Prisma.join(agentConditions, ' OR ')})`);
  }
  if (filters.excludeActions.length > 0) {
    const actionConditions = filters.excludeActions.map((entry) => {
      const pattern = toLikePattern(entry);
      return Prisma.sql`LOWER("action") LIKE ${pattern}`;
    });
    conditions.push(Prisma.sql`NOT (${Prisma.join(actionConditions, ' OR ')})`);
  }

  if (conditions.length === 0) {
    return Prisma.sql``;
  }

  return Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
}

function normalizeDateRange(from: Date | null, to: Date | null) {
  const end = to ?? new Date();
  const start = from ?? new Date(end.getTime() - (DEFAULT_DAYS - 1) * 24 * 60 * 60 * 1000);
  if (!from) {
    start.setHours(0, 0, 0, 0);
  }
  if (!to) {
    end.setHours(23, 59, 59, 999);
  }
  return { from: start, to: end };
}

export async function GET(req: Request) {
  const prisma = getPrisma();
  const action = 'admin.audit_logs.insights';
  let access = null;

  try {
    access = await getOptionalAccess(req, prisma);
    const adminAccess = await requireAdmin(req, prisma);
    access = adminAccess;

    const url = new URL(req.url);
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
    const range = normalizeDateRange(
      parseDate(url.searchParams.get('from')),
      parseDate(url.searchParams.get('to')),
    );

    const excludedAgents = parseCsv(excludeUserAgent);
    const excludedActions = parseCsv(excludeActions);
    const ignoredConfig = includeIgnored ? null : await getAuditFilterConfig(prisma);
    const ignoredAgents = ignoredConfig?.ignoreUserAgents ?? [];
    const ignoredActions = ignoredConfig?.ignoreActions ?? [];

    const whereClause = buildWhereClause({
      actorEmail,
      action: actionFilter,
      resource,
      resourceId,
      method,
      path,
      userAgent,
      success,
      statusCode,
      from: range.from,
      to: range.to,
      excludeActions: [...ignoredActions, ...excludedActions],
      excludeUserAgents: [...ignoredAgents, ...excludedAgents],
    });

    const [summaryRow] = await prisma.$queryRaw<
      Array<{
        total: number;
        success: number;
        failure: number;
        unique_actors: number;
        unknown_actors: number;
        status_401: number;
        status_403: number;
        status_2xx: number;
        status_3xx: number;
        status_4xx: number;
        status_5xx: number;
      }>
    >(Prisma.sql`
      SELECT
        COUNT(*)::int AS total,
        SUM(CASE WHEN "success" THEN 1 ELSE 0 END)::int AS success,
        SUM(CASE WHEN "success" THEN 0 ELSE 1 END)::int AS failure,
        COUNT(DISTINCT COALESCE("actorUserId"::text, "actorAccessUserId"::text, "actorEmail"))::int AS unique_actors,
        SUM(CASE WHEN "actorEmail" IS NULL THEN 1 ELSE 0 END)::int AS unknown_actors,
        SUM(CASE WHEN "statusCode" = 401 THEN 1 ELSE 0 END)::int AS status_401,
        SUM(CASE WHEN "statusCode" = 403 THEN 1 ELSE 0 END)::int AS status_403,
        SUM(CASE WHEN "statusCode" BETWEEN 200 AND 299 THEN 1 ELSE 0 END)::int AS status_2xx,
        SUM(CASE WHEN "statusCode" BETWEEN 300 AND 399 THEN 1 ELSE 0 END)::int AS status_3xx,
        SUM(CASE WHEN "statusCode" BETWEEN 400 AND 499 THEN 1 ELSE 0 END)::int AS status_4xx,
        SUM(CASE WHEN "statusCode" BETWEEN 500 AND 599 THEN 1 ELSE 0 END)::int AS status_5xx
      FROM "AuditLog"
      ${whereClause}
    `);

    const dailyRows = await prisma.$queryRaw<
      Array<{ day: Date; total: number; success: number; failure: number }>
    >(Prisma.sql`
      SELECT
        date_trunc('day', "createdAt") AS day,
        COUNT(*)::int AS total,
        SUM(CASE WHEN "success" THEN 1 ELSE 0 END)::int AS success,
        SUM(CASE WHEN "success" THEN 0 ELSE 1 END)::int AS failure
      FROM "AuditLog"
      ${whereClause}
      GROUP BY day
      ORDER BY day ASC
    `);

    const topActions = await prisma.$queryRaw<
      Array<{ action: string; total: number; failure: number }>
    >(Prisma.sql`
      SELECT
        "action" AS action,
        COUNT(*)::int AS total,
        SUM(CASE WHEN "success" THEN 0 ELSE 1 END)::int AS failure
      FROM "AuditLog"
      ${whereClause}
      GROUP BY "action"
      ORDER BY total DESC
      LIMIT ${TOP_LIMIT}
    `);

    const topPaths = await prisma.$queryRaw<
      Array<{ method: string; path: string; total: number; failure: number }>
    >(Prisma.sql`
      SELECT
        "method" AS method,
        "path" AS path,
        COUNT(*)::int AS total,
        SUM(CASE WHEN "success" THEN 0 ELSE 1 END)::int AS failure
      FROM "AuditLog"
      ${whereClause}
      GROUP BY "method", "path"
      ORDER BY total DESC
      LIMIT ${TOP_LIMIT}
    `);

    const topActors = await prisma.$queryRaw<
      Array<{ actor: string; total: number }>
    >(Prisma.sql`
      SELECT
        COALESCE("actorEmail", 'unknown') AS actor,
        COUNT(*)::int AS total
      FROM "AuditLog"
      ${whereClause}
      GROUP BY actor
      ORDER BY total DESC
      LIMIT ${TOP_LIMIT}
    `);

    const summary = summaryRow ?? {
      total: 0,
      success: 0,
      failure: 0,
      unique_actors: 0,
      unknown_actors: 0,
      status_401: 0,
      status_403: 0,
      status_2xx: 0,
      status_3xx: 0,
      status_4xx: 0,
      status_5xx: 0,
    };

    const response = NextResponse.json({
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      summary: {
        total: summary.total ?? 0,
        success: summary.success ?? 0,
        failure: summary.failure ?? 0,
        successRate: summary.total ? summary.success / summary.total : 0,
        uniqueActors: summary.unique_actors ?? 0,
        unknownActors: summary.unknown_actors ?? 0,
        status401: summary.status_401 ?? 0,
        status403: summary.status_403 ?? 0,
      },
      statusBuckets: {
        success2xx: summary.status_2xx ?? 0,
        redirect3xx: summary.status_3xx ?? 0,
        client4xx: summary.status_4xx ?? 0,
        server5xx: summary.status_5xx ?? 0,
      },
      daily: dailyRows.map((row) => ({
        date: row.day.toISOString(),
        total: row.total ?? 0,
        success: row.success ?? 0,
        failure: row.failure ?? 0,
      })),
      topActions,
      topPaths,
      topActors,
    });

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
