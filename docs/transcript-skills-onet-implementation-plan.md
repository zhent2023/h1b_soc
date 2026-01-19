# Transcript-to-Skills-to-O*NET Matching Implementation Plan

**Target Executor**: Codex / AI Coding Agent  
**Last Updated**: 2026-01-16  
**Tech Stack**: Next.js App Router + Node/TypeScript + Neon Postgres (pgvector) + Gemini Embedding (3072d)

---

## Table of Contents

0. [Prerequisites](#0-prerequisites)
1. [Summary](#1-summary)
2. [Assumptions](#2-assumptions)
3. [Non-goals](#3-non-goals)
4. [Plan](#4-plan)
5. [Risks and Mitigations](#5-risks-and-mitigations)
6. [Alternatives Considered](#6-alternatives-considered)
7. [Acceptance Criteria](#7-acceptance-criteria)
8. [Manual Test Plan](#8-manual-test-plan)
9. [Rollback Plan](#9-rollback-plan)

---

## 0. Prerequisites

- Dependencies to install (add to `package.json`):
  - `@vercel/blob` (production blob storage provider)
  - `pdf-parse` (PDF text extraction; default choice for text-first parsing)
  - `@google/generative-ai` (Gemini OCR/multimodal) if not already present
- Update `.env.example` with new transcript-related feature flags and storage settings.
- Ensure O*NET Content Model data is available under `ONET_DATA_DIR` (default `./data/onet`):
  - Extract the O*NET database text release (ex: `db_30_1_text.zip`) into that directory.
  - Ingestion scripts should read Skills/Knowledge/Abilities files and their occupation linkage tables from this location.

---

## 1. Summary

### Current State

You have a production pipeline that matches daily tasks to O*NET codes via pgvector KNN on duty embeddings stored in Neon Postgres. The existing `OnetDutyEmbedding.embedding` column is `vector(3072)` and queries use the `<=>` operator (6).

### What This Plan Adds

A **parallel, skills-based pipeline** driven by transcript PDFs:

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐    ┌──────────────────┐
│ PDF Upload &    │───▶│ Course Title     │───▶│ Sparse Scoring  │───▶│ Optional RRF     │
│ OCR/Extraction  │    │ → SKA Mapping    │    │ → Occupations   │    │ Fusion w/Duties  │
└─────────────────┘    └──────────────────┘    └─────────────────┘    └──────────────────┘
```

1. **PDF Upload & Extraction**: Client uploads transcript PDF; backend extracts structured courses (title, credits, grade) using text extraction first, then OCR/multimodal fallback via Gemini (9).

2. **Course-to-SKA Translation**: Each course title is embedded with `gemini-embedding-001` (fixed 3072 dimensions) and mapped to standardized O*NET Content Model SKA (Skills, Knowledge, Abilities) via in-memory similarity scan against a small catalog (~150 items) (9).

3. **Sparse Occupation Scoring**: Use weighted coverage + match scoring against per-occupation SKA requirement weights to produce topN O*NET codes, plus evidence that traces `course → SKA → occupation`.

4. **Optional Fusion**: Fuse skills ranking with existing duties ranking using Reciprocal Rank Fusion (RRF), without changing existing duties endpoint behavior unless feature flags are enabled (6).

### Key Design Principles

| Principle | Implementation |
|-----------|----------------|
| **Explainability** | Every occupation match traces back through SKA to specific courses |
| **Audit-Ready** | Evidence tables with timestamps and version info |
| **Cost-Controlled** | Batch embedding + cache = 0-1 Gemini calls per transcript |
| **Timeout-Safe** | In-memory SKA scan, no per-course DB queries |
| **Safe Rollout** | Feature flags guarantee existing duties behavior unchanged |
| **No PDF Retention** | Delete transcript files after parsing; keep structured course data only |

---

## 2. Assumptions

| # | Assumption | Source | Verification |
|---|------------|--------|--------------|
| 1 | Backend is Node/TypeScript with Next.js App Router | (6)(9) | Check `package.json` |
| 2 | Route handlers use `runtime="nodejs"` | (6) | Check route.ts files |
| 3 | Database is Neon Postgres with pgvector enabled | (6) | Check `.env.local` for `POSTGRES_*` |
| 4 | Existing `OnetDutyEmbedding.embedding` is `vector(3072)` | (6) | Check `schema.prisma` |
| 5 | Duties queries use `<=>` operator | (6) | Check migration.sql |
| 6 | Embedding model is `gemini-embedding-001` | (9) | Check `.env.local` |
| 7 | Embedding output dimension is always 3072 | (9) | Smoke test validates |
| 8 | Transcript input is PDF from client | (9) | Product requirement |
| 9 | No browser extension involved | (9) | Product requirement |
| 10 | Transcript has only: title, credits, grade | (8)(9) | Typical format |
| 11 | Vercel timeout is 10-60s (not explicitly configured) | (6) | Check for `vercel.json` |

### Open Questions (Safe Defaults Provided)

1. **Vercel Plan Tier**: Default assumes Pro (60s). Add `export const maxDuration = 60` to heavy routes.
2. **Gemini PDF Support**: Smoke test included. Fallback to text extraction + LLM parse.
3. **Duties Embedding Model**: If different from `gemini-embedding-001`, keep separate retrieval paths.
4. **Transcript Ownership**: Require login for transcript uploads even when `ACCESS_MODE=public`; prompt users to sign in before upload.
5. **PDF Retention**: Default to delete blob immediately after parse; store only hash + metadata.

### Codebase Fit Notes (h1b_soc)

- API routes live under `app/api/v1` and use `getPrisma`, `requireAccess`, and `rateLimitOrThrow`.
- No TS path alias is configured; use relative imports (no `@/`).
- Embedding dimension validation already exists in `src/lib/embeddings/vectorUtils.ts`.
- Dataset versioning is centralized in `DatasetVersion`; SKA data should use a new `datasetName` (ex: `onet_ska`) and activate via `scripts/ingest/activate_dataset.ts`.
- Prefer `crypto.randomUUID()` over new ID deps like `nanoid`.

---

## 3. Non-goals

| Non-goal | Rationale |
|----------|-----------|
| Reuse duty embeddings as skills index | Different semantic spaces, even if same dimension (6) |
| Compress transcript into single averaged vector | Multi-topic averaging hurts precision and explainability |
| Introduce Redis, queues, or external vector DB | Keep simple; use batching + caching |
| Require course descriptions | Handle ambiguity via confidence + UX (9) |
| Guarantee 100% OCR accuracy | Provide human review step (9) |
| Change existing duties endpoint | All behind feature flags (6) |

---

## 4. Plan

### Step 1: Embedding Guard + Smoke Test (reuse existing utils)

**Files to Add/Update:**

```
scripts/smoke/check-embedding-dim.ts
package.json
```

**Action:**

The repo already validates embedding dimension in `src/lib/embeddings/vectorUtils.ts`,
and both Gemini/OpenAI providers call `validateVectorDimension`. Add a smoke script
that uses the existing provider factory so it stays aligned with runtime config.

Create `scripts/smoke/check-embedding-dim.ts`:

```typescript
import { createEmbeddingProviderFromEnv } from '../../src/lib/embeddings/providerFactory';
import { EMBEDDING_DIM } from '../../src/lib/embeddings/constants';
import { validateVectorDimension } from '../../src/lib/embeddings/vectorUtils';

const TEST_TEXT = 'College course title: Introduction to Computer Science';

async function main() {
  console.log('Running embedding dimension smoke test...');
  const provider = createEmbeddingProviderFromEnv();
  const [embedding] = await provider.embedDocuments([TEST_TEXT]);
  validateVectorDimension(embedding, EMBEDDING_DIM);
  console.log(`PASS: Dimension is ${embedding.length}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`FAIL: ${message}`);
  process.exit(1);
});
```

Add to `package.json`:

```json
{
  "scripts": {
    "smoke:embedding": "pnpm exec tsx scripts/smoke/check-embedding-dim.ts"
  }
}
```

**Why:**
- pgvector errors or produces garbage on dimension mismatch
- Fail-fast prevents silent data corruption
- Smoke test stays aligned with `EMBEDDING_PROVIDER`/`EMBEDDING_MODEL`

---

### Step 2: Database Schema Migration (Prisma + pgvector)

**Files to Update:**

```
prisma/schema.prisma
prisma/migrations/YYYYMMDD_add_skills_pipeline/migration.sql
scripts/ingest/activate_dataset.ts
```

**Action:**

Add new models in `schema.prisma` so they follow existing dataset-version patterns.
Skill catalog and requirements should be tied to a new `DatasetVersion`
(`datasetName = 'onet_ska'`) rather than a standalone version string.

```prisma
enum TranscriptStatus {
  CREATED
  UPLOADED
  PARSING
  NEEDS_REVIEW
  READY
  FAILED
}

model SkillCatalog {
  id               String   @id @default(uuid()) @db.Uuid
  datasetVersionId String   @db.Uuid
  skillId          String
  name             String
  description      String?
  taxonomyType     String
  embedding        Unsupported("vector(3072)")
  embeddingModelId String
  contentHash      String
  updatedAt        DateTime @updatedAt

  datasetVersion DatasetVersion @relation(fields: [datasetVersionId], references: [id], onDelete: Cascade)

  @@unique([datasetVersionId, skillId])
  @@index([datasetVersionId])
}

model OccupationSkaRequirement {
  id               String  @id @default(uuid()) @db.Uuid
  datasetVersionId String  @db.Uuid
  onetCode         String
  skillId          String
  importance       Float?
  level            Float?
  reqWeight        Float

  datasetVersion DatasetVersion @relation(fields: [datasetVersionId], references: [id], onDelete: Cascade)

  @@unique([datasetVersionId, onetCode, skillId])
  @@index([datasetVersionId, onetCode])
  @@index([datasetVersionId, skillId])
}

model CourseEmbeddingCache {
  courseTextHash   String   @id
  titleRaw         String
  embedding        Unsupported("vector(3072)")
  embeddingModelId String
  textPolicy       String
  updatedAt        DateTime @updatedAt
}

model Transcript {
  id              String            @id @default(uuid()) @db.Uuid
  userId          String            @db.Uuid
  status          TranscriptStatus  @default(CREATED)
  sourceFileHash  String?
  parserProvider  String?
  parserVersion   String?
  parseConfidence Float?
  createdAt       DateTime          @default(now())
  updatedAt       DateTime          @updatedAt

  user      User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  document  TranscriptDocument?
  courses   TranscriptCourse[]
  inferred  TranscriptInferredSka[]

  @@index([userId, createdAt])
}

// Update User model to add the reverse relation (no new column needed):
//   transcripts Transcript[]

model TranscriptDocument {
  transcriptId String   @id @db.Uuid
  storageUrl   String?
  deletedAt    DateTime?
  pageCount    Int?
  createdAt    DateTime @default(now())

  transcript Transcript @relation(fields: [transcriptId], references: [id], onDelete: Cascade)
}

model TranscriptCourse {
  transcriptId String   @db.Uuid
  courseKey    String
  title        String
  credits      Float?
  grade        String?
  rawLine      String?
  isUserEdited Boolean  @default(false)
  createdAt    DateTime @default(now())

  transcript Transcript          @relation(fields: [transcriptId], references: [id], onDelete: Cascade)
  inferred   TranscriptInferredSka[]

  @@id([transcriptId, courseKey])
}

// Note: courseKey is transcript-scoped and should incorporate normalized title
// plus optional credits/grade, rawLine, and index to avoid collisions on repeats.

model TranscriptInferredSka {
  transcriptId     String   @db.Uuid
  courseKey        String
  skillId          String
  matchScore       Float
  skillWeight      Float
  embeddingModelId String
  datasetVersionId String   @db.Uuid
  createdAt        DateTime @default(now())

  transcript Transcript       @relation(fields: [transcriptId], references: [id], onDelete: Cascade)
  course     TranscriptCourse @relation(fields: [transcriptId, courseKey], references: [transcriptId, courseKey], onDelete: Cascade)

  @@id([transcriptId, courseKey, skillId, embeddingModelId, datasetVersionId])
  @@index([transcriptId, skillId])
}
```

Update `DatasetVersion` to add relations (no new columns; uses existing `datasetName` to separate datasets):

```prisma
model DatasetVersion {
  id           String   @id @default(uuid()) @db.Uuid
  datasetName  String
  versionLabel String
  isActive     Boolean
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  // New relations for SKA datasets
  skillCatalog              SkillCatalog[]
  occupationSkaRequirements OccupationSkaRequirement[]
}
```

Update `scripts/ingest/activate_dataset.ts` to allow `datasetName = 'onet_ska'`.

**Why:**
- Keeps versioning aligned with existing datasets and activation tooling.
- Uses Prisma models + `Unsupported("vector(3072)")`, consistent with `OnetDutyEmbedding`.
- Evidence tables remain additive; cascade deletes preserve integrity.

---

### Step 3: Object Storage for PDF Uploads

**Files to Create:**

```
src/lib/storage/types.ts
src/lib/storage/index.ts
src/lib/storage/vercelBlobStore.ts
src/lib/storage/localDiskStore.ts
app/api/v1/transcripts/create/route.ts
app/api/v1/transcripts/[id]/complete-upload/route.ts
```

**Action:**

Create storage abstraction `src/lib/storage/types.ts`:

```typescript
export interface StorageProvider {
  createUploadUrl(params: {
    userId: string;
    transcriptId: string;
    contentType: string;
  }): Promise<{ uploadUrl: string; storageUrl: string }>;
  
  deleteObject(storageUrl: string): Promise<void>;
}
```

Use Vercel Blob for production and a local disk provider for development/tests.

Create `app/api/v1/transcripts/create/route.ts`:

```typescript
import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';

import { getPrisma } from '../../../../../src/db/prisma';
import { requireAccess } from '../../../../../src/lib/access';
import { rateLimitOrThrow } from '../../../../../src/lib/rateLimit';
import { storageProvider } from '../../../../../src/lib/storage';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(request: Request) {
  const prisma = getPrisma();
  const access = await requireAccess(request, prisma);
  if (access.source !== 'session') {
    return NextResponse.json({ error: 'Login required' }, { status: 401 });
  }
  await rateLimitOrThrow({ key: 'transcript_create', limitPerMin: 20, req: request });
  const user = await prisma.user.findUnique({ where: { email: access.email } });
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 401 });

  const transcriptId = randomUUID();

  await prisma.transcript.create({ data: { id: transcriptId, userId: user.id } });

  const { uploadUrl, storageUrl } = await storageProvider.createUploadUrl({
    userId: user.id,
    transcriptId,
    contentType: 'application/pdf',
  });

  await prisma.transcriptDocument.create({
    data: { transcriptId, storageUrl },
  });

  return NextResponse.json({ transcriptId, uploadUrl, storageUrl });
}
```

Add `complete-upload` to mark the transcript as UPLOADED and persist file metadata
(hash, page count if available). The PDF is deleted after parsing, so we only
keep metadata.
Apply `rateLimitOrThrow` to `create`, `complete-upload`, `process`, and all match endpoints.
Wrap all new route handlers in try/catch and mirror the `/soc/recommend` error mapping (RateLimitError, 4xx/5xx).
Enforce a maximum upload size using `TRANSCRIPT_MAX_BYTES` (default 10MB) via blob metadata checks and client-side validation.

**Why:**
- Direct upload avoids Vercel body limits (4.5MB)
- Optional file hashing enables PDF dedupe if desired
- Clean separation: create → upload → process
- No long-term PDF retention; delete after parsing
- Error handling: mirror `/soc/recommend` try/catch structure for consistent 4xx/5xx responses

---

### Step 4: PDF Extraction with Fallback Chain

**Files to Create:**

```
src/lib/transcripts/types.ts
src/lib/transcripts/providers/pdfTextProvider.ts
src/lib/transcripts/providers/geminiOcrProvider.ts
src/lib/transcripts/llmCourseParser.ts
app/api/v1/transcripts/[id]/process/route.ts
```

**Action:**

Create provider interface `src/lib/transcripts/types.ts`:

```typescript
export interface ParsedCourse {
  title: string;
  credits?: number;
  grade?: string;
  rawLine?: string;
}

export interface TranscriptParseResult {
  courses: ParsedCourse[];
  confidence: number;
  usedPath: 'pdf_text' | 'ocr' | 'multimodal';
}

export interface TranscriptParserProvider {
  providerId: string;
  version: string;
  parseFromUrl(storageUrl: string): Promise<TranscriptParseResult>;
}
```

Create process route `app/api/v1/transcripts/[id]/process/route.ts`:

```typescript
import { pdfTextProvider } from '../../../../../src/lib/transcripts/providers/pdfTextProvider';
import { geminiOcrProvider } from '../../../../../src/lib/transcripts/providers/geminiOcrProvider';

export const runtime = 'nodejs';
export const maxDuration = 60; // Extend timeout for OCR

const CONFIDENCE_THRESHOLD = 0.75;

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const prisma = getPrisma();
  const access = await requireAccess(request, prisma);
  if (access.source !== 'session') {
    return NextResponse.json({ error: 'Login required' }, { status: 401 });
  }
  await rateLimitOrThrow({ key: 'transcript_process', limitPerMin: 10, req: request });
  const user = await prisma.user.findUnique({ where: { email: access.email } });
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 401 });
  const transcript = await prisma.transcript.findUnique({ where: { id: params.id } });
  if (!transcript || transcript.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // 1. Update status to PARSING
  await prisma.transcript.update({
    where: { id: params.id },
    data: { status: 'PARSING' },
  });

  const doc = await prisma.transcriptDocument.findUnique({
    where: { transcriptId: params.id },
  });
  if (!doc || !doc.storageUrl) {
    return NextResponse.json({ error: 'Transcript document missing' }, { status: 404 });
  }

  // 2. Text-first parsing: fast local extraction
  let result = await pdfTextProvider.parseFromUrl(doc.storageUrl);

  // 3. Fallback to OCR if text extraction fails or is low-confidence
  if (result.confidence < 0.5 || result.courses.length === 0) {
    result = await geminiOcrProvider.parseFromUrl(doc.storageUrl);
  }

  // 4. Upsert courses with deterministic keys
  const courseData = result.courses.map((c, idx) => ({
    transcriptId: params.id,
    courseKey: computeCourseKey(c.title, c.credits, c.grade, c.rawLine, idx),
    title: c.title,
    credits: c.credits,
    grade: c.grade,
    rawLine: c.rawLine,
  }));

  // 5. Transaction: delete old, insert new, update status
  await prisma.$transaction([
    prisma.transcriptCourse.deleteMany({ where: { transcriptId: params.id } }),
    prisma.transcriptInferredSka.deleteMany({ where: { transcriptId: params.id } }),
    ...courseData.map((c) => prisma.transcriptCourse.create({ data: c })),
    prisma.transcript.update({
      where: { id: params.id },
      data: {
        status: result.confidence >= CONFIDENCE_THRESHOLD ? 'READY' : 'NEEDS_REVIEW',
        parseConfidence: result.confidence,
      },
    }),
    prisma.transcriptDocument.update({
      where: { transcriptId: params.id },
      data: { storageUrl: null, deletedAt: new Date() },
    }),
  ]);

  await storageProvider.deleteObject(doc.storageUrl);

  return NextResponse.json({ status: 'success', courseCount: result.courses.length });
}
```

Helper for stable course keys (handles missing values and repeats):

```typescript
function computeCourseKey(
  title: string,
  credits?: number,
  grade?: string,
  rawLine?: string,
  index?: number,
) {
  const normalized = normalizeCourseTitle(title);
  const creditsPart = credits ?? '';
  const gradePart = grade ?? '';
  const rawPart = rawLine ?? '';
  const indexPart = typeof index === 'number' ? index : '';
  // Use a longer slice to reduce collision risk while keeping keys short.
  return sha256(`${normalized}|${creditsPart}|${gradePart}|${rawPart}|${indexPart}`).slice(0, 24);
}
```

**Why:**
- Text-first parsing keeps OCR costs low while preserving a high-accuracy fallback
- Zod schema validation prevents LLM format errors
- `NEEDS_REVIEW` enables human correction
- `maxDuration = 60` extends Vercel timeout
- PDF deleted after parse; re-run requires re-upload
- Optional: wrap OCR calls with a timeout helper to avoid hanging parses

---

### Step 5: Transcript Review UI

**Files to Create:**

```
app/api/v1/transcripts/[id]/courses/update/route.ts
app/api/v1/transcripts/[id]/route.ts
app/transcripts/[id]/page.tsx
```

**Action:**

Create update route for course edits:

```typescript
// PATCH /api/v1/transcripts/[id]/courses/update
export async function PATCH(request: Request, { params }) {
  const prisma = getPrisma();
  const access = await requireAccess(request, prisma);
  const user = await prisma.user.findUnique({ where: { email: access.email } });
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 401 });
  const transcript = await prisma.transcript.findUnique({ where: { id: params.id } });
  if (!transcript || transcript.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const { courses } = await request.json();

  await prisma.$transaction([
    // Delete existing
    prisma.transcriptCourse.deleteMany({ where: { transcriptId: params.id } }),
    prisma.transcriptInferredSka.deleteMany({ where: { transcriptId: params.id } }),
    // Insert edited courses
    ...courses.map((c, idx) => prisma.transcriptCourse.create({
      data: {
        transcriptId: params.id,
        courseKey: computeCourseKey(c.title, c.credits, c.grade, c.rawLine, idx),
        title: c.title,
        credits: c.credits,
        grade: c.grade,
        rawLine: c.rawLine,
        isUserEdited: true,
      },
    })),
    // Update status
    prisma.transcript.update({
      where: { id: params.id },
      data: { status: 'READY' },
    }),
  ]);

  return NextResponse.json({ status: 'READY' });
}
```

Create React page with:
- Status banner (NEEDS_REVIEW / READY / PARSING)
- Editable course table (title, credits, grade)
- Action buttons: Save, Re-run Parsing, Compute Skills Match

Entry points:
- On the main recommend panel, add an "Upload Transcript (PDF)" control next to duties input.
- When upload completes, store `transcript_id` and show a link to `/transcripts/[id]` for review.
- Recommend button enables when duties text is non-empty OR transcript_id is present.

Security note:
- Every `/transcripts/[id]/...` route (GET, PATCH, process, compute-ska, delete) must enforce transcript ownership (`transcript.userId === user.id`).

**Why:**
- Human review is the most reliable OCR error mitigation (9)
- Evidence invalidation on edit ensures fresh SKA mapping
- Status-based UI guidance

---

### Step 6: O*NET SKA Ingestion Scripts

**Files to Create:**

```
scripts/ingest/ingest_onet_ska.ts
scripts/ingest/ingest_onet_ska_requirements.ts
```

**Data source:**
- Use the official O*NET Database text release (ex: `db_30_1_text.zip`).
- Extract the archive into `ONET_DATA_DIR` (default `./data/onet`).
- Ingestion scripts should read Skills/Knowledge/Abilities descriptors plus the occupation linkage/importance/level tables from that directory.
- Before implementing parsers, inspect the extracted filenames; map to the exact O*NET file names present (they can vary slightly by release).

**Action:**

Use a local chunking helper inside the ingest script (or switch to the shared
`embedBatch` helper once Step 7 is complete).

Create `scripts/ingest/ingest_onet_ska.ts`:

```typescript
// Usage: pnpm exec tsx scripts/ingest/ingest_onet_ska.ts --label ONET_29_1

async function main() {
  // 1. Load O*NET Skills.txt, Knowledge.txt, Abilities.txt
  const items = [...parseSkills(), ...parseKnowledge(), ...parseAbilities()];

  // 2. Create dataset version (datasetName = 'onet_ska')
  const datasetVersion = await prisma.datasetVersion.create({
    data: { datasetName: 'onet_ska', versionLabel, isActive: false },
  });

  // 3. Check existing via content_hash to skip unchanged (same datasetVersionId)
  const existing = await prisma.skillCatalog.findMany({
    where: { datasetVersionId: datasetVersion.id },
    select: { skillId: true, contentHash: true },
  });

  // 3. Filter items needing embedding
  const toEmbed = items.filter((i) => !existingHashes.has(computeHash(i)));

  // 4. Batch embed with existing embedding provider
  const provider = createEmbeddingProviderFromEnv();
  const texts = toEmbed.map((i) => `O*NET ${i.type}: ${i.name}. Definition: ${i.description}`);
  const embeddings = await embedInChunks(provider, texts, 64);

  // 5. Upsert to SkillCatalog
  for (let i = 0; i < toEmbed.length; i++) {
    const vectorLiteral = toVectorLiteral(embeddings[i]);
    await prisma.$executeRawUnsafe(
      'INSERT INTO "SkillCatalog" ("id","datasetVersionId","skillId","name","description","taxonomyType","embedding","embeddingModelId","contentHash","updatedAt") VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::vector, $8, $9, NOW()) ON CONFLICT ("datasetVersionId","skillId") DO UPDATE SET "name" = EXCLUDED."name", "description" = EXCLUDED."description", "taxonomyType" = EXCLUDED."taxonomyType", "embedding" = EXCLUDED."embedding", "embeddingModelId" = EXCLUDED."embeddingModelId", "contentHash" = EXCLUDED."contentHash", "updatedAt" = NOW()',
      randomUUID(),
      datasetVersion.id,
      toEmbed[i].id,
      toEmbed[i].name,
      toEmbed[i].description ?? null,
      toEmbed[i].type,
      vectorLiteral,
      provider.model,
      computeHash(toEmbed[i]),
    );
  }
}
```

Create `scripts/ingest/ingest_onet_ska_requirements.ts`:

```typescript
// Normalizes weights so sum(req_weight) per occupation ≈ 1.0

async function main() {
  // 1. Load occupation-SKA relationships
  const records = parseOccupationSkaFiles();

  // 2. Group by occupation
  const byOcc = groupBy(records, 'onetCode');

  // 3. Calculate and normalize weights
  for (const [onetCode, items] of byOcc) {
    const rawWeights = items.map((i) => (i.importance ?? 1) * (i.level ?? 1));
    const total = sum(rawWeights);
    
    for (let i = 0; i < items.length; i++) {
      const reqWeight = total > 0 ? rawWeights[i] / total : 0;
      await prisma.$executeRaw`INSERT INTO "OccupationSkaRequirement" ...`;
    }
  }
}
```

Add to `package.json`:

```json
{
  "scripts": {
    "ingest:onet-ska": "pnpm exec tsx scripts/ingest/ingest_onet_ska.ts",
    "ingest:onet-ska-reqs": "pnpm exec tsx scripts/ingest/ingest_onet_ska_requirements.ts"
  }
}
```

**Why:**
- Versioned ingestion supports audit reproducibility (11)
- `content_hash` makes ingestion idempotent
- Normalized weights enable interpretable coverage scoring
 - Use `activate_dataset` to mark the active `onet_ska` version

---

### Step 7: Provider-Agnostic Embedding Batching + Normalization

**Files to Create:**

```
src/lib/embeddings/embedBatch.ts
src/lib/text/normalizeCourseTitle.ts
```

**Action:**

Create `src/lib/embeddings/embedBatch.ts`:

```typescript
import type { EmbeddingProvider } from './types';

export async function embedBatch(
  provider: EmbeddingProvider,
  texts: string[],
  batchSize = 64,
): Promise<number[][]> {
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const embeddings = await provider.embedDocuments(batch);
    results.push(...embeddings);
  }
  return results;
}
```

Create `src/lib/text/normalizeCourseTitle.ts`:

```typescript
export function normalizeCourseTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/\b(fall|spring|summer|winter)\s*\d{2,4}\b/gi, '')
    .replace(/\bsec(tion)?\s*[a-z0-9]+\b/gi, '')
    .replace(/\(honors?\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isGenericTitle(title: string): boolean {
  const normalized = normalizeCourseTitle(title);
  return normalized.length < 5 || /^(seminar|lab|practicum|thesis)$/i.test(normalized);
}
```

**Why:**
- Batching keeps request count low and fits Vercel timeouts.
- Provider-agnostic helper aligns with existing embedding factory.
- Normalization improves cache hit rate for common course titles.

---

### Step 8: Course Embedding Cache

**Files to Create:**

```
src/lib/courses/getCourseEmbeddings.ts
```

**Action:**

```typescript
const TEXT_POLICY = 'title_only_v1';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function getCourseEmbeddings(
  courses: { courseKey: string; title: string }[]
): Promise<Map<string, { embedding: number[]; cacheHit: boolean }>> {
  const prisma = getPrisma();
  const provider = createEmbeddingProviderFromEnv();

  // 1. Compute hashes
  const coursesWithHash = courses.map((c) => ({
    ...c,
    normalized: normalizeCourseTitle(c.title),
    courseText: `College course title: ${normalizeCourseTitle(c.title)}`,
    hash: sha256(`College course title: ${normalizeCourseTitle(c.title)}\n${provider.model}\n${TEXT_POLICY}`).slice(0, 32),
  }));

  // 2. Single query for all cache hits
  const cached = await prisma.$queryRaw`
    SELECT "courseTextHash", "embedding"::text
    FROM "CourseEmbeddingCache"
    WHERE "courseTextHash" = ANY(${coursesWithHash.map((c) => c.hash)})
  `;

  const cacheMap = new Map(cached.map((r) => [r.courseTextHash, JSON.parse(r.embedding)]));

  // 3. Find misses
  const misses = coursesWithHash.filter((c) => !cacheMap.has(c.hash));

  // 4. Single batch embed for misses
  if (misses.length > 0) {
    const embeddings = await embedBatch(provider, misses.map((m) => m.courseText));
    
    for (let i = 0; i < misses.length; i++) {
      cacheMap.set(misses[i].hash, embeddings[i]);
      // Async cache write (don't block)
      const vectorLiteral = toVectorLiteral(embeddings[i]);
      prisma.$executeRawUnsafe(
        'INSERT INTO "CourseEmbeddingCache" ("courseTextHash","titleRaw","embedding","embeddingModelId","textPolicy","updatedAt") VALUES ($1, $2, $3::vector, $4, $5, NOW()) ON CONFLICT ("courseTextHash") DO NOTHING',
        misses[i].hash,
        misses[i].title,
        vectorLiteral,
        provider.model,
        TEXT_POLICY,
      );
    }
  }

  // 5. Return results mapped to courseKey
  const results = new Map();
  for (const c of coursesWithHash) {
    results.set(c.courseKey, {
      embedding: cacheMap.get(c.hash),
      cacheHit: cached.some((r) => r.courseTextHash === c.hash),
    });
  }
  return results;
}
```

**Why:**
- Single SQL + single batch = optimal for timeouts
- Title repetition means high cache hit rate
- Fire-and-forget writes don't block response

---

### Step 9: Course → SKA In-Memory Mapping

**Files to Create:**

```
src/lib/ska/skillCatalogCache.ts
src/lib/ska/similarity.ts
src/lib/ska/mapCoursesToSka.ts
app/api/v1/transcripts/[id]/compute-ska/route.ts
```

**Action:**

Create `src/lib/ska/skillCatalogCache.ts`:

```typescript
let cache: { entries: SkillEntry[]; loadedAt: Date; datasetVersionId: string } | null = null;
const TTL_MS = 10 * 60 * 1000;

export async function loadSkillCatalog(): Promise<{ entries: SkillEntry[]; datasetVersionId: string }> {
  if (cache && Date.now() - cache.loadedAt.getTime() < TTL_MS) {
    return { entries: cache.entries, datasetVersionId: cache.datasetVersionId };
  }

  const datasetVersion = await prisma.datasetVersion.findFirst({
    where: { datasetName: 'onet_ska', isActive: true },
    select: { id: true },
  });
  if (!datasetVersion) {
    throw new Error('Active O*NET SKA dataset version not found.');
  }

  const rows = await prisma.$queryRaw`
    SELECT "skillId", "name", "taxonomyType", "embedding"::text
    FROM "SkillCatalog"
    WHERE "datasetVersionId" = ${datasetVersion.id}
  `;

  const entries = rows.map((r) => ({
    skillId: r.skillId,
    name: r.name,
    embedding: new Float32Array(JSON.parse(r.embedding)),
    magnitude: computeMagnitude(r.embedding),
  }));

  cache = { entries, loadedAt: new Date(), datasetVersionId: datasetVersion.id };
  return { entries, datasetVersionId: datasetVersion.id };
}
```

Create `src/lib/ska/similarity.ts`:

```typescript
export function computeMagnitude(vec: ArrayLike<number>) {
  let sum = 0;
  for (let i = 0; i < vec.length; i += 1) {
    const v = vec[i] ?? 0;
    sum += v * v;
  }
  return Math.sqrt(sum);
}

export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>) {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let aMag = 0;
  let bMag = 0;
  for (let i = 0; i < len; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    aMag += av * av;
    bMag += bv * bv;
  }
  const denom = Math.sqrt(aMag) * Math.sqrt(bMag);
  return denom > 0 ? dot / denom : 0;
}

export function topK(scores: number[], k: number, threshold: number) {
  return scores
    .map((score, index) => ({ score, index }))
    .filter((entry) => entry.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
```

Create `src/lib/ska/mapCoursesToSka.ts`:

```typescript
const TOP_K = 10;
const THRESHOLD = 0.75;

export async function mapCoursesToSka(
  transcriptId: string,
  courses: { courseKey: string; title: string; embedding: number[]; embeddingModelId: string; credits?: number; grade?: string }[]
): Promise<InferredSka[]> {
  const { entries: skills, datasetVersionId } = await loadSkillCatalog();
  const results: InferredSka[] = [];

  for (const course of courses) {
    if (isGenericTitle(course.title)) continue;

    // Compute cosine similarity with all skills (in-memory)
    const scores = skills.map((s) => cosineSimilarity(course.embedding, s.embedding));

    // Get top K above threshold
    const topMatches = topK(scores, TOP_K, THRESHOLD);

    for (const match of topMatches) {
      const skill = skills[match.index];
      const weight = match.score * getCreditsWeight(course.credits) * getGradeWeight(course.grade);

      results.push({
        transcriptId,
        courseKey: course.courseKey,
        skillId: skill.skillId,
        matchScore: match.score,
        skillWeight: weight,
        datasetVersionId,
        embeddingModelId: course.embeddingModelId,
      });
    }
  }

  // Batch upsert evidence
  await prisma.$transaction(
    results.map((r) => prisma.transcriptInferredSka.upsert({ ... }))
  );

  return results;
}
```

Grade/credits weighting helpers (MVP defaults):

```typescript
function getCreditsWeight(credits?: number) {
  if (!credits || credits <= 0) return 1;
  // Normalize around 3-credit courses, clamp to avoid extremes.
  return Math.min(1.5, Math.max(0.5, credits / 3));
}

function getGradeWeight(grade?: string) {
  if (!grade) return 1;
  const normalized = grade.trim().toUpperCase();
  if (normalized === 'P' || normalized === 'PASS') return 1;
  if (normalized === 'F' || normalized === 'FAIL') return 0.2;

  const letterMap: Record<string, number> = {
    A: 1.0,
    'A-': 0.95,
    B: 0.85,
    'B+': 0.9,
    'B-': 0.8,
    C: 0.7,
    'C+': 0.75,
    'C-': 0.65,
    D: 0.5,
  };
  if (letterMap[normalized] !== undefined) return letterMap[normalized];

  const numeric = Number(normalized.replace(/[^\d.]/g, ''));
  if (Number.isFinite(numeric)) {
    if (numeric <= 4) {
      return Math.min(1, Math.max(0.2, numeric / 4));
    }
    if (numeric <= 100) {
      return Math.min(1, Math.max(0.2, numeric / 100));
    }
  }
  return 1;
}
```

Create `app/api/v1/transcripts/[id]/compute-ska/route.ts`:

```typescript
export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const prisma = getPrisma();
  const access = await requireAccess(request, prisma);
  await rateLimitOrThrow({ key: 'transcript_compute_ska', limitPerMin: 10, req: request });
  const user = await prisma.user.findUnique({ where: { email: access.email } });
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 401 });
  const transcript = await prisma.transcript.findUnique({ where: { id: params.id } });
  if (!transcript || transcript.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (transcript.status !== 'READY') {
    return NextResponse.json({ error: 'Transcript not ready' }, { status: 400 });
  }

  const courses = await prisma.transcriptCourse.findMany({
    where: { transcriptId: params.id },
    select: { courseKey: true, title: true, credits: true, grade: true, rawLine: true },
  });

  const embeddings = await getCourseEmbeddings(
    courses.map((c) => ({ courseKey: c.courseKey, title: c.title })),
  );

  const provider = createEmbeddingProviderFromEnv();
  const enrichedCourses = courses.map((c) => {
    const entry = embeddings.get(c.courseKey);
    return {
      courseKey: c.courseKey,
      title: c.title,
      credits: c.credits ?? undefined,
      grade: c.grade ?? undefined,
      embedding: entry?.embedding ?? [],
      embeddingModelId: provider.model,
    };
  });

  const results = await mapCoursesToSka(params.id, enrichedCourses);
  return NextResponse.json({ evidenceCount: results.length });
}
```

**Why:**
- ~150 skills = in-memory scan faster than 40 DB KNN queries
- Avoids Neon connection pressure (5)(6)
- Evidence table is the audit backbone
- Cache note: in serverless/multi-worker deployments each instance maintains its own SKA cache; cold starts reload, which is acceptable for ~150 entries.

---

### Step 10: Skills-Only Occupation Scoring

**Files to Create:**

```
src/lib/ska/occupationRequirementsCache.ts
src/lib/ska/scoreOccupations.ts
app/api/v1/match/skills/route.ts
```

**Action:**

Create `src/lib/ska/occupationRequirementsCache.ts`:

```typescript
let cache: { entries: Map<string, OccupationRequirement[]>; loadedAt: Date; datasetVersionId: string } | null = null;
const TTL_MS = 10 * 60 * 1000;
type OccupationRequirement = { skillId: string; reqWeight: number };

export async function loadOccupationRequirements(): Promise<Map<string, OccupationRequirement[]>> {
  if (cache && Date.now() - cache.loadedAt.getTime() < TTL_MS) {
    return cache.entries;
  }

  const datasetVersion = await prisma.datasetVersion.findFirst({
    where: { datasetName: 'onet_ska', isActive: true },
    select: { id: true },
  });
  if (!datasetVersion) {
    throw new Error('Active O*NET SKA dataset version not found.');
  }

  const rows = await prisma.occupationSkaRequirement.findMany({
    where: { datasetVersionId: datasetVersion.id },
    select: { onetCode: true, skillId: true, reqWeight: true },
  });

  const map = new Map<string, OccupationRequirement[]>();
  for (const row of rows) {
    const bucket = map.get(row.onetCode) ?? [];
    bucket.push({ skillId: row.skillId, reqWeight: row.reqWeight });
    map.set(row.onetCode, bucket);
  }

  cache = { entries: map, loadedAt: new Date(), datasetVersionId: datasetVersion.id };
  return map;
}
```

Create `src/lib/ska/scoreOccupations.ts`:

```typescript
const TAU = 0.6; // Saturation parameter

export async function scoreOccupations(
  transcriptId: string,
  topN: number = 6
): Promise<OccupationScore[]> {
  // 1. Load evidence and aggregate user skill weights
  const evidence = await prisma.transcriptInferredSka.findMany({
    where: { transcriptId },
  });

  const userSkillMap = new Map<string, number>();
  for (const e of evidence) {
    const current = userSkillMap.get(e.skillId) || 0;
    userSkillMap.set(e.skillId, current + e.skillWeight);
  }

  // Keep top 50 skills by weight
  const topSkills = [...userSkillMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50);

  // 2. Load occupation requirements (cached)
  const occReqs = await loadOccupationRequirements();

  // 3. Score each occupation
  const scores: OccupationScore[] = [];

  for (const [onetCode, reqs] of occReqs) {
    let coverage = 0;
    let match = 0;
    const contributingSkills: ContributingSka[] = [];

    for (const req of reqs) {
      const userWeight = userSkillMap.get(req.skillId) || 0;
      const sat = Math.min(1, userWeight / TAU);
      
      coverage += req.reqWeight * sat;
      match += req.reqWeight * userWeight;

      if (userWeight > 0) {
        contributingSkills.push({
          skillId: req.skillId,
          contribution: req.reqWeight * userWeight,
        });
      }
    }

    const final = 0.7 * coverage + 0.3 * match;

    scores.push({
      onetCode,
      final,
      coverage,
      match,
      topContributingSkills: contributingSkills.sort((a, b) => b.contribution - a.contribution).slice(0, 5),
    });
  }

  return scores.sort((a, b) => b.final - a.final).slice(0, topN);
}
```

Create `app/api/v1/match/skills/route.ts`:

```typescript
export async function POST(request: Request) {
  const prisma = getPrisma();
  await requireAccess(request, prisma);
  await rateLimitOrThrow({ key: 'match_skills', limitPerMin: 30, req: request });
  const { transcript_id, top_n = 6 } = await request.json();
  const safeTopN = Math.max(1, Math.min(6, Number(top_n) || 6));

  // Verify transcript is READY
  const transcript = await prisma.transcript.findUnique({ where: { id: transcript_id } });
  if (transcript?.status !== 'READY') {
    return NextResponse.json({ error: 'Transcript not ready' }, { status: 400 });
  }

  const results = await scoreOccupations(transcript_id, safeTopN);

  // Enrich with evidence
  const enriched = await Promise.all(
    results.map(async (r) => ({
      ...r,
      supportingCourses: await getSupportingCourses(transcript_id, r.topContributingSkills),
    }))
  );

  return NextResponse.json({ occupations: enriched });
}
```

**Why:**
- Sparse scoring preserves multi-topic information
- Coverage = interpretable as "% of occupation requirements met"
- Evidence enrichment for explainability

---

### Step 11: Combined Fusion with Duties

**Files to Create:**

```
src/lib/match/dutiesMatch.ts
app/api/v1/match/combined/route.ts
```

**Action:**

Refactor the duties KNN logic out of `app/api/v1/soc/recommend/route.ts` into
`src/lib/match/dutiesMatch.ts` so both endpoints share the same implementation.

**API strategy:**
- Short term: keep `/api/v1/soc/recommend` unchanged for duties-only flows.
- New `/api/v1/match/combined` serves duties-only, transcript-only, and fused flows.
- Future (optional): let `/api/v1/soc/recommend` delegate internally to `match/combined` behind a feature flag.

```typescript
// Feature flags
const FEATURE_SKILL_MATCHING = process.env.FEATURE_SKILL_MATCHING === 'true';
const FEATURE_MATCH_FUSION = process.env.FEATURE_MATCH_FUSION === 'true';

export async function POST(request: Request) {
  const prisma = getPrisma();
  await requireAccess(request, prisma);
  await rateLimitOrThrow({ key: 'match_combined', limitPerMin: 30, req: request });
  const { dutiesText, transcript_id, top_n = 6 } = await request.json();
  const safeTopN = Math.max(1, Math.min(6, Number(top_n) || 6));

  // 1. Always call existing duties matcher (unchanged)
  const dutiesResult = await matchDuties({ prisma, dutiesText, topN: safeTopN });

  // 2. Optionally call skills matcher
  let skillsResult = null;
  if (FEATURE_SKILL_MATCHING && transcript_id) {
    const transcript = await prisma.transcript.findUnique({ where: { id: transcript_id } });
    
    if (transcript?.status === 'READY') {
      skillsResult = await scoreOccupations(transcript_id, safeTopN);
    }
  }

  // 3. If fusion disabled or no skills, return duties only
  if (!FEATURE_MATCH_FUSION || !skillsResult) {
    return NextResponse.json({
      results: dutiesResult.map((d, i) => ({ ...d, final_rank: i + 1, source: 'duties' })),
      fusion_applied: false,
    });
  }

  // 4. RRF Fusion
  const K = 60;
  const dutiesRank = new Map(dutiesResult.map((d, i) => [d.onet_code, i + 1]));
  const skillsRank = new Map(skillsResult.map((s, i) => [s.onetCode, i + 1]));

  const allCodes = new Set([...dutiesRank.keys(), ...skillsRank.keys()]);
  const fused = [...allCodes].map((code) => {
    const dRank = dutiesRank.get(code) || safeTopN + 1;
    const sRank = skillsRank.get(code) || safeTopN + 1;
    const rrfScore = 1 / (K + dRank) + 1 / (K + sRank);

    return {
      onet_code: code,
      rrf_score: rrfScore,
      duties_rank: dutiesRank.has(code) ? dRank : null,
      skills_rank: skillsRank.has(code) ? sRank : null,
    };
  });

  fused.sort((a, b) => b.rrf_score - a.rrf_score);

  return NextResponse.json({
    results: fused.slice(0, safeTopN).map((f, i) => ({ ...f, final_rank: i + 1 })),
    fusion_applied: true,
  });
}
```

**Why:**
- RRF handles different score scales without calibration
- Feature flags ensure existing behavior unchanged (6)
- Graceful degradation when transcript not ready
- `top_n` defaults to 6 and is server-capped; frontend does not expose it

**UI behavior:**
- Reuse the existing "Top 6" tag on the recommender card; do not add another label.
- Disable the Recommend button until either dutiesText is non-empty or a transcript_id is present.

---

### Step 12: Observability and Cleanup

**Files to Add:**

```
app/api/v1/transcripts/[id]/route.ts (DELETE handler)
```

**Action:**

Add metrics logging:
- `transcript_parse_latency_ms`
- `gemini_embed_batch_calls`
- `course_cache_hit_rate`
- `ska_evidence_count`
- `skills_match_latency_ms`

Add DELETE endpoint:
```typescript
export async function DELETE(request: Request, { params }) {
  const prisma = getPrisma();
  const access = await requireAccess(request, prisma);
  const user = await prisma.user.findUnique({ where: { email: access.email } });
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 401 });
  const transcript = await prisma.transcript.findUnique({ where: { id: params.id } });
  if (!transcript || transcript.userId !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  // 1. Delete from storage
  const doc = await prisma.transcriptDocument.findUnique({ where: { transcriptId: params.id } });
  if (doc) await storageProvider.deleteObject(doc.storageUrl);

  // 2. Cascade delete in DB
  await prisma.transcript.delete({ where: { id: params.id } });

  return NextResponse.json({ success: true });
}
```

Add cache cleanup job (optional):
```sql
DELETE FROM "CourseEmbeddingCache" WHERE "updatedAt" < NOW() - INTERVAL '30 days';
```

**Cost note (cache retention):**
- Do **not** enable cleanup in MVP if you want maximum cache reuse.
- Avoid `prisma migrate reset` or truncating `CourseEmbeddingCache`.
- Keep `EMBEDDING_MODEL` and text policy stable to preserve hash hits.
- Ensure local DB volume persists (do not delete Docker volume).

**Why:**
- Education records are sensitive; minimize retention
- Metrics needed for timeout debugging
- Cache cleanup prevents unbounded growth

### Step Gates (Test Plan + Expected Results)

Each step is gated. Do not start the next step until its test plan passes
and expected results are met.

0. **Step 0: Prerequisites**
   - Test plan: install required npm deps; update `.env.example`.
   - Expected results: build succeeds; new env vars documented.
1. **Step 1: Embedding Guard + Smoke Test**
   - Test plan: run `pnpm smoke:embedding`.
   - Expected results: exit code 0, dimension = 3072.
2. **Step 2: Schema Migration**
   - Test plan: run `pnpm prisma migrate dev` (or deploy) and verify tables exist.
   - Expected results: new tables present with correct constraints and `vector(3072)` columns.
3. **Step 3: Upload Flow**
   - Test plan: call create endpoint, upload PDF, call complete-upload; check DB rows.
   - Expected results: `Transcript` + `TranscriptDocument` rows created; upload URL is valid.
4. **Step 4: Parsing Pipeline**
   - Test plan: process a text PDF and a scanned PDF.
   - Expected results: status transitions to READY/NEEDS_REVIEW; `TranscriptCourse` rows created; blob deleted.
5. **Step 5: Review + Edit**
   - Test plan: edit courses via API/UI; re-fetch transcript.
   - Expected results: courses updated, evidence cleared, status = READY.
6. **Step 6: SKA Ingestion**
   - Test plan: run ingestion scripts; query counts and weight normalization.
   - Expected results: skill count ~150; req_weight sums near 1.0 per occupation.
7. **Step 7: Embedding Batcher**
   - Test plan: unit test chunking with stub provider, verify order stability.
   - Expected results: embeddings length == input length; order preserved.
8. **Step 8: Course Cache**
   - Test plan: call cache twice with same courses.
   - Expected results: first run writes cache; second run uses cache only.
9. **Step 9: Course → SKA Mapping**
   - Test plan: compute SKA for sample transcript with stub embeddings.
   - Expected results: `TranscriptInferredSka` rows created with datasetVersionId + embeddingModelId.
10. **Step 10: Skills-Only Scoring**
   - Test plan: call skills match route for READY and non-READY transcripts.
   - Expected results: READY returns rankings; non-READY returns 400.
11. **Step 11: Combined Fusion**
   - Test plan: call combined route with flags off and on.
   - Expected results: flags off returns duties-only; flags on returns fused ranks.
12. **Step 12: Cleanup + Metrics**
   - Test plan: call DELETE on transcript and inspect logs.
   - Expected results: storage object deleted, DB rows removed, metrics logged.

---

## 5. Risks and Mitigations

| # | Risk | Impact | Likelihood | Mitigation |
|---|------|--------|------------|------------|
| 1 | **Duties model mismatch** - existing duties may use different embedding model | Skills and duties incompatible | Medium | Keep separate paths; add `embedding_model_id` metadata; smoke test self-retrieval |
| 2 | **PDF parsing errors** - OCR/layout variations produce wrong courses | Incorrect SKA mapping | High | NEEDS_REVIEW status; editable UI; persist raw_line for debugging |
| 3 | **Vercel timeout** - OCR on multi-page scans exceeds limit | 504 errors | Medium | `maxDuration=60`; text fallback; chunked processing option |
| 4 | **Generic SKA dominance** - "Active Listening" matches everything | Weak differentiation | Medium | IDF weighting; stoplist; per-course topK limit |
| 5 | **Cache unbounded growth** | Storage costs, slow queries | Low | TTL-based cleanup; unique index on normalized title |
| 6 | **No PDF retention** | Harder to debug parsing issues | Medium | Store raw_line + parser metadata; allow re-upload |
| 7 | **TranscriptInferredSka composite PK size** | Larger indexes, slower writes | Low | If needed, switch to UUID primary key + unique constraint on (transcriptId, courseKey, skillId, embeddingModelId, datasetVersionId) |
| 8 | **Malicious or oversized PDFs** | Parser crashes or resource spikes | Low | Enforce size limit, use vetted parser, keep dependencies updated |

---

## 6. Alternatives Considered

### Alternative A: Single Transcript Vector

**Approach:** Embed entire transcript as one vector, KNN against occupation vectors.

| Pros | Cons |
|------|------|
| Simplest implementation | Multi-topic averaging hurts precision |
| Fastest query | No course-level evidence |
| | Fails audit requirements |

**Decision:** Not chosen. Sparse scoring preferred for explainability (3)(11).

### Alternative B: LLM Direct SKA Extraction

**Approach:** Prompt LLM to directly output SKA IDs for each course.

| Pros | Cons |
|------|------|
| May handle ambiguity better | Higher hallucination risk |
| No embedding cost | Harder to cache deterministically |
| | Less reproducible |

**Decision:** Not chosen for MVP. Consider as future reranker.

### Alternative C: Per-Course DB KNN

**Approach:** For each course, run `SELECT ... ORDER BY embedding <=> $vec LIMIT 10` against `SkillCatalog`.

| Pros | Cons |
|------|------|
| Uses pgvector capabilities | 40 queries = 40 connections |
| | Neon compute volatility (5)(6) |
| | Slower than in-memory scan |

**Decision:** Not chosen. In-memory scan faster for ~150 skills.

---

## 7. Acceptance Criteria

| # | Criterion | Verification |
|---|-----------|--------------|
| 1 | `FEATURE_SKILL_MATCHING=false` + `FEATURE_MATCH_FUSION=false` → duties output unchanged | Compare with baseline |
| 2 | `pnpm smoke:embedding` passes, returns 3072 | CI job |
| 3 | Upload PDF → process → review → compute SKA → match works end-to-end | Manual test |
| 4 | Course embedding calls = 0 (cache hit) or 1 (batch), never per-course | Logs |
| 5 | Skills endpoint returns evidence: ≥3 SKA with supporting courses per occupation | Response schema |
| 6 | Combined endpoint returns duties_rank, skills_rank, fused rank | Response schema |
| 7 | Skills/combined endpoints default to top 6 and clamp larger requests | Response schema |
| 8 | Gating applied when transcript status = NEEDS_REVIEW | Manual test |
| 9 | Uploaded PDF deleted after parsing | Manual test |
| 10 | Recommend button disabled until duties or transcript provided; Top 6 tag appears once | Manual test |
| 11 | Required npm deps installed and `.env.example` updated with new vars | Code review |
| 12 | Transcript routes enforce ownership checks and size limits | Manual test |
| 13 | New API routes have rate limits and consistent error handling | Code review |

---

## 8. Manual Test Plan

### Automated Test Workflow (Local + CI)

**Prereqs**
- Local DB running (pgvector). `DATABASE_URL` points to the docker DB.
- Transcript routes require login: `ACCESS_MODE=invite`.
- For automation use stub embeddings to avoid API costs:
  `EMBEDDING_PROVIDER=stub`, `EMBEDDING_MODEL=stub`.
- Playwright uses local storage by default (see `playwright.config.ts`).

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

**Transcript-specific coverage map**
- Unit: `tests/unit/transcripts/{llmCourseParser,geminiOcrProvider,pdfTextProvider,courseFilters,courseKey}.test.ts`
- Unit: `tests/unit/ska/{mapCoursesToSka,scoreOccupations,skillCatalogCache}.test.ts`
- Integration: `tests/integration/{skillsMatch,matchCombined,computeEmbeddings}.test.ts`
- E2E: `e2e/transcript.spec.ts` (fixtures in `e2e/fixtures/transcript-*.pdf`)

### Test 1: Baseline Regression

**Setup:**
```bash
FEATURE_SKILL_MATCHING=false
FEATURE_MATCH_FUSION=false
```

**Steps:**
1. Call existing duties endpoint with known daily tasks
2. Record topN results

**Expected:** Results identical to current production.

---

### Test 2: Embedding Smoke Test

**Steps:**
```bash
pnpm smoke:embedding
```

**Expected:** Output shows `PASS: Dimension is 3072`, exit code 0.

---

### Test 3: SKA Ingestion

**Steps:**
```bash
pnpm ingest:onet-ska
pnpm ingest:onet-ska-reqs
```

**Verification:**
```sql
SELECT COUNT(*) FROM "SkillCatalog"
WHERE "datasetVersionId" = (
  SELECT id FROM "DatasetVersion" WHERE "datasetName" = 'onet_ska' AND "isActive" = true
  LIMIT 1
);
-- Expected: ~150

SELECT "onetCode", SUM("reqWeight") FROM "OccupationSkaRequirement"
WHERE "datasetVersionId" = (
  SELECT id FROM "DatasetVersion" WHERE "datasetName" = 'onet_ska' AND "isActive" = true
  LIMIT 1
)
GROUP BY "onetCode" LIMIT 5;
-- Expected: All sums ≈ 1.0
```

---

### Test 4: Transcript Upload & Processing

**Steps:**
1. POST `/api/v1/transcripts/create`
2. Upload PDF to returned uploadUrl
3. POST `/api/v1/transcripts/{id}/complete-upload`
4. POST `/api/v1/transcripts/{id}/process`

**Expected:**
- Status becomes READY or NEEDS_REVIEW
- `TranscriptCourse` rows created
- Response includes courseCount > 0
- Blob deleted and `TranscriptDocument.storageUrl` set to null

---

### Test 5: Course Edit & Evidence Invalidation

**Steps:**
1. GET `/api/v1/transcripts/{id}` → note courses
2. PATCH `/api/v1/transcripts/{id}/courses/update` with edited title
3. Check `TranscriptInferredSka` table

**Expected:**
- Evidence rows deleted (invalidated)
- Status = READY

---

### Test 6: Compute SKA Evidence

**Steps:**
1. POST `/api/v1/transcripts/{id}/compute-ska`

**Expected:**
- `TranscriptInferredSka` rows created
- Response includes evidenceCount, avgTop1Score

---

### Test 7: Skills-Only Match

**Steps:**
1. POST `/api/v1/match/skills` with `{ transcript_id }`

**Expected:**
- 6 occupations returned (default)
- Each includes coverage, match, topContributingSkills, supportingCourses

---

### Test 8: Combined Fusion

**Setup:**
```bash
FEATURE_SKILL_MATCHING=true
FEATURE_MATCH_FUSION=true
```

**Steps:**
1. POST `/api/v1/match/combined` with dutiesText + transcript_id

**Expected:**
- Results include duties_rank, skills_rank, final_rank
- fusion_applied = true

---

### Test 9: Recommend Button Gating

**Steps:**
1. Load the recommend UI with no duties text and no transcript selected
2. Confirm Recommend button is disabled
3. Enter duties text OR select a transcript
4. Confirm Recommend button is enabled
5. Verify only one "Top 6" tag is visible

**Expected:**
- Button disabled until at least one input is present
- Single "Top 6" label

---

### Test 10: Cache Effectiveness

**Steps:**
1. Compute SKA for transcript
2. Note Gemini API call count
3. Compute SKA again for same transcript

**Expected:**
- Second run: Gemini calls = 0 (all cache hits)

---

### Test 11: Confidence Gating

**Setup:**
1. Manually set transcript status to NEEDS_REVIEW

**Steps:**
1. POST `/api/v1/match/combined`

**Expected:**
- Skills contribution reduced or zero
- Response indicates gating applied

---

### Test 12: Transcript Ownership Enforcement

**Steps:**
1. Create transcript as User A
2. Attempt to GET/PATCH/PROCESS/COMPUTE as User B

**Expected:**
- All transcript routes return 404 for non-owners

---

## 9. Rollback Plan

### Immediate Rollback (No Redeploy)

```bash
# Set environment variables
FEATURE_SKILL_MATCHING=false
FEATURE_MATCH_FUSION=false
```

**Result:** System immediately returns to duties-only behavior.

---

### Data Rollback

| Table | Action |
|-------|--------|
| `SkillCatalog` | Keep - reference data |
| `OccupationSkaRequirement` | Keep - reference data |
| `CourseEmbeddingCache` | TRUNCATE if needed - cache only |
| `Transcript*` | Keep - user data |

**Note:** Do NOT drop tables during rollback.

---

### Code Rollback

```bash
# Vercel dashboard
# Click "Deployments" → Select last stable → "Promote to Production"
```

**Validation:**
1. Run Test 1 (Baseline Regression)
2. Confirm duties topN unchanged

---

### Migration Safety

- All migrations are additive
- No modifications to existing `OnetDutyEmbedding`
- If performance issues, add indexes (forward-fix) rather than down-migrate

---

## Appendix: File Structure

```
├── prisma/
│   └── migrations/
│       └── YYYYMMDD_add_skills_pipeline/
│           └── migration.sql
├── scripts/
│   ├── smoke/
│   │   └── check-embedding-dim.ts
│   └── ingest/
│       ├── ingest_onet_ska.ts
│       └── ingest_onet_ska_requirements.ts
├── src/
│   └── lib/
│       ├── embeddings/
│       │   └── embedBatch.ts
│       ├── match/
│       │   └── dutiesMatch.ts
│       ├── storage/
│       │   ├── types.ts
│       │   ├── vercelBlobStore.ts
│       │   ├── localDiskStore.ts
│       │   └── index.ts
│       ├── transcripts/
│       │   ├── types.ts
│       │   ├── llmCourseParser.ts
│       │   └── providers/
│       │       ├── pdfTextProvider.ts
│       │       └── geminiOcrProvider.ts
│       ├── courses/
│       │   └── getCourseEmbeddings.ts
│       ├── ska/
│       │   ├── skillCatalogCache.ts
│       │   ├── occupationRequirementsCache.ts
│       │   ├── similarity.ts
│       │   ├── mapCoursesToSka.ts
│       │   └── scoreOccupations.ts
│       └── text/
│           └── normalizeCourseTitle.ts
├── app/
│   ├── api/
│   │   └── v1/
│   │       ├── transcripts/
│   │       │   ├── create/route.ts
│   │       │   └── [id]/
│   │       │       ├── route.ts
│   │       │       ├── complete-upload/route.ts
│   │       │       ├── process/route.ts
│   │       │       ├── compute-ska/route.ts
│   │       │       └── courses/
│   │       │           └── update/route.ts
│   │       └── match/
│   │           ├── skills/route.ts
│   │           └── combined/route.ts
│   └── transcripts/
│       └── [id]/
│           └── page.tsx
└── package.json
```

---

## Appendix: Environment Variables

```bash
# Existing
DATABASE_URL=postgresql://...
EMBEDDING_API_KEY=...
EMBEDDING_PROVIDER=gemini
EMBEDDING_MODEL=gemini-embedding-001
EMBEDDING_API_URL=https://generativelanguage.googleapis.com/v1beta

# New
FEATURE_SKILL_MATCHING=false
FEATURE_MATCH_FUSION=false
NEXT_PUBLIC_FEATURE_SKILL_MATCHING=false
TRANSCRIPT_MAX_BYTES=10485760

# Optional
ONET_DATA_DIR=./data/onet
BLOB_READ_WRITE_TOKEN=... (for Vercel Blob)
STORAGE_PROVIDER=vercel_blob|local
LOCAL_STORAGE_DIR=./.local/transcripts
```

**Note:** `.env.example` must be updated to include all new variables above.
