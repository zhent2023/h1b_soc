/**
 * Prisma Client's binary query engine relies on an INFO startup log line from
 * `query_engine::server` to discover the random port it bound to.
 *
 * If a developer has `RUST_LOG=warn` (or stricter) set globally, that INFO log
 * is suppressed and Prisma calls can hang waiting for the engine to start.
 *
 * This helper makes sure the startup log is emitted without forcing verbose
 * logging for the whole engine.
 */
export function ensurePrismaEngineStartupLogs(): void {
  const current = process.env.RUST_LOG;
  if (!current) return;

  const directive = 'query_engine::server=info';

  if (!current.includes('query_engine::server')) {
    process.env.RUST_LOG = `${current},${directive}`;
    return;
  }

  // If the user already opted into INFO (or more verbose) for this target, keep it.
  // If it is WARN/ERROR/OFF, lift it to INFO so Prisma can detect the bound port.
  const normalized = current.replace(
    /query_engine::server=(trace|debug|info|warn|error|off)/gi,
    (match, level) => {
      const lvl = String(level).toLowerCase();
      if (lvl === 'warn' || lvl === 'error' || lvl === 'off') {
        return directive;
      }
      return match;
    },
  );

  if (!normalized.includes(directive)) {
    process.env.RUST_LOG = `${normalized},${directive}`;
    return;
  }

  process.env.RUST_LOG = normalized;
}

