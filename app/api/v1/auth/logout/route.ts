import { NextResponse } from 'next/server';

import { getPrisma } from '../../../../../src/db/prisma';
import { getCookieValue, hashSessionToken, SESSION_COOKIE_NAME } from '../../../../../src/lib/session';

export const runtime = "nodejs";

export async function POST(req: Request) {
  const prisma = getPrisma();
  const sessionToken = getCookieValue(req, SESSION_COOKIE_NAME);

  if (sessionToken) {
    const tokenHash = hashSessionToken(sessionToken);
    await prisma.session.deleteMany({ where: { tokenHash } });
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });

  return response;
}
