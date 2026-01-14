import { PrismaClient } from '@prisma/client';

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
  const versionId = getArgValue('--versionId');
  const versionLabel = getArgValue('--versionLabel');

  if (!datasetName) {
    throw new Error('Provide --dataset (oflc | onet | cbsa | city_county).');
  }
  if (!versionId && !versionLabel) {
    throw new Error('Provide --versionId or --versionLabel.');
  }

  const target = versionId
    ? await prisma.datasetVersion.findUnique({ where: { id: versionId } })
    : await prisma.datasetVersion.findFirst({
        where: { datasetName, versionLabel: versionLabel ?? '' },
        orderBy: { createdAt: 'desc' },
      });

  if (!target) {
    throw new Error('Target dataset version not found.');
  }

  await prisma.$transaction(async (tx) => {
    await tx.datasetVersion.updateMany({
      where: { datasetName, isActive: true },
      data: { isActive: false },
    });
    await tx.datasetVersion.update({
      where: { id: target.id },
      data: { isActive: true },
    });
  });

  console.log(
    `Activated ${target.datasetName} version ${target.versionLabel} (${target.id}).`,
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
