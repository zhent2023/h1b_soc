#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
ACCESS_EMAIL="${ACCESS_EMAIL:-demo@example.com}"
ACCESS_KEY="${ACCESS_KEY:-demo-key}"
EMAIL_HEADER="${ACCESS_EMAIL_HEADER:-x-access-email}"
KEY_HEADER="${ACCESS_TOKEN_HEADER:-x-access-key}"
SOC_CODE="${SOC_CODE:-15-1252}"

ADDRESSES=(
  "410 Great Road B9 Unit 7-3, Littleton, MA 01460"
  "946 Albany Avenue, Brooklyn, NY 11203"
  "265 Lorimer Street, Apt 637, Brooklyn, NY 11206"
  "9600 Great Hills Trail, Suite 150W, Austin, TX 78759"
  "131 Marcellin Dr, City of Industry, CA 91789"
)

for address in "${ADDRESSES[@]}"; do
  payload=$(jq -n --arg addr "$address" --arg soc "$SOC_CODE" '{address:{fullText:$addr}, socCode:$soc}')
  echo "==> ${address}"
  curl -s "${BASE_URL}/api/v1/lookup" \
    -H "content-type: application/json" \
    -H "${EMAIL_HEADER}: ${ACCESS_EMAIL}" \
    -H "${KEY_HEADER}: ${ACCESS_KEY}" \
    -d "$payload" | jq '{
      kind,
      datasetVersions,
      areaCode: .geo.area.areaCode,
      wages: .wages.level1,
      dutiesCount: (.duties.duties | length),
      isCrossState: .geo.cbsa.isCrossState
    }'
done
