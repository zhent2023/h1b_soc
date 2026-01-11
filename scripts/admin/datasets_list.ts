import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.datasetVersion.findMany({
    orderBy: [{ datasetName: 'asc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      datasetName: true,
      versionLabel: true,
      isActive: true,
      createdAt: true,
    },
  });

  console.log(JSON.stringify(rows, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
