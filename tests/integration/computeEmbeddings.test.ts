import { PrismaClient } from '@prisma/client';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';

import { ensurePrismaEngineStartupLogs } from '../../src/db/prismaEnv';
import { computeOnetEmbeddings } from '../../src/lib/embeddings/computeOnetEmbeddings';
import { EMBEDDING_DIM } from '../../src/lib/embeddings/constants';
import { createStubProvider } from '../../src/lib/embeddings/providerStub';

ensurePrismaEngineStartupLogs();

const prisma = new PrismaClient();

describe('computeOnetEmbeddings integration', () => {
  let onetDatasetVersionId = '';
  let seeded = false;
  let previousActiveEmbeddingIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();
    previousActiveEmbeddingIds = (
      await prisma.onetEmbeddingVersion.findMany({
        where: { isActive: true },
        select: { id: true },
      })
    ).map((row) => row.id);
    const dataset = await prisma.datasetVersion.create({
      data: {
        datasetName: 'onet',
        versionLabel: `test-onet-${Date.now()}`,
        isActive: false,
      },
      select: { id: true },
    });
    onetDatasetVersionId = dataset.id;
    await prisma.onetDuty.createMany({
      data: [
        {
          datasetVersionId: onetDatasetVersionId,
          onetCode: '15-1252.00',
          dutyText: 'Analyze data sets.',
          dutyTextNorm: 'analyze data sets.',
          sortOrder: 1,
        },
        {
          datasetVersionId: onetDatasetVersionId,
          onetCode: '15-1252.00',
          dutyText: 'Build predictive models.',
          dutyTextNorm: 'build predictive models.',
          sortOrder: 2,
        },
        {
          datasetVersionId: onetDatasetVersionId,
          onetCode: '15-1252.01',
          dutyText: 'Design data pipelines.',
          dutyTextNorm: 'design data pipelines.',
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
  });

  afterAll(async () => {
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
      await prisma.datasetVersion.delete({
        where: { id: onetDatasetVersionId },
      });
    }
    if (previousActiveEmbeddingIds.length > 0) {
      await prisma.onetEmbeddingVersion.updateMany({ data: { isActive: false } });
      await prisma.onetEmbeddingVersion.updateMany({
        where: { id: { in: previousActiveEmbeddingIds } },
        data: { isActive: true },
      });
    }
    await prisma.$disconnect();
  });

  it('is idempotent when reusing the same embedding version', async () => {
    const provider = createStubProvider('stub');
    const first = await computeOnetEmbeddings({
      prisma,
      provider,
      onetDatasetVersionId,
    });
    const countA = await prisma.onetDutyEmbedding.count({
      where: { embeddingVersionId: first.embeddingVersionId },
    });

    const second = await computeOnetEmbeddings({
      prisma,
      provider,
      onetDatasetVersionId,
      embeddingVersionId: first.embeddingVersionId,
    });
    const countB = await prisma.onetDutyEmbedding.count({
      where: { embeddingVersionId: first.embeddingVersionId },
    });

    expect(second.embeddingVersionId).toBe(first.embeddingVersionId);
    expect(countB).toBe(countA);
  });

  it('can resume after partial failure', async () => {
    const provider = createStubProvider('stub');

    let error: unknown = null;
    try {
      await computeOnetEmbeddings({
        prisma,
        provider,
        onetDatasetVersionId,
        failAfter: 1,
      });
    } catch (err) {
      error = err;
    }
    expect(error).toBeTruthy();

    const latestVersion = await prisma.onetEmbeddingVersion.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!latestVersion) {
      throw new Error('Expected an embedding version to be created.');
    }

    const partialCount = await prisma.onetDutyEmbedding.count({
      where: { embeddingVersionId: latestVersion.id },
    });
    expect(partialCount).toBeGreaterThan(0);

    const resumed = await computeOnetEmbeddings({
      prisma,
      provider,
      onetDatasetVersionId,
      embeddingVersionId: latestVersion.id,
    });
    expect(resumed.coverage).toBeGreaterThan(0.9);
  });

  it('does not activate when coverage threshold is not met', async () => {
    const provider = createStubProvider('stub');
    const result = await computeOnetEmbeddings({
      prisma,
      provider,
      onetDatasetVersionId,
      coverageThreshold: 1.1,
    });

    expect(result.activated).toBe(false);
    const activeCount = await prisma.onetEmbeddingVersion.count({
      where: { isActive: true },
    });
    expect(activeCount).toBe(0);
  });

  it('keeps exactly one active embedding version', async () => {
    await prisma.onetEmbeddingVersion.create({
      data: {
        provider: 'stub',
        model: 'stub',
        outputDim: EMBEDDING_DIM,
        onetDatasetVersionId,
        isActive: true,
      },
    });

    const provider = createStubProvider('stub');
    const result = await computeOnetEmbeddings({
      prisma,
      provider,
      onetDatasetVersionId,
    });

    const activeVersions = await prisma.onetEmbeddingVersion.findMany({
      where: { isActive: true },
    });
    expect(activeVersions.length).toBe(1);
    expect(activeVersions[0]?.id).toBe(result.embeddingVersionId);
  });
});
