import crypto from 'crypto';

export const SESSION_COOKIE_NAME = 'h1b_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

function isLocalhostHost(hostHeader: string | null): boolean {
  if (!hostHeader) return false;
  const trimmed = hostHeader.trim().toLowerCase();
  if (!trimmed) return false;

  // Strip port and IPv6 brackets.
  const withoutPort = trimmed.replace(/:\d+$/, '');
  const host = withoutPort.replace(/^\[/, '').replace(/\]$/, '');

  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

export function shouldUseSecureSessionCookie(req: Request): boolean {
  // Allow opting out for local troubleshooting / non-HTTPS environments.
  if (process.env.SESSION_COOKIE_SECURE === 'false') return false;

  if (process.env.NODE_ENV !== 'production') return false;

  // In production, require HTTPS cookies everywhere except localhost,
  // so CI smoke tests against http://127.0.0.1 can still authenticate.
  if (isLocalhostHost(req.headers.get('host'))) return false;

  return true;
}

export function createSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function getCookieValue(req: Request, name: string): string | null {
  const header = req.headers.get('cookie');
  if (!header) {
    return null;
  }

  const parts = header.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }
    const key = trimmed.slice(0, eqIndex);
    if (key !== name) {
      continue;
    }
    const raw = trimmed.slice(eqIndex + 1);
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }

  return null;
}
