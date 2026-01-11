import bcrypt from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';

export interface AccessContext {
  email: string;
}

export class AccessError extends Error {
  status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

function getHeader(req: Request, name: string): string | null {
  return req.headers.get(name);
}

export async function requireAccess(
  req: Request,
  prisma: PrismaClient,
): Promise<AccessContext> {
  const accessMode = process.env.ACCESS_MODE ?? 'invite';
  if (accessMode === 'public') {
    return { email: 'public' };
  }

  const emailHeader = process.env.ACCESS_EMAIL_HEADER ?? 'x-access-email';
  const tokenHeader = process.env.ACCESS_TOKEN_HEADER ?? 'x-access-key';

  const emailRaw = getHeader(req, emailHeader);
  const accessKey = getHeader(req, tokenHeader);

  if (!emailRaw || !accessKey) {
    throw new AccessError('Missing access headers', 401);
  }

  const email = emailRaw.trim().toLowerCase();
  const accessUser = await prisma.accessUser.findFirst({
    where: { email, isActive: true },
  });

  if (!accessUser) {
    throw new AccessError('Access denied', 403);
  }

  const matches = await bcrypt.compare(accessKey, accessUser.keyHash);
  if (!matches) {
    throw new AccessError('Access denied', 403);
  }

  return { email: accessUser.email };
}
