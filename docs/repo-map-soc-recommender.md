# SOC Recommender Repo Map

This map lists the exact files and symbols to reuse for auth, rate limit, dataset versions, and UI wiring.

## Auth / access behavior (match /api/v1/lookup)

- `src/lib/access.ts`
  - `requireAccess(req, prisma)` implements ACCESS_MODE:
    - `ACCESS_MODE=public` bypasses auth
    - otherwise checks session cookie or API key headers
- `app/api/v1/lookup/route.ts`
  - Calls `requireAccess` and uses same access semantics to preserve parity.

## Rate limiting

- `src/lib/rateLimit.ts`
  - `rateLimitOrThrow({ key, limitPerMin, req })`
  - Uses Redis when `REDIS_URL` is set; falls back to in-memory.
- `app/api/v1/lookup/route.ts`
  - Reads `RATE_LIMIT_LOOKUP_PER_MIN` and `RATE_LIMIT_SOC_EXTREMES_PER_MIN`.

## Active dataset versions

- `src/lib/constants.ts`
  - `captureDatasetContext(prisma)` returns active versions for `oflc`, `onet`, `cbsa`
  - Uses `DatasetVersion.isActive=true` rows.
- `src/lib/lookup.ts`
  - Calls `captureDatasetContext` and passes:
    - `oflcVersionId` to wage lookups
    - `onetVersionId` to duties lookups
    - `cbsaVersionId` to geo resolution

## O*NET duties + occupations data access

- `src/lib/duties.ts`
  - `getDutiesForOnetCode({ prisma, datasetVersionId, onetCode })`
  - `getDutiesForSoc({ prisma, datasetVersionId, socCode })`
- `app/api/v1/onet/occupations/route.ts`
  - Active O*NET dataset for typeahead search (codes + titles).

## Wage defaults and wage context

- `src/lib/lookup.ts`
  - Defaults:
    - `DEFAULT_WAGE_YEAR` (string, e.g. "2025-2026")
    - `DEFAULT_IS_ACWIA` (boolean)
  - `areaCode` derived by `resolveOflcArea` from geocode (unless `override.areaCode` supplied).
- `src/lib/wages.ts`
  - `getWageRate` and `getSocExtremes` use `(datasetVersionId, wageYear, isAcwia, areaCode, socCode)`.

## Form page + O*NET input wiring

- `app/page.tsx`
  - O*NET input state: `socInput`, `socCode`, `socSelectedTitle`
  - Suggestions fetched from `/api/v1/onet/occupations`
  - Selection writes `socCode` (O*NET-8) and updates input label.
  - URL param handling already exists for other flows; extend here for recommender banner.
- `app/page.module.css`
  - Existing styles for suggestions and cards.

## API entrypoints to mirror

- `app/api/v1/lookup/route.ts`
  - Auth, rate limit, cache context, error handling patterns.
- `app/api/v1/onet/occupations/route.ts`
  - Query pattern for O*NET code/title search.

## CI / test DB setup
- `.github/workflows/ci.yml` runs tests in GitHub Actions.
- CI Postgres service uses `pgvector/pgvector:pg16`.
- `docker-compose.yml` uses `postgres:16` (no pgvector by default) for local dev.

## Test commands

- `package.json` scripts:
  - `test`: `vitest run && pnpm lint && pnpm vercel-build`
  - `test:unit`: `vitest run tests/unit`
  - `test:integration`: `vitest run tests/integration --passWithNoTests`
  - `test:e2e`: `playwright test`
