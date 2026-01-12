import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

const prisma = new PrismaClient();

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ');
}

async function main() {
  const socCode = process.env.TEST_SOC_CODE ?? '15-1252';

  const active = await prisma.datasetVersion.findFirst({
    where: { datasetName: 'onet', isActive: true },
    select: { id: true },
  });

  if (!active) {
    throw new Error('Active O*NET dataset version not found.');
  }

  const onetCodes = [`${socCode}.00`, `${socCode}.01`];

  await prisma.onetSocMap.deleteMany({
    where: { datasetVersionId: active.id, socCode },
  });

  await prisma.onetDuty.deleteMany({
    where: { datasetVersionId: active.id, onetCode: { in: onetCodes } },
  });

  await prisma.socTitle.createMany({
    data: [
      {
        datasetVersionId: active.id,
        socCode,
        title: 'Software Developers',
      },
    ],
    skipDuplicates: true,
  });

  await prisma.onetSocMap.createMany({
    data: onetCodes.map((code) => ({
      datasetVersionId: active.id,
      onetCode: code,
      socCode,
    })),
    skipDuplicates: true,
  });

  const dutyText = 'Coordinate deployment plans for release cycles.';
  const dutyTextAlt = 'Coordinate deployment plans for release cycles';

  const dutyBatch = onetCodes.flatMap((code) => [
    {
      datasetVersionId: active.id,
      onetCode: code,
      dutyText,
      dutyTextNorm: normalize(dutyText),
      sortOrder: 1,
    },
    {
      datasetVersionId: active.id,
      onetCode: code,
      dutyText: dutyTextAlt,
      dutyTextNorm: normalize(dutyTextAlt),
      sortOrder: 2,
    },
  ]);

  await prisma.onetDuty.createMany({
    data: dutyBatch,
    skipDuplicates: false,
  });

  if (process.env.REDIS_URL) {
    const redis = new Redis(process.env.REDIS_URL);
    await redis.del(`duties:${active.id}:${socCode}`);
    for (const code of onetCodes) {
      await redis.del(`duties:${active.id}:${code}`);
    }
    await redis.quit();
  }

  console.log('Inserted duplicate duties for dedup test.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
