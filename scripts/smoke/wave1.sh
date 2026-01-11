#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
fi

if [ -z "${DB_PORT:-}" ] && [ -f .env ]; then
  db_line="$(grep -m1 '^DATABASE_URL=' .env || true)"
  db_url="${db_line#DATABASE_URL=}"
  if [ -n "$db_url" ]; then
    db_port="$(printf '%s' "$db_url" | sed -nE 's|^.*://[^@]+@[^:/]+:([0-9]+).*|\1|p')"
    if [ -n "$db_port" ]; then
      export DB_PORT="$db_port"
    fi
  fi
fi

docker compose up -d

wait_for_health() {
  local service="$1"
  local cid
  cid="$(docker compose ps -q "$service")"

  if [ -z "$cid" ]; then
    echo "Skipping $service healthcheck (not running)."
    return 0
  fi

  local start
  start="$(date +%s)"

  while true; do
    local status
    status="$(docker inspect --format='{{.State.Health.Status}}' "$cid" 2>/dev/null || true)"

    if [ "$status" = "healthy" ]; then
      echo "$service is healthy."
      return 0
    fi

    if [ "$status" = "unhealthy" ]; then
      echo "$service is unhealthy."
      docker logs "$cid" --tail 50 || true
      return 1
    fi

    if [ -z "$status" ]; then
      echo "No healthcheck defined for $service."
      return 0
    fi

    if [ $(( $(date +%s) - start )) -gt 60 ]; then
      echo "Timed out waiting for $service to be healthy."
      return 1
    fi

    sleep 2
  done
}

wait_for_health db

if [ -n "$(docker compose ps -q redis)" ]; then
  wait_for_health redis
fi

if [ ! -d node_modules ]; then
  pnpm install
fi

export GEOCODER_PROVIDER=stub
export ACCESS_MODE=public

pnpm db:migrate
pnpm db:seed
pnpm test

ensure_playwright_browsers() {
  local mac_cache="${HOME}/Library/Caches/ms-playwright"
  local linux_cache="${HOME}/.cache/ms-playwright"

  if [ ! -d "$mac_cache" ] && [ ! -d "$linux_cache" ]; then
    pnpm exec playwright install
  fi
}

ensure_playwright_browsers

PORT="${PORT:-3000}"
LOG_FILE="/tmp/h1b_soc_wave1_dev.log"
pnpm dev > "$LOG_FILE" 2>&1 &
DEV_PID=$!

cleanup() {
  kill "$DEV_PID" 2>/dev/null || true
}

trap cleanup EXIT

for _ in $(seq 1 60); do
  if curl -fs "http://localhost:${PORT}/" >/dev/null; then
    break
  fi
  sleep 1
done

bash scripts/acceptance/wave1.sh
pnpm test:e2e

echo "Wave 1 automated checks passed."
