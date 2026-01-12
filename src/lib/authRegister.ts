export interface RegisterInput {
  email: string;
  password: string;
  confirmPassword: string;
  fullName: string;
  lawFirm: string;
  agreeToAttorney: boolean;
  marketingConsent: boolean;
}

export type RegisterParseResult =
  | { ok: true; data: RegisterInput }
  | { ok: false; error: string };

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === 'yes' || normalized === 'on';
  }
  return false;
}

function isValidEmail(email: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

export function parseRegisterBody(body: unknown): RegisterParseResult {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Invalid JSON body' };
  }

  const payload = body as Record<string, unknown>;
  const email = readString(payload.email).toLowerCase();
  const password = readString(payload.password);
  const confirmPassword = readString(payload.confirmPassword);
  const fullName = readString(payload.fullName);
  const lawFirm = readString(payload.lawFirm);
  const agreeToAttorney = readBoolean(payload.agreeToAttorney);
  const marketingConsent = readBoolean(payload.marketingConsent);

  if (!email || !password || !confirmPassword || !fullName || !lawFirm) {
    return { ok: false, error: 'All required fields must be provided.' };
  }

  if (!isValidEmail(email)) {
    return { ok: false, error: 'Email format is invalid.' };
  }

  if (password !== confirmPassword) {
    return { ok: false, error: 'Passwords do not match.' };
  }

  if (!agreeToAttorney) {
    return { ok: false, error: 'You must confirm you are a licensed attorney or professional.' };
  }

  return {
    ok: true,
    data: {
      email,
      password,
      confirmPassword,
      fullName,
      lawFirm,
      agreeToAttorney,
      marketingConsent,
    },
  };
}
