import { randomUUID } from 'crypto';
import { AuditActorType, type Prisma, type PrismaClient } from '@prisma/client';

import type { AccessContext } from './access';
import { getAuditFilterConfig } from './auditFilters';

type AuditActorOverride = {
  type?: AuditActorType;
  userId?: string | null;
  accessUserId?: string | null;
  email?: string | null;
};

type AuditLogInput = {
  prisma: PrismaClient;
  req: Request;
  action: string;
  statusCode: number;
  success: boolean;
  access?: AccessContext | null;
  resource?: string | null;
  resourceId?: string | null;
  metadata?: Prisma.InputJsonValue;
  actor?: AuditActorOverride;
};

function getRequestPath(req: Request): string {
  try {
    return new URL(req.url).pathname;
  } catch {
    return req.url;
  }
}

function getRequestId(req: Request): string {
  const requestId = req.headers.get('x-request-id') ?? req.headers.get('x-vercel-id');
  return requestId ?? randomUUID();
}

function matchesAction(action: string, pattern: string): boolean {
  if (!pattern) return false;
  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1);
    return action.startsWith(prefix);
  }
  return action === pattern;
}

function getClientIp(req: Request): string | null {
  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim();
    if (first) return first;
  }

  return (
    req.headers.get('x-real-ip') ??
    req.headers.get('cf-connecting-ip') ??
    null
  );
}

function resolveActor(access?: AccessContext | null, override?: AuditActorOverride) {
  let actorType: AuditActorType = AuditActorType.UNKNOWN;
  let actorUserId: string | null = null;
  let actorAccessUserId: string | null = null;
  let actorEmail: string | null = null;

  if (access) {
    actorEmail = access.email ?? null;
    if (access.source === 'session') {
      actorType = AuditActorType.USER;
      actorUserId = access.userId ?? null;
    } else if (access.source === 'api_key') {
      actorType = AuditActorType.ACCESS_USER;
      actorAccessUserId = access.accessUserId ?? null;
    } else if (access.source === 'public') {
      actorType = AuditActorType.PUBLIC;
    }
  }

  if (override) {
    if (override.type) actorType = override.type;
    if (override.userId !== undefined) actorUserId = override.userId;
    if (override.accessUserId !== undefined) actorAccessUserId = override.accessUserId;
    if (override.email !== undefined) actorEmail = override.email;
  }

  return { actorType, actorUserId, actorAccessUserId, actorEmail };
}

export async function logAuditEvent({
  prisma,
  req,
  access,
  action,
  resource,
  resourceId,
  statusCode,
  success,
  metadata,
  actor,
}: AuditLogInput) {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  const { actorType, actorUserId, actorAccessUserId, actorEmail } = resolveActor(access, actor);
  const userAgent = req.headers.get('user-agent');
  try {
    const config = await getAuditFilterConfig(prisma);
    const normalizedAction = action.toLowerCase();
    const normalizedUserAgent = userAgent?.toLowerCase() ?? null;
    if (normalizedUserAgent) {
      const ignoredAgent = config.ignoreUserAgents.some((entry) =>
        normalizedUserAgent.includes(entry),
      );
      if (ignoredAgent) return;
    }
    if (config.ignoreActions.length > 0) {
      const ignoredAction = config.ignoreActions.some((entry) =>
        matchesAction(normalizedAction, entry),
      );
      if (ignoredAction) return;
    }
  } catch {
    // If settings lookup fails, proceed with logging.
  }

  try {
    await prisma.auditLog.create({
      data: {
        actorType,
        actorUserId,
        actorAccessUserId,
        actorEmail,
        action,
        resource: resource ?? null,
        resourceId: resourceId ?? null,
        method: req.method,
        path: getRequestPath(req),
        statusCode,
        success,
        ipAddress: getClientIp(req),
        userAgent,
        requestId: getRequestId(req),
        metadata: metadata ?? undefined,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`audit_log_failed: ${message}`);
  }
}
