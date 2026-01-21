#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

USE_AGENT_BROWSER=1
if ! command -v agent-browser >/dev/null 2>&1; then
  USE_AGENT_BROWSER=0
fi

PORT="${ADMIN_AUDIT_PORT:-3102}"
HOST="${ADMIN_AUDIT_HOST:-127.0.0.1}"
MODE="${ADMIN_AUDIT_MODE:-dev}"
LOG_FILE="${ADMIN_AUDIT_LOG_FILE:-/tmp/h1b_soc_admin_audit.log}"
STATUS_CODE="000"
ADMIN_EMAIL="${ADMIN_AUDIT_EMAIL:-}"
ADMIN_PASSWORD="${ADMIN_AUDIT_PASSWORD:-}"
BASE_URL="http://${HOST}:${PORT}"

if [ "$MODE" = "build" ] || [ "$MODE" = "production" ]; then
  if [ ! -f ".next/BUILD_ID" ]; then
    pnpm vercel-build
  fi
  NODE_ENV=production pnpm start --hostname "$HOST" --port "$PORT" > "$LOG_FILE" 2>&1 &
else
  pnpm dev --hostname "$HOST" --port "$PORT" > "$LOG_FILE" 2>&1 &
fi
SERVER_PID=$!

cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
}

trap cleanup EXIT

for _ in $(seq 1 60); do
  STATUS_CODE="$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/admin/audit" || true)"
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

if [ "$USE_AGENT_BROWSER" -eq 1 ]; then
  agent-browser open "${BASE_URL}/admin/audit" >/tmp/h1b_admin_audit_open.log 2>&1 || {
    cat /tmp/h1b_admin_audit_open.log || true
    exit 1
  }

  if [ -n "$ADMIN_EMAIL" ] && [ -n "$ADMIN_PASSWORD" ]; then
    agent-browser open "${BASE_URL}/login" >/tmp/h1b_admin_audit_login.log 2>&1 || {
      cat /tmp/h1b_admin_audit_login.log || true
      exit 1
    }
    agent-browser fill '[data-testid="login-email"]' "$ADMIN_EMAIL"
    agent-browser fill '[data-testid="login-password"]' "$ADMIN_PASSWORD"
    agent-browser click '[data-testid="login-submit"]'
    sleep 2
    agent-browser open "${BASE_URL}/admin/audit" >/tmp/h1b_admin_audit_open.log 2>&1 || {
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
else
  ADMIN_AUDIT_BASE_URL="$BASE_URL" node scripts/smoke/admin_audit_playwright.mjs
fi

echo "Admin audit page browser smoke test passed."
