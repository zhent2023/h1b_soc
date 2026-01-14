import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';

import { EMBEDDING_DIM } from '../../src/lib/embeddings/constants';
const prisma = new PrismaClient();

describe('embedding schema integration', () => {
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

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('enforces a single active embedding version', async () => {
    await prisma.onetEmbeddingVersion.updateMany({
      where: { isActive: true },
      data: { isActive: false },
    });

    const baseData = {
      provider: 'stub',
      model: 'stub',
      outputDim: EMBEDDING_DIM,
      onetDatasetVersionId,
    };

    const first = await prisma.onetEmbeddingVersion.create({
      data: { ...baseData, isActive: true },
    });

    let error: unknown = null;
    try {
      await prisma.onetEmbeddingVersion.create({
        data: { ...baseData, isActive: true },
      });
    } catch (err) {
      error = err;
    }

    expect(error).toBeTruthy();

    await prisma.onetEmbeddingVersion.deleteMany({
      where: { id: first.id },
    });
  });

  it('inserts and reads a vector embedding via raw SQL', async () => {
    const version = await prisma.onetEmbeddingVersion.create({
      data: {
        provider: 'stub',
        model: 'stub',
        outputDim: EMBEDDING_DIM,
        onetDatasetVersionId,
        isActive: false,
      },
    });

    const rowId = randomUUID();
    const now = new Date();
    const onetCode = '15-1252.00';
    const vectorLiteral = `[${Array.from({ length: EMBEDDING_DIM }, (_, idx) =>
      idx === 0 ? 1 : 0,
    ).join(',')}]`;

    await prisma.$executeRawUnsafe(
      'INSERT INTO "OnetDutyEmbedding" ("id","embeddingVersionId","onetCode","contentText","embedding","createdAt","updatedAt") VALUES ($1::uuid,$2::uuid,$3,$4,$5::vector,$6,$7)',
      rowId,
      version.id,
      onetCode,
      'Fixture duties content.',
      vectorLiteral,
      now,
      now,
    );

    const rows = await prisma.$queryRawUnsafe<
      { onetCode: string; contentText: string }[]
    >('SELECT "onetCode", "contentText" FROM "OnetDutyEmbedding" WHERE "id" = $1::uuid', rowId);

    expect(rows.length).toBe(1);
    expect(rows[0]?.onetCode).toBe(onetCode);

    await prisma.onetDutyEmbedding.deleteMany({
      where: { embeddingVersionId: version.id },
    });
    await prisma.onetEmbeddingVersion.deleteMany({
      where: { id: version.id },
    });
  });
});
