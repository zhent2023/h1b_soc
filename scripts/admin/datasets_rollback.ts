import { PrismaClient } from '@prisma/client';

import { ensurePrismaEngineStartupLogs } from '../../src/db/prismaEnv';

ensurePrismaEngineStartupLogs();

const prisma = new PrismaClient();

function getArgValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1]) {
    return process.argv[idx + 1];
  }
  const prefix = `${flag}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  if (found) {
    return found.slice(prefix.length);
  }
  return undefined;
}

async function main() {
  const datasetName = getArgValue('--dataset');
  if (!datasetName) {
    throw new Error('Provide --dataset (oflc | onet | cbsa).');
  }

  const active = await prisma.datasetVersion.findFirst({
    where: { datasetName, isActive: true },
    orderBy: { createdAt: 'desc' },
  });

  if (!active) {
    throw new Error(`No active version found for ${datasetName}.`);
  }

  const previous = await prisma.datasetVersion.findFirst({
    where: { datasetName, id: { not: active.id } },
    orderBy: { createdAt: 'desc' },
  });

  if (!previous) {
    throw new Error(`No previous version found for ${datasetName}.`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.datasetVersion.update({
      where: { id: active.id },
      data: { isActive: false },
    });
    await tx.datasetVersion.update({
      where: { id: previous.id },
      data: { isActive: true },
    });
  });

  console.log(
    `Rolled back ${datasetName} from ${active.versionLabel} to ${previous.versionLabel}.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
