import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { POST } from '../../app/api/v1/soc/recommend/route';
import { ensurePrismaEngineStartupLogs } from '../../src/db/prismaEnv';
import { computeOnetEmbeddings } from '../../src/lib/embeddings/computeOnetEmbeddings';
import { createStubProvider } from '../../src/lib/embeddings/providerStub';

ensurePrismaEngineStartupLogs();

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
  let seeded = false;

  beforeAll(async () => {
    await prisma.$connect();
    const oflcVersion = await prisma.datasetVersion.findFirst({
      where: { datasetName: 'oflc', isActive: true },
      select: { id: true },
    });
    if (!oflcVersion) {
      throw new Error('Active OFLC dataset version not found. Seed or ingest data first.');
    }
    const soc = await prisma.socTitle.findFirst({
      where: { datasetVersionId: oflcVersion.id },
      select: { socCode: true },
    });
    if (!soc) {
      throw new Error('No SOC titles found in the active OFLC dataset.');
    }

    const dataset = await prisma.datasetVersion.create({
      data: {
        datasetName: 'onet',
        versionLabel: `test-onet-socrec-${Date.now()}`,
        isActive: false,
      },
      select: { id: true },
    });
    onetDatasetVersionId = dataset.id;

    const onetCodes = [`${soc.socCode}.00`, `${soc.socCode}.01`];
    await prisma.socTitle.create({
      data: {
        datasetVersionId: onetDatasetVersionId,
        socCode: soc.socCode,
        title: `SOC ${soc.socCode}`,
      },
    });
    await prisma.onetOccupation.createMany({
      data: onetCodes.map((code) => ({
        datasetVersionId: onetDatasetVersionId,
        onetCode: code,
        title: `O*NET ${code}`,
      })),
    });
    await prisma.onetSocMap.createMany({
      data: onetCodes.map((code) => ({
        datasetVersionId: onetDatasetVersionId,
        onetCode: code,
        socCode: soc.socCode,
      })),
    });
    await prisma.onetDuty.createMany({
      data: [
        {
          datasetVersionId: onetDatasetVersionId,
          onetCode: onetCodes[0],
          dutyText: 'Analyze data sets.',
          dutyTextNorm: 'analyze data sets.',
          sortOrder: 1,
        },
        {
          datasetVersionId: onetDatasetVersionId,
          onetCode: onetCodes[1],
          dutyText: 'Build data pipelines.',
          dutyTextNorm: 'build data pipelines.',
          sortOrder: 1,
        },
      ],
    });
    seeded = true;
  });

  beforeEach(async () => {
    await prisma.onetDutyEmbedding.deleteMany({
      where: { embeddingVersion: { onetDatasetVersionId } },
    });
    await prisma.onetEmbeddingVersion.deleteMany({
      where: { onetDatasetVersionId },
    });
    await prisma.onetEmbeddingVersion.updateMany({
      data: { isActive: false },
    });

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
    if (seeded) {
      await prisma.onetDutyEmbedding.deleteMany({
        where: { embeddingVersion: { onetDatasetVersionId } },
      });
      await prisma.onetEmbeddingVersion.deleteMany({
        where: { onetDatasetVersionId },
      });
      await prisma.onetDuty.deleteMany({
        where: { datasetVersionId: onetDatasetVersionId },
      });
      await prisma.onetSocMap.deleteMany({
        where: { datasetVersionId: onetDatasetVersionId },
      });
      await prisma.onetOccupation.deleteMany({
        where: { datasetVersionId: onetDatasetVersionId },
      });
      await prisma.socTitle.deleteMany({
        where: { datasetVersionId: onetDatasetVersionId },
      });
      await prisma.datasetVersion.delete({
        where: { id: onetDatasetVersionId },
      });
    }
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
    expect(item.wageLevel1Hourly === null || typeof item.wageLevel1Hourly === 'string').toBe(
      true,
    );
    expect(item.wageLevel1Annual === null || typeof item.wageLevel1Annual === 'number').toBe(
      true,
    );
    expect(item.wageLevel2Hourly === null || typeof item.wageLevel2Hourly === 'string').toBe(
      true,
    );
    expect(item.wageLevel2Annual === null || typeof item.wageLevel2Annual === 'number').toBe(
      true,
    );
    expect(item.wageLevel3Hourly === null || typeof item.wageLevel3Hourly === 'string').toBe(
      true,
    );
    expect(item.wageLevel3Annual === null || typeof item.wageLevel3Annual === 'number').toBe(
      true,
    );
    expect(item.wageLevel4Hourly === null || typeof item.wageLevel4Hourly === 'string').toBe(
      true,
    );
    expect(item.wageLevel4Annual === null || typeof item.wageLevel4Annual === 'number').toBe(
      true,
    );
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
