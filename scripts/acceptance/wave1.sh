#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"

headers=("-H" "Content-Type: application/json")
if [ -n "${ACCESS_EMAIL:-}" ] && [ -n "${ACCESS_KEY:-}" ]; then
  headers+=("-H" "x-access-email: ${ACCESS_EMAIL}")
  headers+=("-H" "x-access-key: ${ACCESS_KEY}")
fi

echo "Lookup: address only"
response_address=$(
  curl -s "${headers[@]}" -X POST "${BASE_URL}/api/v1/lookup" \
    -d '{"address":{"fullText":"946 Albany Avenue, Brooklyn, NY 11203"}}'
)
echo "$response_address" | jq '{kind, areaCode: .geo.area.areaCode, areaName: .geo.area.areaName}'
echo "$response_address" | jq -e '
  .kind == "geo_only"
  and (.datasetVersions.oflc.datasetName == "oflc")
  and ((.explain.summary | length) >= 1 and (.explain.summary | length) <= 5)
  and (.geo.area.areaCode | length > 0)
  and (.geo.area.areaName | length > 0)
  and (.geo.geocode.countyName | length > 0)
' >/dev/null

echo "Lookup: address + SOC"
response_address_soc=$(
  curl -s "${headers[@]}" -X POST "${BASE_URL}/api/v1/lookup" \
    -d '{"address":{"fullText":"946 Albany Avenue, Brooklyn, NY 11203"}, "socCode":"15-1252"}'
)
echo "$response_address_soc" | jq '{kind, level1: .wages.level1.annual, dutiesCount: (.duties.duties | length)}'
echo "$response_address_soc" | jq -e '
  .kind == "geo_wage"
  and (.wages.level1.annual | type == "number")
  and (.wages.level1.hourly | type == "number")
  and (.wages.level2.annual | type == "number")
  and (.wages.level2.hourly | type == "number")
  and (.wages.level3.annual | type == "number")
  and (.wages.level3.hourly | type == "number")
  and (.wages.level4.annual | type == "number")
  and (.wages.level4.hourly | type == "number")
  and (.duties.duties | length > 0)
' >/dev/null

echo "Lookup: SOC only"
response_soc=$(
  curl -s "${headers[@]}" -X POST "${BASE_URL}/api/v1/lookup" \
    -d '{"socCode":"15-1252"}'
)
echo "$response_soc" | jq '{kind, lowestCount: (.extremes.lowest | length), highestCount: (.extremes.highest | length)}'
echo "$response_soc" | jq -e '
  .kind == "soc_extremes"
  and (.extremes.lowest | length == 5)
  and (.extremes.highest | length == 5)
  and (all(.extremes.lowest[]; (.area.areaCode | length > 0)
    and (.level1.annual | type == "number")
    and (.level2.annual | type == "number")
    and (.level3.annual | type == "number")
    and (.level4.annual | type == "number")))
  and (all(.extremes.highest[]; (.area.areaCode | length > 0)
    and (.level1.annual | type == "number")
    and (.level2.annual | type == "number")
    and (.level3.annual | type == "number")
    and (.level4.annual | type == "number")))
' >/dev/null
