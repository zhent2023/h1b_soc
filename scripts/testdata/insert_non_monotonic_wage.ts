import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

const prisma = new PrismaClient();

async function main() {
  const wageYear = process.env.DEFAULT_WAGE_YEAR ?? '2025-2026';
  const areaCode = process.env.TEST_AREA_CODE ?? '35620';
  const socCode = process.env.TEST_SOC_CODE ?? '15-1252';

  const active = await prisma.datasetVersion.findFirst({
    where: { datasetName: 'oflc', isActive: true },
    select: { id: true },
  });

  if (!active) {
    throw new Error('Active OFLC dataset version not found.');
  }

  const wage = await prisma.wageRate.findFirst({
    where: {
      datasetVersionId: active.id,
      wageYear,
      areaCode,
      socCode,
    },
  });

  if (!wage) {
    throw new Error('Target wage record not found for non-monotonic test.');
  }

  const baseHourly = wage.l1Hourly ?? Math.round(wage.l1Annual / 2080);

  await prisma.wageRate.update({
    where: { id: wage.id },
    data: {
      l2Annual: wage.l1Annual - 5000,
      l2Hourly: baseHourly - 2,
      hasDataQualityIssue: true,
      dataQualityNotes: { issues: ['Injected non-monotonic wage for testing.'] },
    },
  });

  if (process.env.REDIS_URL) {
    const redis = new Redis(process.env.REDIS_URL);
    const cacheKey = `wage:${active.id}:${wageYear}:${wage.isAcwia}:${areaCode}:${socCode}`;
    await redis.del(cacheKey);
    await redis.quit();
  }

  console.log('Inserted non-monotonic wage data quality flag.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
