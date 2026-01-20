'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import styles from './page.module.css';

type AuditLogEntry = {
  id: string;
  actorType: string;
  actorEmail: string | null;
  action: string;
  resource: string | null;
  resourceId: string | null;
  method: string;
  path: string;
  statusCode: number;
  success: boolean;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

type AuditLogResponse = {
  items: AuditLogEntry[];
  nextCursor: string | null;
};

type Filters = {
  actorEmail: string;
  action: string;
  resource: string;
  resourceId: string;
  method: string;
  path: string;
  success: 'all' | 'true' | 'false';
  statusCode: string;
  from: string;
  to: string;
  limit: string;
};

const DEFAULT_LIMIT = '50';

const defaultFilters: Filters = {
  actorEmail: '',
  action: '',
  resource: '',
  resourceId: '',
  method: '',
  path: '',
  success: 'all',
  statusCode: '',
  from: '',
  to: '',
  limit: DEFAULT_LIMIT,
};

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatMetadata(value: Record<string, unknown> | null): string {
  if (!value) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function toIsoString(value: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export default function AuditAdminPage() {
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [applied, setApplied] = useState<Filters>(defaultFilters);
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [cleanupState, setCleanupState] = useState<{
    running: boolean;
    message: string | null;
  }>({ running: false, message: null });

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set('limit', applied.limit || DEFAULT_LIMIT);
    if (applied.actorEmail) params.set('actorEmail', applied.actorEmail);
    if (applied.action) params.set('action', applied.action);
    if (applied.resource) params.set('resource', applied.resource);
    if (applied.resourceId) params.set('resourceId', applied.resourceId);
    if (applied.method) params.set('method', applied.method);
    if (applied.path) params.set('path', applied.path);
    if (applied.success !== 'all') params.set('success', applied.success);
    if (applied.statusCode) params.set('statusCode', applied.statusCode);
    const fromIso = toIsoString(applied.from);
    const toIso = toIsoString(applied.to);
    if (fromIso) params.set('from', fromIso);
    if (toIso) params.set('to', toIso);
    return params.toString();
  }, [applied]);

  const fetchLogs = useCallback(
    async (cursor: string | null, append: boolean) => {
      setLoading(true);
      setError(null);
      setBlocked(false);
      try {
        const query = cursor ? `${queryString}&cursor=${cursor}` : queryString;
        const response = await fetch(`/api/v1/admin/audit-logs?${query}`, {
          credentials: 'include',
        });
        if (response.status === 401 || response.status === 403) {
          setBlocked(true);
          setLogs([]);
          setNextCursor(null);
          return;
        }
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error || 'Failed to load audit logs');
        }
        const data = (await response.json()) as AuditLogResponse;
        setLogs((prev) => (append ? [...prev, ...data.items] : data.items));
        setNextCursor(data.nextCursor ?? null);
      } catch (fetchError) {
        const message = fetchError instanceof Error ? fetchError.message : String(fetchError);
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [queryString],
  );

  useEffect(() => {
    void fetchLogs(null, false);
  }, [fetchLogs]);

  const handleApply = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setApplied({ ...filters });
  };

  const handleReset = () => {
    setFilters(defaultFilters);
    setApplied(defaultFilters);
  };

  const handleCleanup = async () => {
    if (!confirm('Delete audit logs older than the retention window?')) return;
    setCleanupState({ running: true, message: null });
    try {
      const response = await fetch('/api/v1/admin/audit-logs/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      if (response.status === 401 || response.status === 403) {
        setCleanupState({
          running: false,
          message: 'Admin access required to run cleanup.',
        });
        return;
      }
      const payload = (await response.json().catch(() => ({}))) as {
        deleted?: number;
        ttlDays?: number;
        cutoff?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || 'Cleanup failed');
      }
      const deleted = payload.deleted ?? 0;
      const ttlDays = payload.ttlDays ?? 0;
      setCleanupState({
        running: false,
        message: `Deleted ${deleted} logs older than ${ttlDays} days.`,
      });
      void fetchLogs(null, false);
    } catch (cleanupError) {
      const message =
        cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      setCleanupState({ running: false, message });
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerCard}>
          <div>
            <p className={styles.kicker}>Admin Console</p>
            <h1 className={styles.title}>Audit Logs</h1>
            <p className={styles.subtitle}>
              Review per-account operations, API activity, and system changes.
            </p>
          </div>
          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.cleanupButton}
              onClick={handleCleanup}
              disabled={cleanupState.running}
            >
              {cleanupState.running ? 'Cleaning...' : 'Run Cleanup'}
            </button>
            {cleanupState.message ? (
              <p className={styles.cleanupMessage}>{cleanupState.message}</p>
            ) : null}
          </div>
        </div>
      </header>

      <section className={styles.panel}>
        <form className={styles.filters} onSubmit={handleApply}>
          <label className={styles.field}>
            <span>Actor Email</span>
            <input
              value={filters.actorEmail}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, actorEmail: event.target.value }))
              }
              placeholder="user@domain.com"
            />
          </label>
          <label className={styles.field}>
            <span>Action</span>
            <input
              value={filters.action}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, action: event.target.value }))
              }
              placeholder="transcript.create"
            />
          </label>
          <label className={styles.field}>
            <span>Resource</span>
            <input
              value={filters.resource}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, resource: event.target.value }))
              }
              placeholder="transcript"
            />
          </label>
          <label className={styles.field}>
            <span>Resource ID</span>
            <input
              value={filters.resourceId}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, resourceId: event.target.value }))
              }
              placeholder="UUID"
            />
          </label>
          <label className={styles.field}>
            <span>Method</span>
            <input
              value={filters.method}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, method: event.target.value.toUpperCase() }))
              }
              placeholder="POST"
            />
          </label>
          <label className={styles.field}>
            <span>Path</span>
            <input
              value={filters.path}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, path: event.target.value }))
              }
              placeholder="/api/v1/..."
            />
          </label>
          <label className={styles.field}>
            <span>Status Code</span>
            <input
              value={filters.statusCode}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, statusCode: event.target.value }))
              }
              inputMode="numeric"
              placeholder="200"
            />
          </label>
          <label className={styles.field}>
            <span>Success</span>
            <select
              value={filters.success}
              onChange={(event) =>
                setFilters((prev) => ({
                  ...prev,
                  success: event.target.value as Filters['success'],
                }))
              }
            >
              <option value="all">All</option>
              <option value="true">Success</option>
              <option value="false">Failure</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>From</span>
            <input
              type="datetime-local"
              value={filters.from}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, from: event.target.value }))
              }
            />
          </label>
          <label className={styles.field}>
            <span>To</span>
            <input
              type="datetime-local"
              value={filters.to}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, to: event.target.value }))
              }
            />
          </label>
          <label className={styles.field}>
            <span>Limit</span>
            <input
              value={filters.limit}
              onChange={(event) =>
                setFilters((prev) => ({ ...prev, limit: event.target.value }))
              }
              inputMode="numeric"
              placeholder={DEFAULT_LIMIT}
            />
          </label>
          <div className={styles.actions}>
            <button type="submit" className={styles.primaryButton} disabled={loading}>
              {loading ? 'Loading...' : 'Apply Filters'}
            </button>
            <button type="button" className={styles.secondaryButton} onClick={handleReset}>
              Reset
            </button>
          </div>
        </form>
      </section>

      <section className={styles.panel}>
        {blocked ? (
          <div className={styles.notice}>
            <h2>Admin access required</h2>
            <p>Please sign in with an admin account to view audit logs.</p>
            <a className={styles.link} href="/login">
              Go to login
            </a>
          </div>
        ) : error ? (
          <div className={styles.notice}>
            <h2>Unable to load audit logs</h2>
            <p>{error}</p>
          </div>
        ) : logs.length === 0 ? (
          <div className={styles.notice}>
            <h2>No results</h2>
            <p>Adjust filters or expand the time range.</p>
          </div>
        ) : (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Actor</th>
                    <th>Action</th>
                    <th>Resource</th>
                    <th>Status</th>
                    <th>Path</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id}>
                      <td className={styles.mono}>{formatTimestamp(log.createdAt)}</td>
                      <td>
                        <div className={styles.actor}>
                          <span className={styles.actorType}>{log.actorType}</span>
                          <span className={styles.actorEmail}>
                            {log.actorEmail || '-'}
                          </span>
                        </div>
                      </td>
                      <td className={styles.mono}>{log.action}</td>
                      <td className={styles.mono}>
                        {log.resource || '-'}
                        {log.resourceId ? `:${log.resourceId}` : ''}
                      </td>
                      <td>
                        <span
                          className={
                            log.success ? styles.statusOk : styles.statusFail
                          }
                        >
                          {log.statusCode}
                        </span>
                      </td>
                      <td className={styles.mono}>
                        {log.method} {log.path}
                      </td>
                      <td>
                        <details className={styles.details}>
                          <summary>View</summary>
                          <div className={styles.detailsBody}>
                            <p>
                              <strong>Request ID:</strong>{' '}
                              <span className={styles.mono}>
                                {log.requestId || '-'}
                              </span>
                            </p>
                            <p>
                              <strong>IP:</strong>{' '}
                              <span className={styles.mono}>
                                {log.ipAddress || '-'}
                              </span>
                            </p>
                            <p>
                              <strong>User Agent:</strong>{' '}
                              <span className={styles.mono}>
                                {log.userAgent || '-'}
                              </span>
                            </p>
                            {log.metadata ? (
                              <pre className={styles.meta}>
                                {formatMetadata(log.metadata)}
                              </pre>
                            ) : null}
                          </div>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={styles.loadMore}>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={!nextCursor || loading}
                onClick={() => fetchLogs(nextCursor, true)}
              >
                {nextCursor ? (loading ? 'Loading...' : 'Load More') : 'No more'}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
