import { PrismaClient } from '@prisma/client';

import { ensurePrismaEngineStartupLogs } from '../../src/db/prismaEnv';
import { computeOnetEmbeddings } from '../../src/lib/embeddings/computeOnetEmbeddings';
import { EMBEDDING_DIM } from '../../src/lib/embeddings/constants';
import { createEmbeddingProviderFromEnv } from '../../src/lib/embeddings/providerFactory';
import { validateVectorDimension } from '../../src/lib/embeddings/vectorUtils';

ensurePrismaEngineStartupLogs();

const prisma = new PrismaClient();
const LOCK_ID = 482901;

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function getArgValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1]) {
    return process.argv[idx + 1];
  }
  const prefix = `${flag}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

async function main() {
  const provider = createEmbeddingProviderFromEnv();
  const probe = await provider.embedQuery('healthcheck');
  validateVectorDimension(probe, EMBEDDING_DIM);

  const lockRows = await prisma.$queryRaw<{ locked: boolean }[]>`
    SELECT pg_try_advisory_lock(${LOCK_ID}) AS locked
  `;

  if (!lockRows[0]?.locked) {
    throw new Error('Another embedding compute job is already running.');
  }

  try {
    const result = await computeOnetEmbeddings({
      prisma,
      provider,
      dryRun: hasFlag('--dryRun'),
      resume: hasFlag('--resume'),
      embeddingVersionId: getArgValue('--embeddingVersionId'),
      batchSize: Number(getArgValue('--batchSize') ?? '') || undefined,
      coverageThreshold: Number(getArgValue('--coverageThreshold') ?? '') || undefined,
    });

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await prisma.$queryRaw`SELECT pg_advisory_unlock(${LOCK_ID})`;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
