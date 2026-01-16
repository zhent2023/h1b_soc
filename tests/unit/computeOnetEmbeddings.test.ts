import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { EMBEDDING_DIM } from '../../src/lib/embeddings/constants';
import { computeOnetEmbeddings } from '../../src/lib/embeddings/computeOnetEmbeddings';

const makeVector = () => Array.from({ length: EMBEDDING_DIM }, () => 0);

function createPrismaStub() {
  const tx = {
    $executeRawUnsafe: vi.fn().mockResolvedValue(null),
    onetEmbeddingVersion: {
      updateMany: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue(null),
    },
  };

  const prisma = {
    datasetVersion: { findFirst: vi.fn() },
    onetEmbeddingVersion: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    onetDuty: { findMany: vi.fn() },
    onetDutyEmbedding: { findMany: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: typeof tx) => Promise<unknown>) => fn(tx)),
  } as unknown as PrismaClient;

  return { prisma, tx };
}

describe('computeOnetEmbeddings', () => {
  it('throws when active dataset version is missing', async () => {
    const { prisma } = createPrismaStub();
    prisma.datasetVersion.findFirst = vi.fn().mockResolvedValue(null);

    await expect(
      computeOnetEmbeddings({ prisma, provider: { provider: 'stub', model: 'stub', embedDocuments: vi.fn(), embedQuery: vi.fn() } }),
    ).rejects.toThrow(/dataset version/i);
  });

  it('throws when embedding version id is missing', async () => {
    const { prisma } = createPrismaStub();
    prisma.datasetVersion.findFirst = vi.fn().mockResolvedValue({ id: 'onet' });
    prisma.onetEmbeddingVersion.findUnique = vi.fn().mockResolvedValue(null);

    await expect(
      computeOnetEmbeddings({
        prisma,
        embeddingVersionId: 'missing',
        provider: { provider: 'stub', model: 'stub', embedDocuments: vi.fn(), embedQuery: vi.fn() },
      }),
    ).rejects.toThrow(/Embedding version not found/);
  });

  it('throws when output dimension mismatches', async () => {
    const { prisma } = createPrismaStub();
    prisma.datasetVersion.findFirst = vi.fn().mockResolvedValue({ id: 'onet' });
    prisma.onetEmbeddingVersion.findUnique = vi.fn().mockResolvedValue({
      id: 'v1',
      onetDatasetVersionId: 'onet',
      outputDim: 1,
    });

    await expect(
      computeOnetEmbeddings({
        prisma,
        embeddingVersionId: 'v1',
        provider: { provider: 'stub', model: 'stub', embedDocuments: vi.fn(), embedQuery: vi.fn() },
      }),
    ).rejects.toThrow(/outputDim/i);
  });

  it('returns early when there are no duties', async () => {
    const { prisma } = createPrismaStub();
    prisma.datasetVersion.findFirst = vi.fn().mockResolvedValue({ id: 'onet' });
    prisma.onetEmbeddingVersion.create = vi.fn().mockResolvedValue({
      id: 'v1',
      onetDatasetVersionId: 'onet',
      outputDim: EMBEDDING_DIM,
    });
    prisma.onetDuty.findMany = vi.fn().mockResolvedValue([]);

    const result = await computeOnetEmbeddings({
      prisma,
      provider: { provider: 'stub', model: 'stub', embedDocuments: vi.fn(), embedQuery: vi.fn() },
    });

    expect(result.eligibleCount).toBe(0);
    expect(result.coverage).toBe(0);
  });

  it('embeds and activates when coverage threshold is met', async () => {
    const { prisma, tx } = createPrismaStub();
    prisma.datasetVersion.findFirst = vi.fn().mockResolvedValue({ id: 'onet' });
    prisma.onetEmbeddingVersion.create = vi.fn().mockResolvedValue({
      id: 'v1',
      onetDatasetVersionId: 'onet',
      outputDim: EMBEDDING_DIM,
    });
    prisma.onetDuty.findMany = vi.fn().mockResolvedValue([
      { onetCode: '15-0000.00', dutyText: 'Duty A', sortOrder: 1 },
    ]);
    prisma.onetDutyEmbedding.findMany = vi.fn().mockResolvedValue([]);

    const provider = {
      provider: 'stub',
      model: 'stub',
      embedDocuments: vi.fn().mockResolvedValue([makeVector()]),
      embedQuery: vi.fn(),
    };

    const result = await computeOnetEmbeddings({
      prisma,
      provider,
      coverageThreshold: 1,
    });

    expect(result.activated).toBe(true);
    expect(tx.$executeRawUnsafe).toHaveBeenCalled();
    expect(tx.onetEmbeddingVersion.updateMany).toHaveBeenCalled();
  });

  it('supports resume and dry run paths', async () => {
    const { prisma } = createPrismaStub();
    prisma.datasetVersion.findFirst = vi.fn().mockResolvedValue({ id: 'onet' });
    prisma.onetEmbeddingVersion.findFirst = vi.fn().mockResolvedValue({
      id: 'v1',
      onetDatasetVersionId: 'onet',
      outputDim: EMBEDDING_DIM,
    });
    prisma.onetDuty.findMany = vi.fn().mockResolvedValue([
      { onetCode: '15-0000.00', dutyText: 'Duty A', sortOrder: 1 },
    ]);
    prisma.onetDutyEmbedding.findMany = vi.fn().mockResolvedValue([
      { onetCode: '15-0000.00' },
    ]);

    const provider = {
      provider: 'stub',
      model: 'stub',
      embedDocuments: vi.fn(),
      embedQuery: vi.fn(),
    };

    const result = await computeOnetEmbeddings({
      prisma,
      provider,
      resume: true,
      dryRun: true,
    });

    expect(result.embeddedCount).toBe(1);
    expect(provider.embedDocuments).not.toHaveBeenCalled();
  });

  it('throws when provider returns wrong vector count', async () => {
    const { prisma } = createPrismaStub();
    prisma.datasetVersion.findFirst = vi.fn().mockResolvedValue({ id: 'onet' });
    prisma.onetEmbeddingVersion.create = vi.fn().mockResolvedValue({
      id: 'v1',
      onetDatasetVersionId: 'onet',
      outputDim: EMBEDDING_DIM,
    });
    prisma.onetDuty.findMany = vi.fn().mockResolvedValue([
      { onetCode: '15-0000.00', dutyText: 'Duty A', sortOrder: 1 },
      { onetCode: '15-0001.00', dutyText: 'Duty B', sortOrder: 2 },
    ]);
    prisma.onetDutyEmbedding.findMany = vi.fn().mockResolvedValue([]);

    const provider = {
      provider: 'stub',
      model: 'stub',
      embedDocuments: vi.fn().mockResolvedValue([makeVector()]),
      embedQuery: vi.fn(),
    };

    await expect(
      computeOnetEmbeddings({ prisma, provider }),
    ).rejects.toThrow(/unexpected vector count/i);
  });

  it('throws when failAfter threshold is reached', async () => {
    const { prisma } = createPrismaStub();
    prisma.datasetVersion.findFirst = vi.fn().mockResolvedValue({ id: 'onet' });
    prisma.onetEmbeddingVersion.create = vi.fn().mockResolvedValue({
      id: 'v1',
      onetDatasetVersionId: 'onet',
      outputDim: EMBEDDING_DIM,
    });
    prisma.onetDuty.findMany = vi.fn().mockResolvedValue([
      { onetCode: '15-0000.00', dutyText: 'Duty A', sortOrder: 1 },
      { onetCode: '15-0001.00', dutyText: 'Duty B', sortOrder: 2 },
    ]);
    prisma.onetDutyEmbedding.findMany = vi.fn().mockResolvedValue([]);

    const provider = {
      provider: 'stub',
      model: 'stub',
      embedDocuments: vi.fn().mockResolvedValue([makeVector(), makeVector()]),
      embedQuery: vi.fn(),
    };

    await expect(
      computeOnetEmbeddings({ prisma, provider, failAfter: 1 }),
    ).rejects.toThrow(/Simulated embedding failure/);
  });
});
