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
  const sql = getArgValue('--sql');
  if (!sql) {
    throw new Error('Provide --sql "<query>"');
  }

  const rows = await prisma.$queryRawUnsafe<any[]>(sql);
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
