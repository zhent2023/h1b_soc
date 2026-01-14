import { randomUUID } from 'crypto';
import type { PrismaClient } from '@prisma/client';

import { buildOnetEmbeddingDocument } from '../onet/buildOnetEmbeddingDocument';
import { EMBEDDING_DIM } from './constants';
import type { EmbeddingProvider } from './types';
import { toVectorLiteral, validateVectorDimension } from './vectorUtils';

export type ComputeEmbeddingsOptions = {
  prisma: PrismaClient;
  provider: EmbeddingProvider;
  onetDatasetVersionId?: string;
  embeddingVersionId?: string;
  resume?: boolean;
  dryRun?: boolean;
  batchSize?: number;
  coverageThreshold?: number;
  failAfter?: number;
};

export type ComputeEmbeddingsResult = {
  embeddingVersionId: string;
  eligibleCount: number;
  embeddedCount: number;
  coverage: number;
  activated: boolean;
};

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_COVERAGE_THRESHOLD = 0.95;

async function resolveOnetDatasetVersionId(prisma: PrismaClient, override?: string) {
  if (override) {
    return override;
  }
  const version = await prisma.datasetVersion.findFirst({
    where: { datasetName: 'onet', isActive: true },
    select: { id: true },
  });
  if (!version) {
    throw new Error('Active O*NET dataset version not found.');
  }
  return version.id;
}

export async function computeOnetEmbeddings(
  options: ComputeEmbeddingsOptions,
): Promise<ComputeEmbeddingsResult> {
  const prisma = options.prisma;
  const provider = options.provider;
  const onetDatasetVersionId = await resolveOnetDatasetVersionId(
    prisma,
    options.onetDatasetVersionId,
  );

  let embeddingVersion = null as null | {
    id: string;
    onetDatasetVersionId: string;
    outputDim: number;
  };

  if (options.embeddingVersionId) {
    embeddingVersion = await prisma.onetEmbeddingVersion.findUnique({
      where: { id: options.embeddingVersionId },
      select: { id: true, onetDatasetVersionId: true, outputDim: true },
    });
    if (!embeddingVersion) {
      throw new Error('Embedding version not found.');
    }
  } else if (options.resume) {
    embeddingVersion = await prisma.onetEmbeddingVersion.findFirst({
      where: { onetDatasetVersionId, isActive: false },
      orderBy: { createdAt: 'desc' },
      select: { id: true, onetDatasetVersionId: true, outputDim: true },
    });
  }

  if (!embeddingVersion) {
    const created = await prisma.onetEmbeddingVersion.create({
      data: {
        provider: provider.provider,
        model: provider.model,
        outputDim: EMBEDDING_DIM,
        onetDatasetVersionId,
        isActive: false,
      },
      select: { id: true, onetDatasetVersionId: true, outputDim: true },
    });
    embeddingVersion = created;
  }

  if (embeddingVersion.onetDatasetVersionId !== onetDatasetVersionId) {
    throw new Error('Embedding version does not match active O*NET dataset version.');
  }
  if (embeddingVersion.outputDim !== EMBEDDING_DIM) {
    throw new Error(`Embedding version outputDim ${embeddingVersion.outputDim} is invalid.`);
  }

  const dutyRows = await prisma.onetDuty.findMany({
    where: { datasetVersionId: onetDatasetVersionId },
    select: { onetCode: true, dutyText: true, sortOrder: true },
    orderBy: [{ onetCode: 'asc' }, { sortOrder: 'asc' }],
  });

  const dutiesByCode = new Map<string, { dutyText: string; sortOrder: number | null }[]>();
  const eligibleCodes: string[] = [];
  for (const row of dutyRows) {
    let bucket = dutiesByCode.get(row.onetCode);
    if (!bucket) {
      bucket = [];
      dutiesByCode.set(row.onetCode, bucket);
      eligibleCodes.push(row.onetCode);
    }
    bucket.push({ dutyText: row.dutyText, sortOrder: row.sortOrder ?? null });
  }

  const eligibleCount = eligibleCodes.length;
  if (eligibleCount === 0) {
    return {
      embeddingVersionId: embeddingVersion.id,
      eligibleCount,
      embeddedCount: 0,
      coverage: 0,
      activated: false,
    };
  }

  const existing = await prisma.onetDutyEmbedding.findMany({
    where: { embeddingVersionId: embeddingVersion.id },
    select: { onetCode: true },
  });
  const existingCodes = new Set(existing.map((row) => row.onetCode));
  const pendingCodes = eligibleCodes.filter((code) => !existingCodes.has(code));

  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const coverageThreshold =
    options.coverageThreshold ?? DEFAULT_COVERAGE_THRESHOLD;

  let embeddedCount = existingCodes.size;
  if (!options.dryRun) {
    for (let offset = 0; offset < pendingCodes.length; offset += batchSize) {
      const batchCodes = pendingCodes.slice(offset, offset + batchSize);
      const documents = batchCodes.map((code) =>
        buildOnetEmbeddingDocument(dutiesByCode.get(code) ?? []),
      );
      const texts = documents.map((doc) => doc.contentText);
      const vectors = await provider.embedDocuments(texts);

      if (vectors.length !== batchCodes.length) {
        throw new Error('Embedding provider returned unexpected vector count.');
      }

      vectors.forEach((vector) => validateVectorDimension(vector, EMBEDDING_DIM));

      await prisma.$transaction(async (tx) => {
        for (let idx = 0; idx < batchCodes.length; idx += 1) {
          const onetCode = batchCodes[idx];
          const contentText = documents[idx]?.contentText ?? '';
          const vectorLiteral = toVectorLiteral(vectors[idx]);
          const rowId = randomUUID();
          await tx.$executeRawUnsafe(
            'INSERT INTO "OnetDutyEmbedding" ("id","embeddingVersionId","onetCode","contentText","embedding","createdAt","updatedAt") VALUES ($1::uuid, $2::uuid, $3, $4, $5::vector, NOW(), NOW()) ON CONFLICT ("embeddingVersionId","onetCode") DO UPDATE SET "contentText" = EXCLUDED."contentText", "embedding" = EXCLUDED."embedding", "updatedAt" = NOW()',
            rowId,
            embeddingVersion.id,
            onetCode,
            contentText,
            vectorLiteral,
          );
        }
      });

      embeddedCount += batchCodes.length;
      if (options.failAfter && embeddedCount >= options.failAfter) {
        throw new Error('Simulated embedding failure.');
      }
    }
  }

  const coverage = embeddedCount / eligibleCount;
  let activated = false;

  if (!options.dryRun && coverage >= coverageThreshold) {
    await prisma.$transaction(async (tx) => {
      await tx.onetEmbeddingVersion.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      });
      await tx.onetEmbeddingVersion.update({
        where: { id: embeddingVersion!.id },
        data: { isActive: true },
      });
    });
    activated = true;
  }

  return {
    embeddingVersionId: embeddingVersion.id,
    eligibleCount,
    embeddedCount,
    coverage,
    activated,
  };
}
