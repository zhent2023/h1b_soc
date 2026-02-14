import { PrismaClient } from '@prisma/client';

import { ensurePrismaEngineStartupLogs } from '../../src/db/prismaEnv';

ensurePrismaEngineStartupLogs();

const prisma = new PrismaClient();

async function main() {
  const extensions = await prisma.$queryRaw<{ extname: string }[]>`
    SELECT extname
    FROM pg_extension
    WHERE extname = 'vector'
  `;

  if (extensions.length === 0) {
    throw new Error('pgvector extension is not installed.');
  }

  const rows = await prisma.$queryRaw<{ distance: number }[]>`
    SELECT '[1,0,0]'::vector <=> '[1,0,0]'::vector AS distance
  `;

  const distance = rows[0]?.distance ?? null;
  console.log(JSON.stringify({ extension: 'vector', distance }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
