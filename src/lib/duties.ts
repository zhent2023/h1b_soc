import type { PrismaClient } from '@prisma/client';

import { cacheGet, cacheSet } from './cache';

export async function getDutiesForOnetCode(params: {
  prisma: PrismaClient;
  datasetVersionId: string;
  onetCode: string;
}): Promise<{ duties: { text: string; sources: string[] }[]; note?: string }> {
  const { prisma, datasetVersionId, onetCode } = params;
  const cacheKey = `duties:${datasetVersionId}:${onetCode}`;
  const cached = await cacheGet<{ duties: { text: string; sources: string[] }[]; note?: string }>(
    cacheKey,
  );
  if (cached) {
    return cached;
  }

  const duties = await prisma.onetDuty.findMany({
    where: {
      datasetVersionId,
      onetCode,
    },
    orderBy: { createdAt: 'asc' },
  });

  if (duties.length === 0) {
    const empty = { duties: [], note: `No O*NET tasks found for ${onetCode}.` };
    await cacheSet(cacheKey, empty, 3600);
    return empty;
  }

  const result = {
    duties: duties.map((duty) => ({
      text: duty.dutyText,
      sources: [duty.onetCode],
    })),
  };
  await cacheSet(cacheKey, result, 3600);
  return result;
}

export async function getDutiesForSoc(params: {
  prisma: PrismaClient;
  datasetVersionId: string;
  socCode: string;
}): Promise<{ duties: { text: string; sources: string[] }[]; note?: string }> {
  const { prisma, datasetVersionId, socCode } = params;
  const cacheKey = `duties:${datasetVersionId}:${socCode}`;
  const cached = await cacheGet<{ duties: { text: string; sources: string[] }[]; note?: string }>(
    cacheKey,
  );
  if (cached) {
    return cached;
  }

  const mappings = await prisma.onetSocMap.findMany({
    where: { datasetVersionId, socCode },
  });

  if (mappings.length === 0) {
    const empty = { duties: [], note: 'No O*NET tasks found.' };
    await cacheSet(cacheKey, empty, 3600);
    return empty;
  }

  const onetCodes = Array.from(new Set(mappings.map((mapping) => mapping.onetCode)));
  const duties = await prisma.onetDuty.findMany({
    where: {
      datasetVersionId,
      onetCode: { in: onetCodes },
    },
    orderBy: { createdAt: 'asc' },
  });

  const result = {
    duties: duties.map((duty) => ({
      text: duty.dutyText,
      sources: [duty.onetCode],
    })),
  };
  await cacheSet(cacheKey, result, 3600);
  return result;
}
