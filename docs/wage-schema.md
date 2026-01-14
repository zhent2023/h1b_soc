# Wage Schema Snapshot (Staging)

Source: staging database (credentials omitted).  
Snapshot date: 2025-02-14.

## WageRate column types

From `information_schema.columns` on staging:
- id: uuid, NOT NULL
- datasetVersionId: uuid, NOT NULL
- wageYear: text, NOT NULL
- isAcwia: boolean, NOT NULL
- areaCode: text, NOT NULL
- socCode: text, NOT NULL
- l1Annual: integer, NOT NULL
- l1Hourly: numeric, NULL
- l2Annual: integer, NULL
- l2Hourly: numeric, NULL
- l3Annual: integer, NULL
- l3Hourly: numeric, NULL
- l4Annual: integer, NULL
- l4Hourly: numeric, NULL
- hasDataQualityIssue: boolean, NOT NULL
- dataQualityNotes: jsonb, NULL

## WageYear distribution (top)

From `SELECT "wageYear", COUNT(*) ...` on staging:
- 2025-2026: 747326 rows

## Common areaCode values (top 20)

From `SELECT "areaCode", COUNT(*) ...` on staging:
1) 45940 (1421)
2) 3600006 (1418)
3) 10900 (1417)
4) 34100 (1417)
5) 28880 (1417)
6) 13140 (1417)
7) 4800004 (1417)
8) 4800006 (1417)
9) 40380 (1416)
10) 3900004 (1416)
11) 3600001 (1416)
12) 24020 (1416)
13) 600006 (1416)
14) 4800003 (1416)
15) 17300 (1416)
16) 12100 (1415)
17) 43300 (1415)
18) 4700001 (1415)
19) 3600004 (1415)
20) 19660 (1415)

## pgvector status

From `pg_available_extensions` and `pg_extension`:
- Available: yes (default_version 0.8.0)
- Installed: no

Action needed for staging before Wave 1/3 tests:
`CREATE EXTENSION IF NOT EXISTS vector;`

## Defaults used by the product

From `.env.example` (confirm actual env overrides):
- DEFAULT_WAGE_YEAR=2025-2026
- DEFAULT_IS_ACWIA=false

## National fallback decision

Decision: disabled for now. `WAGE_NATIONAL_AREA_CODE` remains unset to avoid misleading wage previews.

## Queries used

```sql
SELECT column_name, data_type, udt_name, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'WageRate'
ORDER BY ordinal_position;

SELECT "areaCode", COUNT(*)
FROM "WageRate"
GROUP BY "areaCode"
ORDER BY COUNT(*) DESC
LIMIT 20;

SELECT "wageYear", COUNT(*)
FROM "WageRate"
GROUP BY "wageYear"
ORDER BY COUNT(*) DESC
LIMIT 10;

SELECT extname, extversion
FROM pg_extension
WHERE extname = 'vector';
```
