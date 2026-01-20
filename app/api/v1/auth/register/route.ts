import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';

import { AuditActorType } from '@prisma/client';

import { getPrisma } from '../../../../../src/db/prisma';
import { logAuditEvent } from '../../../../../src/lib/auditLog';
import { parseRegisterBody } from '../../../../../src/lib/authRegister';
import { rateLimitOrThrow, RateLimitError } from '../../../../../src/lib/rateLimit';
import {
  createSessionToken,
  hashSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
} from '../../../../../src/lib/session';

export const runtime = "nodejs";

function getRequestIp(req: Request): string | null {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0]?.trim() || null;
  }
  return req.headers.get('x-real-ip');
}

export async function POST(req: Request) {
  const prisma = getPrisma();
  const action = 'auth.register';

  try {
    await rateLimitOrThrow({ key: 'auth_register', limitPerMin: 5, req });

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

    const parsed = parseRegisterBody(body);
    if (!parsed.ok) {
      const response = NextResponse.json({ error: parsed.error }, { status: 400 });
      await logAuditEvent({
        prisma,
        req,
        action,
        statusCode: 400,
        success: false,
        metadata: { reason: 'invalid_body', message: parsed.error },
      });
      return response;
    }

    const { email, password, fullName, lawFirm, marketingConsent } = parsed.data;
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      const response = NextResponse.json(
        { error: 'Email is already registered.' },
        { status: 409 },
      );
      await logAuditEvent({
        prisma,
        req,
        action,
        statusCode: 409,
        success: false,
        actor: { email },
        metadata: { reason: 'email_exists' },
      });
      return response;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const now = new Date();
    const agreedIp = getRequestIp(req);

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        fullName,
        lawFirm,
        isAttorneyConfirmed: true,
        marketingConsent,
        agreedAt: now,
        agreedIp,
        marketingConsentAt: marketingConsent ? now : null,
        marketingConsentIp: marketingConsent ? agreedIp : null,
        isActive: true,
      },
    });

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

    const response = NextResponse.json({
      success: true,
      email: user.email,
      fullName: user.fullName,
      lawFirm: user.lawFirm,
      marketingConsent: user.marketingConsent,
    });
    response.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
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
      resource: 'user',
      resourceId: user.id,
      metadata: { marketingConsent },
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
