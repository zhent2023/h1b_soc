import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { POST } from '../../app/api/v1/soc/recommend/route';
import { computeOnetEmbeddings } from '../../src/lib/embeddings/computeOnetEmbeddings';
import { createStubProvider } from '../../src/lib/embeddings/providerStub';

const prisma = new PrismaClient();

const envSnapshot = new Map<string, string | undefined>();
const trackedKeys = [
  'FEATURE_SOC_RECOMMENDER',
  'NEXT_PUBLIC_FEATURE_SOC_RECOMMENDER',
  'EMBEDDING_PROVIDER',
  'EMBEDDING_MODEL',
  'ACCESS_MODE',
  'SOC_RECOMMEND_INTERNAL_TOPK',
  'SOC_RECOMMEND_OUTPUT_TOPK',
  'SOC_RECOMMEND_STATEMENT_TIMEOUT_MS',
  'SOC_RECOMMEND_ENRICHMENT_TIMEOUT_MS',
  'TEST_INJECT_DB_SLEEP_MS',
  'TEST_INJECT_ENRICHMENT_DELAY_MS',
  'TEST_INJECT_WAGE_ERROR',
  'WAGE_NATIONAL_AREA_CODE',
];

function setEnv(key: string, value: string | undefined) {
  if (!envSnapshot.has(key)) {
    envSnapshot.set(key, process.env[key]);
  }
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

function resetEnv() {
  for (const key of trackedKeys) {
    if (!envSnapshot.has(key)) continue;
    const value = envSnapshot.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

async function buildRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/v1/soc/recommend', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('soc recommend API', () => {
  let onetDatasetVersionId = '';

  beforeAll(async () => {
    await prisma.$connect();
    const onetVersion = await prisma.datasetVersion.findFirst({
      where: { datasetName: 'onet', isActive: true },
      select: { id: true },
    });
    if (!onetVersion) {
      throw new Error('Active O*NET dataset version not found. Seed or ingest data first.');
    }
    onetDatasetVersionId = onetVersion.id;
  });

  beforeEach(async () => {
    await prisma.onetDutyEmbedding.deleteMany();
    await prisma.onetEmbeddingVersion.deleteMany();

    setEnv('FEATURE_SOC_RECOMMENDER', 'true');
    setEnv('EMBEDDING_PROVIDER', 'stub');
    setEnv('EMBEDDING_MODEL', 'stub');
    setEnv('ACCESS_MODE', 'public');
    setEnv('WAGE_NATIONAL_AREA_CODE', '');
    setEnv('TEST_INJECT_DB_SLEEP_MS', undefined);
    setEnv('TEST_INJECT_ENRICHMENT_DELAY_MS', undefined);
    setEnv('TEST_INJECT_WAGE_ERROR', undefined);
    setEnv('SOC_RECOMMEND_STATEMENT_TIMEOUT_MS', '1500');
    setEnv('SOC_RECOMMEND_ENRICHMENT_TIMEOUT_MS', '300');
  });

  afterAll(async () => {
    resetEnv();
    await prisma.$disconnect();
  });

  async function ensureEmbeddings() {
    const provider = createStubProvider('stub');
    await computeOnetEmbeddings({
      prisma,
      provider,
      onetDatasetVersionId,
    });
  }

  it('returns 404 when feature flag is off', async () => {
    setEnv('FEATURE_SOC_RECOMMENDER', 'false');
    const req = await buildRequest({ dutiesText: 'Analyze data.' });
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it('returns 400 when dutiesText is missing', async () => {
    const req = await buildRequest({ dutiesText: '   ' });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 503 when embeddings are not ready', async () => {
    const req = await buildRequest({ dutiesText: 'Analyze data.' });
    const res = await POST(req);
    expect(res.status).toBe(503);
    const payload = await res.json();
    expect(payload.code).toBe('EMBEDDINGS_NOT_READY');
  });

  it('returns <=6 items with correct schema fields', async () => {
    await ensureEmbeddings();
    const req = await buildRequest({
      dutiesText: 'Analyze and interpret complex datasets.',
      areaCode: '14460',
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.items.length).toBeLessThanOrEqual(6);
    const item = payload.items[0];
    expect(typeof item.matchedOnetCode).toBe('string');
    expect(typeof item.socCode).toBe('string');
    expect(typeof item.similarity).toBe('number');
    expect(item.similarity).toBeGreaterThanOrEqual(0);
    expect(item.similarity).toBeLessThanOrEqual(1);
    expect(typeof item.confidence).toBe('number');
    expect(item.confidence).toBeGreaterThanOrEqual(0);
    expect(item.confidence).toBeLessThanOrEqual(1);
    expect(item.wageYear === null || typeof item.wageYear === 'string').toBe(true);
    expect(
      item.wageDataQualityNotes === null || typeof item.wageDataQualityNotes === 'object',
    ).toBe(true);
  });

  it('returns wageAvailable=false when wage context is missing', async () => {
    await ensureEmbeddings();
    const req = await buildRequest({ dutiesText: 'Analyze datasets.' });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.items.length).toBeGreaterThan(0);
    expect(payload.items.every((entry: any) => entry.wageAvailable === false)).toBe(true);
  });

  it('returns items with warnings when wage query fails', async () => {
    await ensureEmbeddings();
    setEnv('TEST_INJECT_WAGE_ERROR', 'true');
    const req = await buildRequest({
      dutiesText: 'Coordinate project tasks.',
      areaCode: '14460',
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.warnings.join(' ')).toContain('Wage enrichment failed');
    expect(payload.items.every((entry: any) => entry.wageAvailable === false)).toBe(true);
  });

  it('returns 504 on statement_timeout', async () => {
    await ensureEmbeddings();
    setEnv('SOC_RECOMMEND_STATEMENT_TIMEOUT_MS', '10');
    setEnv('TEST_INJECT_DB_SLEEP_MS', '50');
    const req = await buildRequest({ dutiesText: 'Test timeout.' });
    const res = await POST(req);
    expect(res.status).toBe(504);
  });

  it('marks enrichment timeout when delays exceed threshold', async () => {
    await ensureEmbeddings();
    setEnv('SOC_RECOMMEND_ENRICHMENT_TIMEOUT_MS', '10');
    setEnv('TEST_INJECT_ENRICHMENT_DELAY_MS', '50');
    const req = await buildRequest({ dutiesText: 'Test enrichment timeout.', areaCode: '14460' });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.meta.enrichment.skippedReason).toBe('TIMEOUT');
  });

  it('matches auth behavior with /api/v1/lookup', async () => {
    setEnv('ACCESS_MODE', 'invite');
    const req = await buildRequest({ dutiesText: 'Auth check.' });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});
