import type { PrismaClient } from '@prisma/client';

export type AuditFilterConfig = {
  ignoreUserAgents: string[];
  ignoreActions: string[];
};

const DEFAULT_IGNORE_ACTIONS = ['admin.*'];
const DEFAULT_IGNORE_USER_AGENTS: string[] = [];
const SETTINGS_KEY = 'audit_filters';
const CACHE_TTL_MS = 60_000;

let cache: { fetchedAt: number; value: AuditFilterConfig } | null = null;

function parseCsv(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((entry) => (typeof entry === 'string' ? entry.trim().toLowerCase() : ''))
    .filter(Boolean);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function getDefaultAuditFilterConfig(): AuditFilterConfig {
  return {
    ignoreUserAgents: DEFAULT_IGNORE_USER_AGENTS,
    ignoreActions: DEFAULT_IGNORE_ACTIONS,
  };
}

function normalizeConfig(raw: unknown): AuditFilterConfig {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const ignoreUserAgents = normalizeList(
    (value as { ignoreUserAgents?: unknown }).ignoreUserAgents,
  );
  const ignoreActions = normalizeList((value as { ignoreActions?: unknown }).ignoreActions);
  return {
    ignoreUserAgents,
    ignoreActions,
  };
}

export function getEnvAuditFilterConfig(): AuditFilterConfig {
  return {
    ignoreUserAgents: parseCsv(process.env.AUDIT_LOG_IGNORE_USER_AGENTS),
    ignoreActions: parseCsv(process.env.AUDIT_LOG_IGNORE_ACTIONS),
  };
}

function mergeWithEnv(config: AuditFilterConfig): AuditFilterConfig {
  const defaults = getDefaultAuditFilterConfig();
  const env = getEnvAuditFilterConfig();
  return {
    ignoreUserAgents: unique([
      ...defaults.ignoreUserAgents,
      ...env.ignoreUserAgents,
      ...config.ignoreUserAgents,
    ]),
    ignoreActions: unique([
      ...defaults.ignoreActions,
      ...env.ignoreActions,
      ...config.ignoreActions,
    ]),
  };
}

export async function getStoredAuditFilterConfig(
  prisma: PrismaClient,
): Promise<AuditFilterConfig> {
  const setting = await prisma.adminSetting.findUnique({
    where: { key: SETTINGS_KEY },
  });
  return setting ? normalizeConfig(setting.value) : { ignoreUserAgents: [], ignoreActions: [] };
}

export async function getAuditFilterConfig(
  prisma: PrismaClient,
  options: { bypassCache?: boolean } = {},
): Promise<AuditFilterConfig> {
  if (!options.bypassCache && cache) {
    if (Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
      return cache.value;
    }
  }

  const baseConfig = await getStoredAuditFilterConfig(prisma);
  const merged = mergeWithEnv(baseConfig);
  cache = { fetchedAt: Date.now(), value: merged };
  return merged;
}

export async function setAuditFilterConfig(
  prisma: PrismaClient,
  config: AuditFilterConfig,
): Promise<AuditFilterConfig> {
  const normalized = {
    ignoreUserAgents: unique(normalizeList(config.ignoreUserAgents)),
    ignoreActions: unique(normalizeList(config.ignoreActions)),
  };

  const stored = await prisma.adminSetting.upsert({
    where: { key: SETTINGS_KEY },
    update: { value: normalized },
    create: { key: SETTINGS_KEY, value: normalized },
  });

  const merged = mergeWithEnv(normalizeConfig(stored.value));
  cache = { fetchedAt: Date.now(), value: merged };
  return merged;
}
