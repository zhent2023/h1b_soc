import { PrismaClient } from '@prisma/client';

import { ensurePrismaEngineStartupLogs } from './prismaEnv';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export function getPrisma(): PrismaClient {
  ensurePrismaEngineStartupLogs();
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = new PrismaClient();
  }

  return globalForPrisma.prisma;
}
