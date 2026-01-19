# SOC Recommender (O*NET-8 Embeddings) Implementation Spec

Status: Design converged, implementation-ready  
Audience: Expert immigration-law users (lawyers)  
Primary UX: Recommend Top 6 O*NET-8 occupation cards from job duties; user selects an O*NET-8 code into the main form. Wages are previewed via SOC-6 derived from O*NET-8 truncation, lookup flow remains unchanged.

This spec is audit-friendly and execution-friendly for Codex:
- Every wave has Action + Why + Tests (hard gate) + Expected Results + Rollback hooks.
- Mandatory rule: do not proceed to the next wave until all tests in the current wave pass. If any test fails, fix it immediately, re-run, and only then continue.

---

## 1) Summary

We will add an O*NET-8 recommender feature that:
1) Accepts free-text job duties (`dutiesText`) from the user.
2) Performs vector retrieval against precomputed embeddings for O*NET-8 occupations.
3) Returns Top 6 matched O*NET-8 occupations (cards), enriched with:
   - Duties preview (from O*NET duties for the same O*NET dataset version used to build embeddings)
   - Prevailing Wage Level 1 hourly + annual preview (from OFLC WageRate), using SOC-6 derived by truncating the O*NET-8 code.

User selects one card and we write the selected **O*NET-8 code** into the existing form field.
We do not change existing lookup logic, wage calculations, or core tables.

Feature safety:
- Entire feature behind feature flags (server and client).
- Additive DB changes only.
- Fast rollback is disabling flags.

---

## 2) Assumptions

### 2.1 Data and schema assumptions (validated by codebase review)
- WageRate includes:
  - `wageYear` is a string (example: "2025-2026")
  - `dataQualityNotes` is JSON (JSONB in Postgres, Prisma Json type)
  - `l1Hourly` is decimal-like and should be returned as string (avoid float precision issues)
  - `l1Annual` is integer
  - `hasDataQualityIssue` boolean exists
- Wage lookup keys are: `(active OFLC datasetVersionId, wageYear, isAcwia, areaCode, socCode)`
- SOC code for wages is derived from O*NET-8 by truncation:
  - `socCode = matchedOnetCode.split('.')[0]`
  - Example: "15-1252.00" -> "15-1252"

### 2.2 Technical assumptions
- Postgres is used and can enable pgvector extension.
- Prisma is used for ORM, but pgvector is not natively supported, so:
  - Prisma schema must use `Unsupported("vector(3072)")`
  - Vector search and index operations must use raw SQL via `$queryRaw` / `$executeRaw`
- Next.js route handlers exist and run server-side, secrets must never ship to browsers or MV3 extension contexts.
- Test stack exists (Vitest/Jest + Playwright), exact commands discovered in Wave 0 repo map.

---

## 3) Non-goals

- Do not modify `/api/v1/lookup` behavior.
- Do not store user `dutiesText` persistently, do not log it in plaintext.
- No client-side embedding generation.
- No SOC-level aggregated embeddings; embeddings are keyed by O*NET-8 only.
- No user-configurable TopK in V1 (fixed Top 6).
- No runtime-configurable embedding dimension. Dimension is fixed at 3072.

---

## 4) Key Decisions (and rationale)

### 4.1 Vector dimension fixed at 3072
- DB column is `vector(3072)`, and the code must enforce 3072 at runtime.
- Rationale: allowing runtime dimension changes via env is misleading and will fail at write time. Changing dimension requires migration and table rebuild.

### 4.2 Wage field types must match existing schema
- `wageYear`: string | null
- `wageDataQualityNotes`: object | null (JSON), not string
- Rationale: avoid API type drift and serialization mismatches.

### 4.3 Prisma + pgvector implementation must use raw SQL
- Vector similarity search uses `$queryRaw` with `embedding <=> $1::vector` (cosine distance).
- `SET LOCAL statement_timeout` must be executed inside the same Prisma interactive transaction callback to guarantee it applies to the vector query.

### 4.4 socTitle source alignment
- `socTitle` comes from OFLC dataset version (same as wages).
- `matchedOnetTitle` and `duties` come from the embedding version’s O*NET dataset version.
- Rationale: prevent title and wage mismatches across multiple dataset version domains.

