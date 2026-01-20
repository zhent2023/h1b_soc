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

type AuditInsights = {
  range: {
    from: string;
    to: string;
  };
  summary: {
    total: number;
    success: number;
    failure: number;
    successRate: number;
    uniqueActors: number;
    unknownActors: number;
    status401: number;
    status403: number;
  };
  statusBuckets: {
    success2xx: number;
    redirect3xx: number;
    client4xx: number;
    server5xx: number;
  };
  daily: Array<{
    date: string;
    total: number;
    success: number;
    failure: number;
  }>;
  topActions: Array<{ action: string; total: number; failure: number }>;
  topPaths: Array<{ method: string; path: string; total: number; failure: number }>;
  topActors: Array<{ actor: string; total: number }>;
};

type AuditFilterConfig = {
  stored: {
    ignoreUserAgents: string[];
    ignoreActions: string[];
  };
  env: {
    ignoreUserAgents: string[];
    ignoreActions: string[];
  };
  effective: {
    ignoreUserAgents: string[];
    ignoreActions: string[];
  };
};

type Filters = {
  actorEmail: string;
  action: string;
  excludeActions: string;
  resource: string;
  resourceId: string;
  method: string;
  path: string;
  userAgent: string;
  excludeUserAgent: string;
  includeIgnored: boolean;
  success: 'all' | 'true' | 'false';
  statusCode: string;
  from: string;
  to: string;
  limit: string;
};

const DEFAULT_LIMIT = '50';
const FILTER_STORAGE_KEY = 'adminAuditFilters';

const defaultFilters: Filters = {
  actorEmail: '',
  action: '',
  excludeActions: 'admin.audit_logs.list',
  resource: '',
  resourceId: '',
  method: '',
  path: '',
  userAgent: '',
  excludeUserAgent: '',
  includeIgnored: false,
  success: 'all',
  statusCode: '',
  from: '',
  to: '',
  limit: DEFAULT_LIMIT,
};

const numberFormatter = new Intl.NumberFormat();

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '0%';
  const clamped = Math.min(Math.max(value, 0), 1);
  return `${(clamped * 100).toFixed(1)}%`;
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

function formatDateRange(from: string, to: string): string {
  const start = new Date(from);
  const end = new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return `${from} - ${to}`;
  }
  const startLabel = start.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const endLabel = end.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return `${startLabel} - ${endLabel}`;
}

function formatDayLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function parseListInput(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function formatListInput(values: string[]): string {
  return values.join('\n');
}

export default function AuditAdminPage() {
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [applied, setApplied] = useState<Filters>(defaultFilters);
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [insights, setInsights] = useState<AuditInsights | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [config, setConfig] = useState<AuditFilterConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [configMessage, setConfigMessage] = useState<string | null>(null);
  const [configForm, setConfigForm] = useState({
    ignoreUserAgents: '',
    ignoreActions: '',
  });
  const [deleteState, setDeleteState] = useState<{
    running: boolean;
    message: string | null;
  }>({ running: false, message: null });
  const [cleanupState, setCleanupState] = useState<{
    running: boolean;
    message: string | null;
  }>({ running: false, message: null });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = window.localStorage.getItem(FILTER_STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Partial<Filters>;
      const nextFilters = { ...defaultFilters, ...parsed };
      setFilters(nextFilters);
      setApplied(nextFilters);
    } catch {
      window.localStorage.removeItem(FILTER_STORAGE_KEY);
    }
  }, []);

  const loadConfig = useCallback(async () => {
    setConfigLoading(true);
    setConfigError(null);
    setConfigMessage(null);
    try {
      const response = await fetch('/api/v1/admin/audit-logs/config', {
        credentials: 'include',
      });
      if (response.status === 401 || response.status === 403) {
        setBlocked(true);
        setConfig(null);
        return;
      }
      const payload = (await response.json().catch(() => ({}))) as
        | AuditFilterConfig
        | { error?: string };
      if (!response.ok) {
        throw new Error(
          ('error' in payload && payload.error) || 'Failed to load audit filters',
        );
      }
      const data = payload as AuditFilterConfig;
      setConfig(data);
      setConfigForm({
        ignoreUserAgents: formatListInput(data.stored.ignoreUserAgents),
        ignoreActions: formatListInput(data.stored.ignoreActions),
      });
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : String(loadError);
      setConfigError(message);
    } finally {
      setConfigLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set('limit', applied.limit || DEFAULT_LIMIT);
    if (applied.actorEmail) params.set('actorEmail', applied.actorEmail);
    if (applied.action) params.set('action', applied.action);
    if (applied.excludeActions) params.set('excludeActions', applied.excludeActions);
    if (applied.resource) params.set('resource', applied.resource);
    if (applied.resourceId) params.set('resourceId', applied.resourceId);
    if (applied.method) params.set('method', applied.method);
    if (applied.path) params.set('path', applied.path);
    if (applied.userAgent) params.set('userAgent', applied.userAgent);
    if (applied.excludeUserAgent) params.set('excludeUserAgent', applied.excludeUserAgent);
    if (applied.includeIgnored) params.set('includeIgnored', 'true');
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

  const fetchInsights = useCallback(async () => {
    if (blocked) {
      setInsights(null);
      return;
    }
    setInsightsLoading(true);
    setInsightsError(null);
    try {
      const response = await fetch(`/api/v1/admin/audit-logs/insights?${queryString}`, {
        credentials: 'include',
      });
      if (response.status === 401 || response.status === 403) {
        setBlocked(true);
        setInsights(null);
        return;
      }
      const payload = (await response.json().catch(() => ({}))) as
        | AuditInsights
        | { error?: string };
      if (!response.ok) {
        throw new Error(
          ('error' in payload && payload.error) || 'Failed to load insights',
        );
      }
      setInsights(payload as AuditInsights);
    } catch (fetchError) {
      const message = fetchError instanceof Error ? fetchError.message : String(fetchError);
      setInsightsError(message);
    } finally {
      setInsightsLoading(false);
    }
  }, [blocked, queryString]);

  useEffect(() => {
    void fetchInsights();
  }, [fetchInsights]);

  const hasPrimaryFilters = useMemo(
    () =>
      Boolean(
        applied.actorEmail ||
          applied.action ||
          applied.resource ||
          applied.resourceId ||
          applied.method ||
          applied.path ||
          applied.userAgent ||
          applied.statusCode ||
          applied.from ||
          applied.to ||
          applied.success !== 'all',
      ),
    [applied],
  );

  const handleApply = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = { ...filters };
    setApplied(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(next));
    }
  };

  const handleReset = () => {
    setFilters(defaultFilters);
    setApplied(defaultFilters);
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(FILTER_STORAGE_KEY);
    }
  };

  const handleDeleteMatching = async () => {
    const message = hasPrimaryFilters
      ? 'Delete audit logs matching the applied filters? This cannot be undone.'
      : 'No primary filters applied. This will delete a large set of audit logs. Continue?';
    if (!confirm(message)) return;
    setDeleteState({ running: true, message: null });
    try {
      const response = await fetch(`/api/v1/admin/audit-logs/delete?${queryString}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      if (response.status === 401 || response.status === 403) {
        setBlocked(true);
        setDeleteState({
          running: false,
          message: 'Admin access required to delete audit logs.',
        });
        return;
      }
      const payload = (await response.json().catch(() => ({}))) as {
        deleted?: number;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || 'Delete failed');
      }
      setDeleteState({
        running: false,
        message: `Deleted ${payload.deleted ?? 0} logs.`,
      });
      void fetchLogs(null, false);
      void fetchInsights();
    } catch (deleteError) {
      const message =
        deleteError instanceof Error ? deleteError.message : String(deleteError);
      setDeleteState({ running: false, message });
    }
  };

  const handleConfigSave = async () => {
    setConfigSaving(true);
    setConfigError(null);
    setConfigMessage(null);
    try {
      const payload = {
        ignoreUserAgents: parseListInput(configForm.ignoreUserAgents),
        ignoreActions: parseListInput(configForm.ignoreActions),
      };
      const response = await fetch('/api/v1/admin/audit-logs/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      if (response.status === 401 || response.status === 403) {
        setBlocked(true);
        setConfigMessage('Admin access required to save filters.');
        return;
      }
      const data = (await response.json().catch(() => ({}))) as
        | AuditFilterConfig
        | { error?: string };
      if (!response.ok) {
        throw new Error(('error' in data && data.error) || 'Failed to save filters');
      }
      const configResponse = data as AuditFilterConfig;
      setConfig(configResponse);
      setConfigForm({
        ignoreUserAgents: formatListInput(configResponse.stored.ignoreUserAgents),
        ignoreActions: formatListInput(configResponse.stored.ignoreActions),
      });
      setConfigMessage('Filters saved.');
      void fetchLogs(null, false);
      void fetchInsights();
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : String(saveError);
      setConfigError(message);
    } finally {
      setConfigSaving(false);
    }
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

  const insightsRange = insights
    ? formatDateRange(insights.range.from, insights.range.to)
    : '';
  const maxDailyTotal = insights?.daily.length
    ? Math.max(...insights.daily.map((entry) => entry.total))
    : 0;
  const totalAuthFailures = insights
    ? insights.summary.status401 + insights.summary.status403
    : 0;
  const totalErrors = insights
    ? insights.statusBuckets.client4xx + insights.statusBuckets.server5xx
    : 0;

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

      <div className={styles.layout}>
        <div className={styles.mainColumn}>
          <section className={styles.panel}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Filters</h2>
              <p className={styles.sectionSubtitle}>
                Focus the log feed and dashboards with targeted filters.
              </p>
            </div>
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
                <span>Exclude Actions</span>
                <input
                  value={filters.excludeActions}
                  onChange={(event) =>
                    setFilters((prev) => ({ ...prev, excludeActions: event.target.value }))
                  }
                  placeholder="admin.audit_logs.list, admin.audit_logs.*"
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
                    setFilters((prev) => ({
                      ...prev,
                      method: event.target.value.toUpperCase(),
                    }))
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
                <span>User Agent</span>
                <input
                  value={filters.userAgent}
                  onChange={(event) =>
                    setFilters((prev) => ({ ...prev, userAgent: event.target.value }))
                  }
                  placeholder="vercel-screenshot"
                />
              </label>
              <label className={styles.field}>
                <span>Exclude User Agents</span>
                <input
                  value={filters.excludeUserAgent}
                  onChange={(event) =>
                    setFilters((prev) => ({
                      ...prev,
                      excludeUserAgent: event.target.value,
                    }))
                  }
                  placeholder="vercel-screenshot,bot"
                />
              </label>
              <label className={styles.checkboxField}>
                <input
                  type="checkbox"
                  checked={filters.includeIgnored}
                  onChange={(event) =>
                    setFilters((prev) => ({
                      ...prev,
                      includeIgnored: event.target.checked,
                    }))
                  }
                />
                <span>Include ignored events</span>
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
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={handleReset}
                >
                  Reset
                </button>
                <button
                  type="button"
                  className={styles.dangerButton}
                  onClick={handleDeleteMatching}
                  disabled={deleteState.running}
                >
                  {deleteState.running ? 'Deleting...' : 'Delete Matching'}
                </button>
              </div>
              <p className={styles.configNote}>
                Delete uses the applied filters. Click Apply Filters first if you edited
                fields.
              </p>
              {deleteState.message ? (
                <p className={styles.actionMessage}>{deleteState.message}</p>
              ) : null}
            </form>
          </section>

          <section className={styles.panel}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Insights</h2>
              <p className={styles.sectionSubtitle}>
                {insightsRange
                  ? `Range: ${insightsRange}`
                  : 'Trends and summaries for selected filters. Defaults to the last 14 days.'}
              </p>
            </div>
            {blocked ? (
              <div className={styles.notice}>
                <h2>Admin access required</h2>
                <p>Please sign in with an admin account to view insights.</p>
                <a className={styles.link} href="/login">
                  Go to login
                </a>
              </div>
            ) : insightsError ? (
              <div className={styles.notice}>
                <h2>Unable to load insights</h2>
                <p>{insightsError}</p>
              </div>
            ) : insightsLoading && !insights ? (
              <div className={styles.notice}>
                <h2>Loading insights</h2>
                <p>Please wait while we calculate metrics.</p>
              </div>
            ) : !insights ? (
              <div className={styles.notice}>
                <h2>No data</h2>
                <p>Adjust filters or expand the time range.</p>
              </div>
            ) : (
              <>
                <div className={styles.insightsGrid}>
                  <div className={styles.statCard}>
                    <p className={styles.statLabel}>Total Events</p>
                    <p className={styles.statValue}>
                      {formatNumber(insights.summary.total)}
                    </p>
                    <p className={styles.statMeta}>
                      {formatNumber(insights.summary.success)} success /{' '}
                      {formatNumber(insights.summary.failure)} failed
                    </p>
                  </div>
                  <div className={styles.statCard}>
                    <p className={styles.statLabel}>Success Rate</p>
                    <p className={styles.statValue}>
                      {formatPercent(insights.summary.successRate)}
                    </p>
                    <p className={styles.statMeta}>
                      {formatNumber(insights.summary.success)} succeeded
                    </p>
                  </div>
                  <div className={styles.statCard}>
                    <p className={styles.statLabel}>Unique Actors</p>
                    <p className={styles.statValue}>
                      {formatNumber(insights.summary.uniqueActors)}
                    </p>
                    <p className={styles.statMeta}>
                      {formatNumber(insights.summary.unknownActors)} unknown
                    </p>
                  </div>
                  <div className={styles.statCard}>
                    <p className={styles.statLabel}>Auth Failures</p>
                    <p className={styles.statValue}>
                      {formatNumber(totalAuthFailures)}
                    </p>
                    <p className={styles.statMeta}>
                      401 {formatNumber(insights.summary.status401)} / 403{' '}
                      {formatNumber(insights.summary.status403)}
                    </p>
                  </div>
                  <div className={styles.statCard}>
                    <p className={styles.statLabel}>Errors (4xx + 5xx)</p>
                    <p className={styles.statValue}>{formatNumber(totalErrors)}</p>
                    <p className={styles.statMeta}>
                      4xx {formatNumber(insights.statusBuckets.client4xx)} / 5xx{' '}
                      {formatNumber(insights.statusBuckets.server5xx)}
                    </p>
                  </div>
                </div>

                <div className={styles.chartCard}>
                  <div className={styles.sectionHeader}>
                    <h3 className={styles.sectionTitle}>Daily Activity</h3>
                    <p className={styles.sectionSubtitle}>
                      Success vs failures per day.
                    </p>
                  </div>
                  {insights.daily.length === 0 ? (
                    <p className={styles.configNote}>No daily data available.</p>
                  ) : (
                    <div className={styles.chartWrap}>
                      <div className={styles.chartBars}>
                        {insights.daily.map((entry) => {
                          const totalHeight =
                            maxDailyTotal > 0
                              ? Math.max(
                                  entry.total ? 6 : 0,
                                  Math.round((entry.total / maxDailyTotal) * 100),
                                )
                              : 0;
                          const failureHeight = entry.total
                            ? Math.round((entry.failure / entry.total) * 100)
                            : 0;
                          return (
                            <div className={styles.chartBar} key={entry.date}>
                              <div className={styles.chartBarTrack}>
                                <div
                                  className={styles.chartBarFill}
                                  style={{ height: `${totalHeight}%` }}
                                >
                                  {entry.failure > 0 ? (
                                    <div
                                      className={styles.chartBarFailure}
                                      style={{ height: `${failureHeight}%` }}
                                    />
                                  ) : null}
                                </div>
                              </div>
                              <div className={styles.chartLabel}>
                                {formatDayLabel(entry.date)}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                <div className={styles.listGrid}>
                  <div className={styles.listCard}>
                    <h3>Top Actions</h3>
                    {insights.topActions.length === 0 ? (
                      <p className={styles.configNote}>No data available.</p>
                    ) : (
                      insights.topActions.map((entry) => (
                        <div className={styles.listItem} key={entry.action}>
                          <span className={styles.listName}>{entry.action}</span>
                          <span className={styles.listValue}>
                            {formatNumber(entry.total)}
                            {entry.failure
                              ? ` / ${formatNumber(entry.failure)} failed`
                              : ''}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                  <div className={styles.listCard}>
                    <h3>Top Paths</h3>
                    {insights.topPaths.length === 0 ? (
                      <p className={styles.configNote}>No data available.</p>
                    ) : (
                      insights.topPaths.map((entry) => (
                        <div
                          className={styles.listItem}
                          key={`${entry.method} ${entry.path}`}
                        >
                          <span className={styles.listName}>
                            {entry.method} {entry.path}
                          </span>
                          <span className={styles.listValue}>
                            {formatNumber(entry.total)}
                            {entry.failure
                              ? ` / ${formatNumber(entry.failure)} failed`
                              : ''}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                  <div className={styles.listCard}>
                    <h3>Top Actors</h3>
                    {insights.topActors.length === 0 ? (
                      <p className={styles.configNote}>No data available.</p>
                    ) : (
                      insights.topActors.map((entry) => (
                        <div className={styles.listItem} key={entry.actor}>
                          <span className={styles.listName}>{entry.actor}</span>
                          <span className={styles.listValue}>
                            {formatNumber(entry.total)}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                  <div className={styles.listCard}>
                    <h3>Status Buckets</h3>
                    {[
                      { label: '2xx Success', value: insights.statusBuckets.success2xx },
                      { label: '3xx Redirect', value: insights.statusBuckets.redirect3xx },
                      { label: '4xx Client', value: insights.statusBuckets.client4xx },
                      { label: '5xx Server', value: insights.statusBuckets.server5xx },
                    ].map((entry) => (
                      <div className={styles.listItem} key={entry.label}>
                        <span className={styles.listName}>{entry.label}</span>
                        <span className={styles.listValue}>
                          {formatNumber(entry.value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </section>

          <section className={styles.panel}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Audit Logs</h2>
              <p className={styles.sectionSubtitle}>
                Chronological feed of events matching the current filters.
              </p>
            </div>
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
                          <td className={styles.mono}>
                            {formatTimestamp(log.createdAt)}
                          </td>
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

        <aside className={styles.sideColumn}>
          <section className={styles.panel}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Noise Filters</h2>
              <p className={styles.sectionSubtitle}>
                Manage ignored user agents and actions. Stored values are saved in the
                database and merge with environment defaults.
              </p>
            </div>
            {blocked ? (
              <div className={styles.notice}>
                <h2>Admin access required</h2>
                <p>Please sign in with an admin account to update filters.</p>
                <a className={styles.link} href="/login">
                  Go to login
                </a>
              </div>
            ) : (
              <>
                {configLoading ? (
                  <p className={styles.configMessage}>Loading filters...</p>
                ) : null}
                {configError ? (
                  <p className={styles.configMessage}>{configError}</p>
                ) : null}
                <div className={styles.configGrid}>
                  <label className={styles.field}>
                    <span>Ignore User Agents (stored)</span>
                    <textarea
                      value={configForm.ignoreUserAgents}
                      onChange={(event) =>
                        setConfigForm((prev) => ({
                          ...prev,
                          ignoreUserAgents: event.target.value,
                        }))
                      }
                      placeholder="vercel-screenshot\nbot"
                      rows={5}
                    />
                    <span className={styles.configNote}>
                      One per line or comma-separated.
                    </span>
                  </label>
                  <label className={styles.field}>
                    <span>Ignore Actions (stored)</span>
                    <textarea
                      value={configForm.ignoreActions}
                      onChange={(event) =>
                        setConfigForm((prev) => ({
                          ...prev,
                          ignoreActions: event.target.value,
                        }))
                      }
                      placeholder="admin.audit_logs.list\nadmin.audit_logs.*"
                      rows={5}
                    />
                    <span className={styles.configNote}>
                      Use * to match action prefixes.
                    </span>
                  </label>
                </div>
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={handleConfigSave}
                    disabled={configSaving || configLoading}
                  >
                    {configSaving ? 'Saving...' : 'Save Filters'}
                  </button>
                </div>
                {configMessage ? (
                  <p className={styles.configMessage}>{configMessage}</p>
                ) : null}
                {config ? (
                  <div className={styles.listGrid}>
                    <div className={styles.listCard}>
                      <h3>Effective User Agents</h3>
                      {config.effective.ignoreUserAgents.length === 0 ? (
                        <p className={styles.configNote}>No ignored agents.</p>
                      ) : (
                        config.effective.ignoreUserAgents.map((entry) => (
                          <div className={styles.listItem} key={`ua-${entry}`}>
                            <span className={styles.listName}>{entry}</span>
                            <span className={styles.listValue}>ignored</span>
                          </div>
                        ))
                      )}
                      {config.env.ignoreUserAgents.length > 0 ? (
                        <p className={styles.configNote}>
                          Includes {config.env.ignoreUserAgents.length} env values.
                        </p>
                      ) : null}
                    </div>
                    <div className={styles.listCard}>
                      <h3>Effective Actions</h3>
                      {config.effective.ignoreActions.length === 0 ? (
                        <p className={styles.configNote}>No ignored actions.</p>
                      ) : (
                        config.effective.ignoreActions.map((entry) => (
                          <div className={styles.listItem} key={`action-${entry}`}>
                            <span className={styles.listName}>{entry}</span>
                            <span className={styles.listValue}>ignored</span>
                          </div>
                        ))
                      )}
                      {config.env.ignoreActions.length > 0 ? (
                        <p className={styles.configNote}>
                          Includes {config.env.ignoreActions.length} env values.
                        </p>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
