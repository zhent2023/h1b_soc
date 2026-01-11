#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"

headers=("-H" "Content-Type: application/json")
if [ -n "${ACCESS_EMAIL:-}" ] && [ -n "${ACCESS_KEY:-}" ]; then
  headers+=("-H" "x-access-email: ${ACCESS_EMAIL}")
  headers+=("-H" "x-access-key: ${ACCESS_KEY}")
fi

echo "Ensure the server is running with GEOCODER_PROVIDER=census"
echo "Lookup: census geocoder (MA address)"
response=$(
  curl -s "${headers[@]}" -X POST "${BASE_URL}/api/v1/lookup" \
    -d '{"address":{"fullText":"410 Great Road B9 Unit 7-3, Littleton, MA 01460"}}'
)

echo "$response" | jq '{
  countyFips: .geo.geocode.countyFips,
  placeName: .geo.geocode.placeName,
  areaCode: .geo.area.areaCode,
  cbsaName: (.geo.cbsa.name // null),
  isCrossState: (.geo.cbsa.isCrossState // null)
}'
