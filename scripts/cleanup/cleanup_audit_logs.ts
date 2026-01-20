import { getPrisma } from '../../src/db/prisma';

const DEFAULT_TTL_DAYS = 180;

function parseTtlDays(raw: string | undefined): number {
  if (!raw) return DEFAULT_TTL_DAYS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_TTL_DAYS;
  return Math.max(1, Math.floor(parsed));
}

async function main() {
  const prisma = getPrisma();
  const ttlDays = parseTtlDays(process.env.AUDIT_LOG_TTL_DAYS);
  const cutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000);

  const result = await prisma.auditLog.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });

  console.log(
    JSON.stringify({
      task: 'cleanup_audit_logs',
      deleted: result.count,
      ttl_days: ttlDays,
      cutoff: cutoff.toISOString(),
    }),
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`cleanup_audit_logs failed: ${message}`);
  process.exit(1);
});