### 4.5 Coverage threshold definition
- Denominator is the set of O*NET codes that have at least one duty row in OnetDuty (eligible set).
- Rationale: codes without duties cannot be meaningfully embedded; including them makes the threshold unachievable.

---

## 5) API Contract

### 5.1 Route
POST `/api/v1/soc/recommend`

### 5.2 Request JSON
```ts
export interface SocRecommendRequest {
  dutiesText: string;          // required
  areaCode?: string;           // optional, needed for wage preview unless national fallback is enabled
  wageYear?: string;           // optional, matches WageRate.wageYear type (string like "2025-2026")
  isAcwia?: boolean;           // optional
}
```

### 5.3 Response JSON (flattened, stable)
```ts
export type WageSource = "LOCAL" | "NATIONAL" | "NONE";

export interface SocRecommendItem {
  matchedOnetCode: string;          // O*NET-8, primary selection entity
  matchedOnetTitle: string | null;  // from O*NET dataset version used by embeddings

  socCode: string;                  // derived by truncation
  socTitle: string | null;          // from active OFLC dataset version (align with wages)

  // similarity is a normalized 0..1 display value derived from cosine distance
  // use: similarity = clamp(1 - (distance / 2), 0, 1)
  similarity: number;

  // duties enrichment (O*NET)
  duties: string[];                 // full list (UI previews 6)
  dutiesCount: number;
  dutiesAvailable: boolean;

  // wage enrichment (OFLC WageRate)
  wageLevel1Hourly: string | null;  // decimal formatted as string
  wageLevel1Annual: number | null;  // integer
  wageYear: string | null;          // string like "2025-2026"
  wageAreaCode: string | null;
  wageIsAcwia: boolean | null;
  wageAvailable: boolean;
  wageHasDataQualityIssue: boolean | null;
  wageDataQualityNotes: object | null; // JSON object
  wageSource: WageSource;           // LOCAL | NATIONAL | NONE
}

export interface SocRecommendResponse {
  items: SocRecommendItem[];
  warnings: string[];
  meta: {
    embeddingVersionId: string;
    onetDatasetVersionId: string;
    oflcDatasetVersionId: string;

    internalTopK: number;     // e.g. 30
    outputTopK: number;       // fixed 6

    inputLength: number;
    inputTruncated: boolean;

    queryTimeMs: number;

    enrichment: {
      dutiesIncluded: boolean;
      wageIncluded: boolean;
      skippedReason?: "TIMEOUT" | "MISSING_WAGE_CONTEXT" | "ERROR";
    };
  };
}
```

## 6) Data Model Changes (Wave 1)

We add two additive tables. Names below are examples; follow repo conventions found in Wave 0 repo map.

### 6.1 OnetEmbeddingVersion (metadata only)

Columns (suggested):
- id (uuid)
- provider (text)
- model (text)
- outputDim (int, must be 3072)
- onetDatasetVersionId (text/uuid, match existing dataset version type)
- isActive (boolean)
- metaJson (jsonb, optional)
- createdAt (timestamp)

Constraints:
- enforce single active version using a partial unique index where isActive = true.

### 6.2 OnetDutyEmbedding (vector storage)

Columns (suggested):
- id (uuid)
- embeddingVersionId (uuid)
- onetCode (text) // O*NET-8
- contentText (text) // document used for embedding
- embedding (vector(3072)) // pgvector type
- createdAt, updatedAt

Constraints:
- unique (embeddingVersionId, onetCode)
- index on embeddingVersionId

Important Prisma note:
- Prisma schema must declare embedding Unsupported("vector(3072)").
- All operations involving vector operators should be raw SQL via $queryRaw.

## 7) Plan (Waves, with hard test gates)

### Global execution rule
- Implement the wave.
- Run all tests defined for that wave.
- If any test fails, fix immediately and re-run.
- Only then commit and proceed.

### Wave 0: Spec + env + repo map (single source of truth)

**Action**
- Add this file as `docs/soc-recommender-implementation.md`.
- Update `.env.example` with:
  - FEATURE_SOC_RECOMMENDER=false
  - NEXT_PUBLIC_FEATURE_SOC_RECOMMENDER=false
  - SOC_RECOMMEND_INTERNAL_TOPK=30
  - SOC_RECOMMEND_OUTPUT_TOPK=5
  - SOC_RECOMMEND_STATEMENT_TIMEOUT_MS=1500
  - SOC_RECOMMEND_ENRICHMENT_TIMEOUT_MS=300
  - EMBEDDING_PROVIDER=stub|<real>
  - EMBEDDING_MODEL=<string>
  - WAGE_NATIONAL_AREA_CODE= (empty by default, national fallback disabled unless explicitly set)
  - Optional caching:
    - REDIS_URL=
