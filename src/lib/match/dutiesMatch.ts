import type { PrismaClient } from '@prisma/client';

import { createEmbeddingProviderFromEnv } from '../embeddings/providerFactory';
import { toVectorLiteral } from '../embeddings/vectorUtils';

const MAX_INPUT_LENGTH = 8000;

class DutiesMatchTimeoutError extends Error {
  status: number;

  constructor(message: string) {
    super(message);
    this.status = 504;
  }
}

class EmbeddingsNotReadyError extends Error {
  status: number;
  code: string;

  constructor(message: string) {
    super(message);
    this.status = 503;
    this.code = 'EMBEDDINGS_NOT_READY';
  }
}
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function computeConfidenceScores(values: number[]): number[] {
  const bounded = values.map((value) => clamp(value, 0, 1));
  if (bounded.length === 0) return [];
  const min = Math.min(...bounded);
  const max = Math.max(...bounded);
  const range = max - min;
  const normalized =
    range < 1e-6 ? bounded.map(() => 0.5) : bounded.map((value) => (value - min) / range);
  const power = 1.4;
  const displayMin = 0.5 + Math.random() * 0.1;
  const displayMax = 0.9 + Math.random() * 0.08;
  const spread = displayMax - displayMin;
  return normalized.map((value) =>
    clamp(displayMin + Math.pow(value, power) * spread, 0, 1),
  );
}

export type DutiesMatchItem = {
  onetCode: string;
  distance: number;
  similarity: number;
  confidence: number;
};

export type DutiesMatchResult = {
  items: DutiesMatchItem[];
  onetCodes: string[];
  embeddingVersionId: string;
  onetDatasetVersionId: string;
  internalTopK: number;
  outputTopK: number;
  inputLength: number;
  inputTruncated: boolean;
};

export async function matchDuties(params: {
  prisma: PrismaClient;
  dutiesText: string;
  internalTopK: number;
  outputTopK: number;
  statementTimeoutMs: number;
}): Promise<DutiesMatchResult> {
  const rawInput = params.dutiesText.trim();
  const inputLength = rawInput.length;
  const inputTruncated = rawInput.length > MAX_INPUT_LENGTH;
  const dutiesText = rawInput.slice(0, MAX_INPUT_LENGTH);

  const embeddingVersion = await params.prisma.onetEmbeddingVersion.findFirst({
    where: { isActive: true },
    select: { id: true, onetDatasetVersionId: true },
  });

  if (!embeddingVersion) {
    throw new EmbeddingsNotReadyError('Embeddings not ready');
  }

  const provider = createEmbeddingProviderFromEnv();
  const queryVector = await provider.embedQuery(dutiesText);
  const vectorLiteral = toVectorLiteral(queryVector);

  let rows: Array<{ onetCode: string; distance: number }> = [];
  try {
    rows = await params.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${params.statementTimeoutMs}`);

      if (process.env.NODE_ENV === 'test' && process.env.TEST_INJECT_DB_SLEEP_MS) {
        const sleepMs = Number(process.env.TEST_INJECT_DB_SLEEP_MS);
        if (Number.isFinite(sleepMs) && sleepMs > 0) {
          await tx.$executeRawUnsafe('SELECT pg_sleep($1::float)', sleepMs / 1000);
        }
      }

      return tx.$queryRawUnsafe<Array<{ onetCode: string; distance: number }>>(
        'SELECT "onetCode", ("embedding" <=> $1::vector) AS distance FROM "OnetDutyEmbedding" WHERE "embeddingVersionId" = $2::uuid ORDER BY "embedding" <=> $1::vector ASC LIMIT $3',
        vectorLiteral,
        embeddingVersion.id,
        params.internalTopK,
      );
    });
  } catch (error) {
    const errorInfo = error as { code?: string; meta?: { code?: string } };
    const pgCode = errorInfo.code === 'P2010' ? errorInfo.meta?.code : errorInfo.code;
    if (pgCode === '57014') {
      throw new DutiesMatchTimeoutError('Query timeout');
    }
    throw error;
  }

  const trimmedRows = rows.slice(0, params.outputTopK);
  const rawSimilarities = trimmedRows.map((row) => clamp(1 - row.distance / 2, 0, 1));
  const confidenceScores = computeConfidenceScores(rawSimilarities);
  const items = trimmedRows.map((row, idx) => ({
    onetCode: row.onetCode,
    distance: row.distance,
    similarity: rawSimilarities[idx] ?? clamp(1 - row.distance / 2, 0, 1),
    confidence: confidenceScores[idx] ?? 0,
  }));

  return {
    items,
    onetCodes: trimmedRows.map((row) => row.onetCode),
    embeddingVersionId: embeddingVersion.id,
    onetDatasetVersionId: embeddingVersion.onetDatasetVersionId,
    internalTopK: params.internalTopK,
    outputTopK: params.outputTopK,
    inputLength,
    inputTruncated,
  };
}

export { DutiesMatchTimeoutError, EmbeddingsNotReadyError };
