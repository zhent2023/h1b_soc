import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';

import { getPrisma } from '../../../../../src/db/prisma';
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

  try {
    await rateLimitOrThrow({ key: 'auth_register', limitPerMin: 5, req });

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = parseRegisterBody(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const { email, password, fullName, lawFirm, marketingConsent } = parsed.data;
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: 'Email is already registered.' }, { status: 409 });
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

    return response;
  } catch (error) {
    if (error instanceof RateLimitError) {
      return NextResponse.json(
        { error: 'Rate limit exceeded' },
        { status: error.status, headers: error.headers },
      );
    }

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ error: 'Unknown error' }, { status: 500 });
  }
}
