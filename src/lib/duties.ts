import type { PrismaClient } from '@prisma/client';

import { cacheGet, cacheSet } from './cache';

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function dedupeDuties(
  duties: { text: string; sources: string[] }[],
  threshold: number,
): { text: string; sources: string[] }[] {
  const sorted = [...duties].sort((a, b) => a.text.localeCompare(b.text));
  const results: { text: string; sources: string[]; tokens: Set<string> }[] = [];

  for (const duty of sorted) {
    const tokens = tokenize(duty.text);
    let merged = false;
    for (const existing of results) {
      if (jaccard(tokens, existing.tokens) >= threshold) {
        existing.sources = Array.from(new Set([...existing.sources, ...duty.sources])).sort();
        merged = true;
        break;
      }
    }
    if (!merged) {
      results.push({ text: duty.text, sources: [...duty.sources].sort(), tokens });
    }
  }

  return results.map(({ text, sources }) => ({ text, sources }));
}

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
    orderBy: { dutyText: 'asc' },
  });

  if (duties.length === 0) {
    const empty = { duties: [], note: `No O*NET duties found for ${onetCode}.` };
    await cacheSet(cacheKey, empty, 3600);
    return empty;
  }

  const threshold = Number(process.env.DUTY_SIMILARITY_THRESHOLD ?? '0.85');
  const deduped = dedupeDuties(
    duties.map((duty) => ({
      text: duty.dutyText,
      sources: [duty.onetCode],
    })),
    Number.isFinite(threshold) ? threshold : 0.85,
  );
  const result = { duties: deduped };
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
    const empty = { duties: [], note: 'No O*NET mappings found.' };
    await cacheSet(cacheKey, empty, 3600);
    return empty;
  }

  const onetCodes = Array.from(new Set(mappings.map((mapping) => mapping.onetCode)));
  const duties = await prisma.onetDuty.findMany({
    where: {
      datasetVersionId,
      onetCode: { in: onetCodes },
    },
    orderBy: { dutyText: 'asc' },
  });

  const threshold = Number(process.env.DUTY_SIMILARITY_THRESHOLD ?? '0.85');
  const deduped = dedupeDuties(
    duties.map((duty) => ({
      text: duty.dutyText,
      sources: [duty.onetCode],
    })),
    Number.isFinite(threshold) ? threshold : 0.85,
  );
  const result = { duties: deduped };
  await cacheSet(cacheKey, result, 3600);
  return result;
}
