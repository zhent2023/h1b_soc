#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
ACCESS_EMAIL="${ACCESS_EMAIL:-demo@example.com}"
ACCESS_KEY="${ACCESS_KEY:-demo-key}"
EMAIL_HEADER="${ACCESS_EMAIL_HEADER:-x-access-email}"
KEY_HEADER="${ACCESS_TOKEN_HEADER:-x-access-key}"
DATASET_NAME="${DATASET_NAME:-oflc}"
TARGET_VERSION_ID="${TARGET_VERSION_ID:-}"
TARGET_VERSION_LABEL="${TARGET_VERSION_LABEL:-}"

if [[ -z "$TARGET_VERSION_ID" && -z "$TARGET_VERSION_LABEL" ]]; then
  echo "Set TARGET_VERSION_ID or TARGET_VERSION_LABEL to switch ${DATASET_NAME}."
  exit 1
fi

echo "Ensure the API server is running with LOOKUP_DELAY_MS set (e.g. LOOKUP_DELAY_MS=1500)."

payload=$(jq -n --arg addr "410 Great Road B9 Unit 7-3, Littleton, MA 01460" --arg soc "15-1252" '{address:{fullText:$addr}, socCode:$soc}')

before_versions=$(
  curl -s "${BASE_URL}/api/v1/lookup" \
    -H "content-type: application/json" \
    -H "${EMAIL_HEADER}: ${ACCESS_EMAIL}" \
    -H "${KEY_HEADER}: ${ACCESS_KEY}" \
    -d "$payload" | jq -c '.datasetVersions'
)

tmp_response="$(mktemp)"
curl -s "${BASE_URL}/api/v1/lookup" \
  -H "content-type: application/json" \
  -H "${EMAIL_HEADER}: ${ACCESS_EMAIL}" \
  -H "${KEY_HEADER}: ${ACCESS_KEY}" \
  -d "$payload" > "$tmp_response" &
lookup_pid=$!

sleep 0.3

if [[ -n "$TARGET_VERSION_ID" ]]; then
  pnpm exec tsx scripts/ingest/activate_dataset.ts --dataset "$DATASET_NAME" --versionId "$TARGET_VERSION_ID"
else
  pnpm exec tsx scripts/ingest/activate_dataset.ts --dataset "$DATASET_NAME" --versionLabel "$TARGET_VERSION_LABEL"
fi

after_versions=$(
  curl -s "${BASE_URL}/api/v1/lookup" \
    -H "content-type: application/json" \
    -H "${EMAIL_HEADER}: ${ACCESS_EMAIL}" \
    -H "${KEY_HEADER}: ${ACCESS_KEY}" \
    -d "$payload" | jq -c '.datasetVersions'
)

wait "$lookup_pid"

delayed_versions=$(jq -c '.datasetVersions' "$tmp_response")

echo "Before switch:  $before_versions"
echo "After switch:   $after_versions"
echo "Delayed result: $delayed_versions"

if [[ "$before_versions" == "$after_versions" ]]; then
  echo "Dataset versions did not change after activation; check TARGET_VERSION_*."
  exit 1
fi

if [[ "$delayed_versions" == "$before_versions" ]]; then
  echo "OK: delayed response kept initial dataset versions."
else
  echo "Mismatch: delayed response did not keep initial dataset versions."
  exit 1
fi
