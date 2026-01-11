#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
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

pnpm db:migrate
pnpm db:seed

pnpm test -- -t soc_normalizer

ensure_playwright_browsers() {
  local mac_cache="${HOME}/Library/Caches/ms-playwright"
  local linux_cache="${HOME}/.cache/ms-playwright"

  if [ ! -d "$mac_cache" ] && [ ! -d "$linux_cache" ]; then
    pnpm exec playwright install
  fi
}

PORT="${PORT:-3000}"
BASE_URL="${BASE_URL:-http://localhost:${PORT}}"

start_server() {
  local log_file="$1"
  shift
  "$@" pnpm dev > "$log_file" 2>&1 &
  echo $!
}

wait_for_server() {
  for _ in $(seq 1 60); do
    if curl -fs "${BASE_URL}/" >/dev/null; then
      return 0
    fi
    sleep 1
  done
  return 1
}

stop_server() {
  local pid="$1"
  if [ -n "$pid" ]; then
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
}

LOG_FILE="/tmp/h1b_soc_wave2_stub.log"
export ACCESS_MODE=public
export GEOCODER_PROVIDER=stub

DEV_PID="$(start_server "$LOG_FILE" env ACCESS_MODE="$ACCESS_MODE" GEOCODER_PROVIDER="$GEOCODER_PROVIDER")"
trap 'stop_server "$DEV_PID"' EXIT

wait_for_server

node scripts/acceptance/rate_limit_lookup.js

curl -s "${BASE_URL}/api/v1/geo/candidates?state=MA&q=midd&limit=5" \
  -H "content-type: application/json" | jq -e '
    (.items | length >= 1)
    and (.items[0].areaCode | length > 0)
    and (.items[0].areaName | length > 0)
  ' >/dev/null

stop_server "$DEV_PID"
trap - EXIT

LOG_FILE="/tmp/h1b_soc_wave2_census_timeout.log"
export GEOCODER_PROVIDER=census
export GEOCODER_TIMEOUT_MS=1

DEV_PID="$(start_server "$LOG_FILE" env ACCESS_MODE="$ACCESS_MODE" GEOCODER_PROVIDER="$GEOCODER_PROVIDER" GEOCODER_TIMEOUT_MS="$GEOCODER_TIMEOUT_MS")"
trap 'stop_server "$DEV_PID"' EXIT

wait_for_server

curl -s "${BASE_URL}/api/v1/lookup" \
  -H "content-type: application/json" \
  -d '{"address":{"fullText":"946 Albany Avenue, Brooklyn, NY 11203"}}' | jq -e '
    .kind == "geo_needs_confirmation"
    and (.explain.summary | any(test("timed out"; "i")))
  ' >/dev/null

stop_server "$DEV_PID"
trap - EXIT

ensure_playwright_browsers

LOG_FILE="/tmp/h1b_soc_wave2_census_ui.log"
export GEOCODER_PROVIDER=census
export GEOCODER_TIMEOUT_MS=5000
export RATE_LIMIT_LOOKUP_PER_MIN=1000
export RATE_LIMIT_GEO_CANDIDATES_PER_MIN=1000

DEV_PID="$(start_server "$LOG_FILE" env ACCESS_MODE="$ACCESS_MODE" GEOCODER_PROVIDER="$GEOCODER_PROVIDER" GEOCODER_TIMEOUT_MS="$GEOCODER_TIMEOUT_MS" RATE_LIMIT_LOOKUP_PER_MIN="$RATE_LIMIT_LOOKUP_PER_MIN" RATE_LIMIT_GEO_CANDIDATES_PER_MIN="$RATE_LIMIT_GEO_CANDIDATES_PER_MIN")"
trap 'stop_server "$DEV_PID"' EXIT

wait_for_server

pnpm test:e2e:wave2

stop_server "$DEV_PID"
trap - EXIT

echo "Wave 2 automated checks passed."
