import type { PrismaClient } from '@prisma/client';

import { AccessError, type AccessContext } from './access';
import { getCookieValue, hashSessionToken, SESSION_COOKIE_NAME } from './session';

function parseAdminEmails(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

function isAdminEmail(email: string, rawAdminEmails: string | undefined): boolean {
  const adminEmails = parseAdminEmails(rawAdminEmails);
  if (adminEmails.size === 0) {
    return false;
  }
  return adminEmails.has(email.trim().toLowerCase());
}

export async function requireAdmin(
  req: Request,
  prisma: PrismaClient,
): Promise<AccessContext> {
  const sessionToken = getCookieValue(req, SESSION_COOKIE_NAME);
  if (!sessionToken) {
    throw new AccessError('Login required', 401);
  }

  const tokenHash = hashSessionToken(sessionToken);
  const session = await prisma.session.findFirst({
    where: {
      tokenHash,
      expiresAt: { gt: new Date() },
      user: { isActive: true },
    },
    include: { user: true },
  });

  if (!session?.user) {
    throw new AccessError('Login required', 401);
  }

  const access: AccessContext = {
    email: session.user.email,
    source: 'session',
    userId: session.user.id,
  };

  if (!isAdminEmail(access.email, process.env.ADMIN_EMAILS)) {
    throw new AccessError('Admin access required', 403);
  }

  return access;
}