- Produce `docs/repo-map-soc-recommender.md` with exact file paths and symbols:
  - auth helper(s) used by `/api/v1/lookup` (and ACCESS_MODE behavior)
  - rate limit implementation location and how to add a bucket
  - how active O*NET dataset version is determined
  - how active OFLC dataset version is determined
  - where the form page and O*NET input state/handler live
  - where wage defaults (wageYear/isAcwia/areaCode) come from today
  - CI test DB setup and whether pgvector is available

**Why**
- Prevent Codex from inventing helpers, routes, or dataset version logic.
- Lock a single source of truth for implementation.

**Tests (must pass)**
- Repo build command passes.
- Existing unit tests pass.

**Expected results**
- No runtime behavior change; flags remain off.
- Repo map doc contains actionable, concrete locations.

**Rollback hooks**
- None needed; no behavior change.

**Human-required**
- Quick human check: skim repo map for obvious mismatches (wrong route, wrong helper).

### Wave 0.5: Wage + pgvector environment verification (human-required gate)

**Action (human required)**
- Verify WageRate field types and the most common area codes.
- Verify pgvector availability in dev/staging/prod/CI.
- Suggested SQL (adjust table name quoting as needed):

```sql
-- WageRate types
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'WageRate'
ORDER BY ordinal_position;

-- Most common area codes
SELECT "areaCode", COUNT(*) AS n
FROM "WageRate"
GROUP BY "areaCode"
ORDER BY n DESC
LIMIT 20;

-- pgvector extension presence
SELECT extname, extversion
FROM pg_extension
WHERE extname = 'vector';
```

- Write `docs/wage-schema.md` documenting:
  - wageYear format examples (confirm "2025-2026" style)
  - national fallback decision:
    - If enabled, exact value for WAGE_NATIONAL_AREA_CODE
    - If disabled, state explicitly that wage preview requires areaCode
  - defaults for wageYear and isAcwia in the product

**Why**
- This converts assumptions into audited facts and prevents silent wage preview errors.

**Tests (must pass)**
- `docs/wage-schema.md` exists and is complete.

**Expected results**
- Clear decision for national fallback and correct type expectations.
- Findings captured in `docs/wage-schema.md` (including pgvector status, wageYear distribution, and common areaCodes).

**Rollback hooks**
- None; docs only.

### Wave 1: DB schema + pgvector check + schema integration tests

**Action**
- Update `prisma/schema.prisma`:
  - Add OnetEmbeddingVersion.
  - Add OnetDutyEmbedding with embedding `Unsupported("vector(3072)")`.
  - Add clear comments that vector queries must use raw SQL.
- Add migration:
  - `CREATE EXTENSION IF NOT EXISTS vector;`
  - Create the two tables.
  - Add partial unique index for single active embedding version.
- Add `scripts/admin/check_pgvector.ts`:
  - Check extension exists.
  - Run a small cosine distance query (or a minimal vector operator sanity check).

**Why**
- Additive tables reduce risk.
- Early pgvector check prevents late-stage surprises.

**Tests (must pass)**
- `prisma generate`.
- Integration test (requires Postgres + pgvector):
  - Insert OnetEmbeddingVersion.
  - Assert single-active constraint by attempting to insert two active versions and expecting failure.
  - Insert OnetDutyEmbedding with a dummy vector via `$executeRaw` and read back via `$queryRaw`.
- `check_pgvector.ts` succeeds.
- Build + existing tests pass.

**Expected results**
- Tables exist, constraints work, pgvector works in the environments that matter.

**Rollback hooks**
- Feature flags remain off; no user-facing exposure.

### Wave 2: Embedding utilities + document builder (unit-test heavy, no DB)

**Action**
- Add embedding constants:
  - `EMBEDDING_DIM = 3072`
