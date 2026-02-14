import { NextResponse } from 'next/server';

import { getPrisma } from '../../../../../src/db/prisma';
import { logAuditEvent } from '../../../../../src/lib/auditLog';
import {
  getCookieValue,
  hashSessionToken,
  SESSION_COOKIE_NAME,
  shouldUseSecureSessionCookie,
} from '../../../../../src/lib/session';

export const runtime = "nodejs";

export async function POST(req: Request) {
  const prisma = getPrisma();
  const action = 'auth.logout';
  const sessionToken = getCookieValue(req, SESSION_COOKIE_NAME);
  let access = null;

  if (sessionToken) {
    const tokenHash = hashSessionToken(sessionToken);
    const session = await prisma.session.findFirst({
      where: { tokenHash },
      include: { user: true },
    });
    if (session?.user) {
      access = {
        email: session.user.email,
        source: 'session' as const,
        userId: session.user.id,
      };
    }
    await prisma.session.deleteMany({ where: { tokenHash } });
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: shouldUseSecureSessionCookie(req),
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });

  if (access) {
    await logAuditEvent({
      prisma,
      req,
      access,
      action,
      statusCode: 200,
      success: true,
      resource: 'session',
    });
  }

  return response;
}
