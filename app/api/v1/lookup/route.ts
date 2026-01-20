import { NextResponse } from 'next/server';

import { getPrisma } from '../../../../src/db/prisma';
import { logAuditEvent } from '../../../../src/lib/auditLog';
import { lookup, LookupError } from '../../../../src/lib/lookup';
import { requireAccess } from '../../../../src/lib/access';
import { rateLimitOrThrow, RateLimitError } from '../../../../src/lib/rateLimit';
import { runWithCacheContext } from '../../../../src/lib/cache';

export const runtime = "nodejs";

export async function POST(req: Request) {
  const prisma = getPrisma();
  const action = 'lookup';
  let access = null;
  let isSocOnly = false;
  let previousDelay: string | undefined;
  let delayOverridden = false;

  try {
    const url = new URL(req.url);
    const debugAllowed =
      process.env.ENABLE_DEBUG_TOOLS === 'true' && process.env.NODE_ENV !== 'production';
    const headersAllowed =
      process.env.ENABLE_DEBUG_HEADERS === 'true' && process.env.NODE_ENV !== 'production';
    const debugSleepRaw = url.searchParams.get('debugSleepMs');
    const debugSleepMs = debugAllowed ? Number(debugSleepRaw) : 0;

    if (debugAllowed && Number.isFinite(debugSleepMs) && debugSleepMs > 0) {
      previousDelay = process.env.LOOKUP_DELAY_MS;
      delayOverridden = true;
      const capped = Math.min(debugSleepMs, 30_000);
      process.env.LOOKUP_DELAY_MS = String(capped);
    }

    access = await requireAccess(req, prisma);
    const body = await req.json();
    isSocOnly = Boolean(body?.socCode) && !body?.address;
    const limit = Number(
      isSocOnly
        ? process.env.RATE_LIMIT_SOC_EXTREMES_PER_MIN ?? '30'
        : process.env.RATE_LIMIT_LOOKUP_PER_MIN ?? '50',
    );
    await rateLimitOrThrow({
      key: isSocOnly ? 'soc_extremes' : 'lookup',
      limitPerMin: Number.isFinite(limit) ? limit : isSocOnly ? 30 : 50,
      req,
    });

    const result = headersAllowed
      ? await runWithCacheContext(() => lookup(body, { prisma }))
      : { result: await lookup(body, { prisma }), hits: 0, misses: 0 };

    const response = NextResponse.json(result.result);
    if (headersAllowed) {
      response.headers.set('x-cache', result.hits > 0 ? 'hit' : 'miss');
    }

    await logAuditEvent({
      prisma,
      req,
      access,
      action,
      statusCode: 200,
      success: true,
      resource: 'lookup',
      metadata: { socOnly: isSocOnly },
    });
    return response;
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
        resource: 'lookup',
        metadata: { reason: 'rate_limited', socOnly: isSocOnly },
      });
      return response;
    }

    if (error instanceof LookupError) {
      const response = NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
      await logAuditEvent({
        prisma,
        req,
        access,
        action,
        statusCode: error.status,
        success: false,
        resource: 'lookup',
        metadata: { reason: 'lookup_error', code: error.code },
      });
      return response;
    }

    if (error instanceof Error && 'status' in error) {
      const status = (error as { status?: number }).status ?? 400;
      const response = NextResponse.json({ error: error.message }, { status });
      await logAuditEvent({
        prisma,
        req,
        access,
        action,
        statusCode: status,
        success: false,
        resource: 'lookup',
        metadata: { reason: 'error', message: error.message },
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
        resource: 'lookup',
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
      resource: 'lookup',
      metadata: { reason: 'unknown_error' },
    });
    return response;
  } finally {
    if (delayOverridden && process.env.NODE_ENV !== 'production') {
      if (typeof previousDelay === 'undefined') {
        delete process.env.LOOKUP_DELAY_MS;
      } else {
        process.env.LOOKUP_DELAY_MS = previousDelay;
      }
    }
  }
}