- Add `src/lib/embeddings/vectorUtils.ts`:
  - `validateVectorDimension(values: number[])` enforces 3072.
  - `toVectorLiteral(values: number[])`:
    - rejects NaN/Infinity
    - bounds precision (stable string output)
    - produces SQL-safe literal like `[0.1,0.2,...]` with only numeric tokens
- Add `src/lib/embeddings/providerStub.ts`:
  - deterministic, stable output (hash-based)
  - always returns 3072 numbers
- Add `src/lib/onet/buildOnetEmbeddingDocument.ts`:
  - stable ordering by sortOrder
  - case-insensitive dedup of duty text
  - MAX_DUTIES and MAX_CHARS truncation
  - returns `{ contentText, dutyCount, truncated }`
- Add exhaustive unit tests for all above edge cases.

**Why**
- Embedding drift and serialization bugs are expensive and hard to debug later.
- Determinism is required for stable tests and predictable retrieval.

**Tests (must pass)**
- Unit tests covering:
  - wrong dimension rejection
  - empty array rejection
  - NaN/Infinity rejection
  - precision truncation stability
  - stub determinism
  - document ordering/dedup/truncation

**Expected results**
- All embedding utilities are safe, deterministic, and testable offline.

**Rollback hooks**
- Not applicable; feature still off.

### Wave 3: Offline embedding compute script (idempotent + resumable + coverage gate)

**Action**
- Add `scripts/admin/compute_onet_embeddings.ts`:
  - Acquire Postgres advisory lock to prevent concurrent runs.
  - Resolve active O*NET dataset version using repo map logic.
  - Create a new inactive OnetEmbeddingVersion (outputDim must be 3072).
  - Determine eligible O*NET codes:
    - Denominator = distinct onetCode that has at least one OnetDuty row for that O*NET dataset version.
  - For each eligible onetCode:
    - build document with buildOnetEmbeddingDocument
    - embed using provider (batch)
    - upsert into OnetDutyEmbedding
  - Coverage threshold:
    - coverage = successCount / eligibleCount
    - threshold default 0.95, configurable by `EMBEDDING_COVERAGE_THRESHOLD` (optional env)
  - If coverage >= threshold:
    - atomically set this version active and deactivate previous active version in a single transaction.
  - Resume behavior:
    - safe to re-run, upserts prevent duplication.
  - Logging:
    - never log full contentText, only counts and timings.
  - At script startup, validate provider dimension:
    - a test embedding must be length 3072, otherwise fail fast.

**Why**
- Online API should only do retrieval, not expensive embedding generation.
- Coverage gate prevents activating broken or partial embedding builds.
- Idempotency and resume are required for operational reliability.

**Tests (must pass)**
- Integration tests with Postgres + pgvector + stub provider:
  - idempotency: running twice does not change row counts
  - resume: simulate failure mid-run, then re-run and reach full coverage
  - coverage below threshold does not activate
  - exactly one active embedding version after activation

**Expected results**
- Deterministic, repeatable embedding builds.

**Rollback hooks**
- Deactivate embedding version row (no data deletion) to make API return EMBEDDINGS_NOT_READY.

**Human-required**
- For staging/prod, set the real provider key in server environment only. CI continues to use stub.

### Wave 4: Online API /api/v1/soc/recommend (raw vector search + timeouts + degradation)

**Action**
- Add route handler `app/api/v1/soc/recommend/route.ts` (Node runtime if needed).
- Gate with `FEATURE_SOC_RECOMMENDER`:
  - if off, return 404.
- Auth and rate limit:
  - reuse the same auth and rate limit helpers used by `/api/v1/lookup` (from repo map).
- Validate input:
  - dutiesText required, trim, cap length (e.g. 8000 chars)
  - do not log plaintext dutiesText
- Load active embedding version:
  - if none, return 503 `{ code: "EMBEDDINGS_NOT_READY" }`
- Generate query embedding using provider.
- Vector search implementation (critical):
  - must run inside `prisma.$transaction(async (tx) => { ... })`
  - `SET LOCAL statement_timeout = '<ms>ms'` inside the transaction
  - run raw SQL using `$queryRaw` with cosine distance operator `<=>`
  - limit to `SOC_RECOMMEND_INTERNAL_TOPK`
- Compute similarity for UI:
  - `similarity = clamp(1 - (distance / 2), 0, 1)`
