import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';

import { AuditActorType } from '@prisma/client';

import { getPrisma } from '../../../../../src/db/prisma';
import { logAuditEvent } from '../../../../../src/lib/auditLog';
import { rateLimitOrThrow, RateLimitError } from '../../../../../src/lib/rateLimit';
import {
  createSessionToken,
  hashSessionToken,
  SESSION_COOKIE_NAME,
  shouldUseSecureSessionCookie,
  SESSION_TTL_SECONDS,
} from '../../../../../src/lib/session';

export const runtime = "nodejs";

export async function POST(req: Request) {
  const prisma = getPrisma();
  const action = 'auth.login';

  try {
    await rateLimitOrThrow({ key: 'auth_login', limitPerMin: 5, req });

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      const response = NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
      await logAuditEvent({
        prisma,
        req,
        action,
        statusCode: 400,
        success: false,
        metadata: { reason: 'invalid_json' },
      });
      return response;
    }

    const email =
      body && typeof (body as { email?: unknown }).email === 'string'
        ? (body as { email: string }).email.trim().toLowerCase()
        : '';
    const password =
      body && typeof (body as { password?: unknown }).password === 'string'
        ? (body as { password: string }).password
        : '';

    if (!email || !password) {
      const response = NextResponse.json(
        { error: 'Email and password required' },
        { status: 400 },
      );
      await logAuditEvent({
        prisma,
        req,
        action,
        statusCode: 400,
        success: false,
        actor: { email: email || null },
        metadata: { reason: 'missing_credentials' },
      });
      return response;
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) {
      const response = NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
      await logAuditEvent({
        prisma,
        req,
        action,
        statusCode: 401,
        success: false,
        actor: { email },
        metadata: { reason: 'invalid_credentials' },
      });
      return response;
    }

    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) {
      const response = NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
      await logAuditEvent({
        prisma,
        req,
        action,
        statusCode: 401,
        success: false,
        actor: { email },
        metadata: { reason: 'invalid_credentials' },
      });
      return response;
    }

    const token = createSessionToken();
    const tokenHash = hashSessionToken(token);
    const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);

    await prisma.session.create({
      data: {
        tokenHash,
        userId: user.id,
        expiresAt,
      },
    });

    const response = NextResponse.json({ success: true, email: user.email });
    response.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: shouldUseSecureSessionCookie(req),
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
    });

    await logAuditEvent({
      prisma,
      req,
      action,
      statusCode: 200,
      success: true,
      actor: {
        type: AuditActorType.USER,
        userId: user.id,
        email: user.email,
      },
      resource: 'session',
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
        action,
        statusCode: error.status,
        success: false,
        metadata: { reason: 'rate_limited' },
      });
      return response;
    }

    if (error instanceof Error) {
      const response = NextResponse.json({ error: error.message }, { status: 400 });
      await logAuditEvent({
        prisma,
        req,
        action,
        statusCode: 400,
        success: false,
        metadata: { reason: 'error', message: error.message },
      });
      return response;
    }

    const response = NextResponse.json({ error: 'Unknown error' }, { status: 500 });
    await logAuditEvent({
      prisma,
      req,
      action,
      statusCode: 500,
      success: false,
      metadata: { reason: 'unknown_error' },
    });
    return response;
  }
}
