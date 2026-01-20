#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

if ! command -v agent-browser >/dev/null 2>&1; then
  echo "agent-browser is not installed or not on PATH."
  exit 1
fi

PORT="${ADMIN_AUDIT_PORT:-3102}"
LOG_FILE="${ADMIN_AUDIT_LOG_FILE:-/tmp/h1b_soc_admin_audit.log}"
STATUS_CODE="000"
ADMIN_EMAIL="${ADMIN_AUDIT_EMAIL:-}"
ADMIN_PASSWORD="${ADMIN_AUDIT_PASSWORD:-}"

PORT="$PORT" pnpm dev > "$LOG_FILE" 2>&1 &
DEV_PID=$!

cleanup() {
  kill "$DEV_PID" 2>/dev/null || true
}

trap cleanup EXIT

for _ in $(seq 1 60); do
  STATUS_CODE="$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${PORT}/admin/audit" || true)"
  if [ "$STATUS_CODE" = "200" ]; then
    break
  fi
  sleep 1
done

if [ "$STATUS_CODE" != "200" ]; then
  echo "Admin audit page not ready. HTTP status: $STATUS_CODE"
  tail -n 80 "$LOG_FILE" || true
  exit 1
fi

SESSION_NAME="admin-audit-$(date +%s)"
export AGENT_BROWSER_SESSION="$SESSION_NAME"

agent-browser open "http://localhost:${PORT}/admin/audit" >/tmp/h1b_admin_audit_open.log 2>&1 || {
  cat /tmp/h1b_admin_audit_open.log || true
  exit 1
}

if [ -n "$ADMIN_EMAIL" ] && [ -n "$ADMIN_PASSWORD" ]; then
  agent-browser open "http://localhost:${PORT}/login" >/tmp/h1b_admin_audit_login.log 2>&1 || {
    cat /tmp/h1b_admin_audit_login.log || true
    exit 1
  }
  agent-browser fill '[data-testid="login-email"]' "$ADMIN_EMAIL"
  agent-browser fill '[data-testid="login-password"]' "$ADMIN_PASSWORD"
  agent-browser click '[data-testid="login-submit"]'
  sleep 2
  agent-browser open "http://localhost:${PORT}/admin/audit" >/tmp/h1b_admin_audit_open.log 2>&1 || {
    cat /tmp/h1b_admin_audit_open.log || true
    exit 1
  }
fi

INTERACTIVE_SNAPSHOT="$(agent-browser snapshot -i)"
TEXT_SNAPSHOT="$(agent-browser snapshot)"

if ! echo "$INTERACTIVE_SNAPSHOT" | grep -q 'button "Run Cleanup"'; then
  echo "Missing Run Cleanup button."
  echo "$INTERACTIVE_SNAPSHOT"
  exit 1
fi

if ! echo "$INTERACTIVE_SNAPSHOT" | grep -Eq 'button "(Apply Filters|Loading...)"'; then
  echo "Missing Apply Filters/Loading button."
  echo "$INTERACTIVE_SNAPSHOT"
  exit 1
fi

if ! echo "$INTERACTIVE_SNAPSHOT" | grep -q 'button "Delete Matching"'; then
  echo "Missing Delete Matching button."
  echo "$INTERACTIVE_SNAPSHOT"
  exit 1
fi

if ! echo "$INTERACTIVE_SNAPSHOT" | grep -q 'button "Save Filters"'; then
  echo "Missing Save Filters button."
  echo "$INTERACTIVE_SNAPSHOT"
  exit 1
fi

if [ -n "$ADMIN_EMAIL" ] && [ -n "$ADMIN_PASSWORD" ]; then
  if echo "$INTERACTIVE_SNAPSHOT" | grep -q 'link "Go to login"'; then
    echo "Admin login failed or insufficient permissions."
    echo "$INTERACTIVE_SNAPSHOT"
    exit 1
  fi
fi

if ! echo "$TEXT_SNAPSHOT" | grep -q "Insights"; then
  echo "Missing Insights section."
  exit 1
fi

if ! echo "$TEXT_SNAPSHOT" | grep -q "Noise Filters"; then
  echo "Missing Noise Filters section."
  exit 1
fi

echo "Admin audit page browser smoke test passed."