- Build Top 6 output O*NET codes.
- Enrichment, best-effort and independently degradable:
  - duties:
    - query OnetDuty with datasetVersionId = embeddingVersion.onetDatasetVersionId
    - return first 3 to 5 duty lines and total count
  - onet title:
    - query OnetOccupation/title table using embeddingVersion.onetDatasetVersionId
  - wages:
    - derive socCode from onetCode truncation
    - query WageRate for active OFLC dataset version
    - request needs wageYear (string) + isAcwia + areaCode
    - if wage context missing: wageAvailable=false, wageSource="NONE"
    - optional national fallback:
      - if WAGE_NATIONAL_AREA_CODE is set and local wage not found, try that areaCode
      - set wageSource="NATIONAL" when used
- Enrichment timeout:
  - implement withTimeout wrapper and run duties and wage enrichment with independent timeouts
  - use Promise.allSettled, never Promise.all
- Deterministic timeout testing hooks:
  - in the vector search transaction, if `NODE_ENV=test` and `TEST_INJECT_DB_SLEEP_MS` is set, execute `SELECT pg_sleep(...)` after SET LOCAL to deterministically trigger timeout
  - in duties/wage enrichment, if `NODE_ENV=test` and `TEST_INJECT_ENRICHMENT_DELAY_MS` is set, delay to deterministically trigger enrichment timeout

**Why**
- statement_timeout must be real and testable, otherwise DB safety is wishful thinking.
- Raw SQL is mandatory for vector ops under Prisma.
- Degradation behavior prevents partial failures from breaking the core recommendation flow.

**Tests (must pass)**
- Integration tests (stub provider + seeded DB):
  - feature off returns 404
  - missing dutiesText returns 400
  - no active embedding version returns 503 with code
  - success returns <=6 items and matches response schema types:
    - wageYear is string or null
    - wageDataQualityNotes is object or null
  - missing wage context returns 200 with wageAvailable=false, wageSource="NONE"
  - wage query throws, still returns items with warnings and wageAvailable=false
  - statement_timeout returns 504 (deterministic via TEST_INJECT_DB_SLEEP_MS)
  - enrichment timeout returns items with meta.enrichment.skippedReason="TIMEOUT"
  - auth behavior parity with `/api/v1/lookup` (public vs non-public ACCESS_MODE)

**Expected results**
- API is stable, safe under load, and its guardrails are provably active.

**Rollback hooks**
- Disable `FEATURE_SOC_RECOMMENDER` for instant 404.
- Deactivate embedding version for 503 EMBEDDINGS_NOT_READY.

### Wave 5: UI SocRecommendStep + Playwright E2E (desktop + mobile + sticky)

**Action**
- Add UI component SocRecommendStep.tsx (actual path per repo map):
  - textarea for dutiesText
  - submit calls `/api/v1/soc/recommend`
  - renders Top 6 cards
- Card content:
  - header: matchedOnetCode + matchedOnetTitle
  - match strength: show similarity as percent, label as "Match strength"
  - duties preview:
    - desktop: show up to 6 with truncation, allow expand to view all
    - mobile: collapsed by default, allow expanding only one card at a time
  - wage preview (L1):
    - show both hourly and annual when available, e.g. $45.50/hr | $94,640/yr
    - show SOC code label, e.g. SOC 15-1252 wage
    - show data quality badge if wageHasDataQualityIssue=true
- Selection behavior:
  - clicking "Select" writes matchedOnetCode (O*NET-8) into the main form input
  - sticky banner shows selected O*NET-8 code and title
  - write URL param focusOnet=<code> for refresh persistence
  - manual edits to the main input clear sticky state and remove URL param
  - refresh restores banner from URL param but does not overwrite whatever value the form currently has (avoid fighting browser restore)
- Ensure client feature flag `NEXT_PUBLIC_FEATURE_SOC_RECOMMENDER` hides UI when off.

**Why**
- Keeps workflow inline, reduces navigation complexity.
- Sticky selection is an anti-mistake affordance, even for expert users.
- Mobile behavior prevents the Top 6 UI from becoming unusable.

**Tests (must pass)**
- Playwright E2E (mock API, no backend dependency):
  - shows 6 cards after search
  - selecting a card writes O*NET-8 into the main form input
  - banner appears and URL includes focusOnet
  - refresh restores banner from URL, but does not overwrite the form value
  - manual input edit clears banner and removes focusOnet
  - mobile viewport:
    - cards render in single column
    - duties collapsed by default
    - only one card expandable
    - wage display shows hourly + annual
    - data quality badge visible when flagged

**Expected results**
- UI works deterministically and does not regress the main flow when flags are off.

**Rollback hooks**
- Disable client and server flags; UI disappears and API returns 404.

### Wave 6 (Optional): Vector index + Redis cache

**Action**
- Add `scripts/admin/add_onet_vector_index.ts`:
  - detect pgvector version
  - create cosine index with HNSW if available, otherwise IVFFlat
- Optional Redis caching (server-side only):
  - key must include embeddingVersionId and oflcDatasetVersionId:  
    `soc:rec:v1:{embeddingVersionId}:{oflcDatasetVersionId}:{areaCodeOrNone}:{wageYearOrNone}:{isAcwia}:{sha256(truncatedDutiesText)}`
  - never store plaintext dutiesText
  - TTL configurable

**Why**
- Performance optimization, not required for correctness.
- Cache key must include dataset version IDs to avoid stale wage mismatches.

**Tests (must pass if implemented)**
- Unit tests:
  - cache key includes required dimensions
  - cached payload contains no plaintext dutiesText

**Expected results**
- Better tail latency under load, safe cache invalidation semantics.

**Rollback hooks**
- Disable Redis env or caching flag; system falls back to uncached behavior.

## 8) Risks and Mitigations
- Risk: CI lacks pgvector, integration tests fail. Mitigation: use a Postgres image in CI that includes pgvector, or install extension in test setup if permitted. If impossible, mark vector integration tests as "requires pgvector" and run them in staging pipeline.
- Risk: statement_timeout accidentally applied outside transaction, becomes ineffective. Mitigation: encapsulate vector search in one function that always uses interactive $transaction and sets SET LOCAL inside; keep deterministic timeout test via TEST_INJECT_DB_SLEEP_MS so regressions are caught immediately.
- Risk: Dataset drift between embeddings and active O*NET duties. Mitigation: always enrich duties using embeddingVersion.onetDatasetVersionId; add a warning if active O*NET dataset version differs from embeddingVersion.onetDatasetVersionId.
- Risk: Wage context missing leads to confusing "no wage" cards. Mitigation: explicitly set wageAvailable=false and wageSource="NONE"; UI copy indicates wage preview requires areaCode and wageYear unless national fallback is enabled and documented.

## 9) Alternatives Considered
- Runtime-configurable embedding dimension. Rejected: pgvector column dimension is fixed by schema; runtime config would fail at write time. Correct approach is a new migration and rebuild.
- Return SOC-6 as primary selection entity. Rejected: the user selection object and duties specificity are O*NET-8; we still derive SOC-6 for wages without losing O*NET-8 selection fidelity.

## 10) Acceptance Criteria (testable)
- When both flags are off, no runtime behavior changes, API returns 404, UI hidden.
- Every wave’s tests pass before proceeding.
- Exactly one active embedding version at a time.
- Compute script is idempotent and resumable.
- Coverage threshold uses eligible set (O*NET codes with duties).
- API returns <=6 items.
- wageYear is string; wageDataQualityNotes is object.
- statement_timeout and enrichment timeout paths are deterministically testable.
- Auth parity with `/api/v1/lookup`.
- Selecting a card writes O*NET-8 into the form.
- Sticky banner and URL param behaviors correct on refresh and manual edits.
- Mobile collapsed duties behavior correct.

## 11) Automated Test Workflow (Local + CI)

**Prereqs**
- DB includes pgvector (for integration tests).
- Feature flags are controlled per test (see `setEnv()` usage in tests).
- For automation, use stub embeddings to avoid API cost.

**Recommended order**
```bash
pnpm test:unit
pnpm test:integration
pnpm test:e2e
pnpm test:coverage
pnpm test
```

**Artifacts**
- Coverage report: `coverage/`
- Playwright traces/screenshots: `test-results/` (only on failure)

**SOC recommender coverage map**
- Unit: `tests/unit/{embeddings,embeddings/provider*,embeddings/embedBatch}.test.ts`
- Unit: `tests/unit/{duties,lookup,geocoder}.test.ts` (shared helpers)
- Integration: `tests/integration/{socRecommend,computeEmbeddings,matchCombined}.test.ts`
- E2E: `e2e/wave*.spec.ts` (cards, banner, wage quality, mobile behavior)

## 12) Manual Test Plan (Staging)
- DB readiness: confirm pgvector installed with:

```sql
SELECT extname FROM pg_extension WHERE extname = 'vector';
```

- Build embeddings (staging): set server env for embedding provider; run compute script; expect coverage >= threshold; expect new embedding version becomes active.
- API smoke: enable server flag `FEATURE_SOC_RECOMMENDER=true`; POST /api/v1/soc/recommend with dutiesText, wageYear (string), areaCode, isAcwia; expect 200, <=6 items, and wageLevel1Hourly + wageLevel1Annual present when WageRate exists.
- UI smoke: enable client flag `NEXT_PUBLIC_FEATURE_SOC_RECOMMENDER=true`; paste duties, get 6 cards; select a card, form updated with O*NET-8; edit form manually, banner clears.
- Rollback drill: disable flags, verify UI hidden and API 404.

## 13) Rollback Plan
- Fast rollback (seconds):
  - FEATURE_SOC_RECOMMENDER=false
  - NEXT_PUBLIC_FEATURE_SOC_RECOMMENDER=false
  - Expected: API 404, UI hidden, no impact on lookup.
- Embeddings rollback (minutes):
  - Set current active embedding version to inactive.
  - Expected: API returns 503 EMBEDDINGS_NOT_READY.
- Optional: disable enrichment only (if implemented as separate flag).
  - Expected: base recommendations return without duties/wages.

## Appendix A: Codex Execution Prompts (Wave-by-wave)

IMPORTANT: After each wave:
- Run all tests defined for that wave.
- If failing, fix immediately and re-run.
- Only proceed when green.

### Prompt Wave 0
```
Implement Wave 0 exactly as described in docs/soc-recommender-implementation.md. Create/update the spec doc, update .env.example, and generate docs/repo-map-soc-recommender.md with exact file paths and helper names for auth, rate limit, dataset versions, and the form page. Do not change runtime behavior. Run build and existing tests.
```

### Prompt Wave 1
```
Implement Wave 1. Add Prisma models and migrations for OnetEmbeddingVersion and OnetDutyEmbedding with embedding Unsupported('vector(3072)'). Add scripts/admin/check_pgvector.ts. Add integration tests verifying pgvector works and single-active constraint is enforced. Run all tests and build.
```

### Prompt Wave 2
```
Implement Wave 2. Add embedding utilities with fixed EMBEDDING_DIM=3072 (no env override), providerStub, document builder, and exhaustive unit tests for all edge cases. Run unit tests.
```

### Prompt Wave 3
```
Implement Wave 3. Add compute_onet_embeddings script with advisory lock, idempotent upserts, resumable behavior, coverage threshold with denominator defined as O*NET codes that have duties. Add integration tests for idempotency, resume after failure, and activation gating. Run all tests.
```

### Prompt Wave 4
```
Implement Wave 4. Add /api/v1/soc/recommend route with feature flag, auth reuse, rate limit reuse, and raw SQL vector search via $queryRaw. Ensure statement_timeout is set with SET LOCAL inside the same interactive $transaction. Add duties and wages enrichment with Promise.allSettled and withTimeout wrappers. Add deterministic test injection hooks TEST_INJECT_DB_SLEEP_MS and TEST_INJECT_ENRICHMENT_DELAY_MS for timeout tests. Ensure wageYear is string and wageDataQualityNotes is JSON object. socTitle must come from OFLC dataset version. Add integration tests for all gating scenarios. Run all tests.
```

### Prompt Wave 5
```
Implement Wave 5. Add SocRecommendStep UI inline near the main ONET input. Render Top 6 cards, selection writes ONET-8 into the form, sticky banner persists via URL param focusOnet, clears on manual edits, restores banner on refresh without overriding form value. Add Playwright E2E tests including mobile viewport behavior, wage display hourly+annual, and data quality badge. Run E2E tests and build.
```

### Prompt Wave 6 (optional)
```
Implement Wave 6 optionally. Add vector index script and optional Redis caching keyed by embeddingVersionId + oflcDatasetVersionId + hashed dutiesText, never storing plaintext. Add unit tests for cache key composition and no-plaintext guarantee.
```
