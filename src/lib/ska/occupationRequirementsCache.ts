import { getPrisma } from '../../db/prisma';

export type OccupationRequirement = {
  skillId: string;
  reqWeight: number;
};

let cache: {
  entries: Map<string, OccupationRequirement[]>;
  loadedAt: Date;
  datasetVersionId: string;
} | null = null;

const TTL_MS = 10 * 60 * 1000;

export async function loadOccupationRequirements(): Promise<{
  entries: Map<string, OccupationRequirement[]>;
  datasetVersionId: string;
}> {
  if (cache && Date.now() - cache.loadedAt.getTime() < TTL_MS) {
    return { entries: cache.entries, datasetVersionId: cache.datasetVersionId };
  }

  const prisma = getPrisma();
  const datasetVersion = await prisma.datasetVersion.findFirst({
    where: { datasetName: 'onet_ska', isActive: true },
    select: { id: true },
  });

  if (!datasetVersion) {
    throw new Error('Active O*NET SKA dataset version not found.');
  }

  const rows = await prisma.occupationSkaRequirement.findMany({
    where: { datasetVersionId: datasetVersion.id },
    select: { onetCode: true, skillId: true, reqWeight: true },
  });

  const map = new Map<string, OccupationRequirement[]>();
  for (const row of rows) {
    const bucket = map.get(row.onetCode) ?? [];
    bucket.push({ skillId: row.skillId, reqWeight: row.reqWeight });
    map.set(row.onetCode, bucket);
  }

  cache = { entries: map, loadedAt: new Date(), datasetVersionId: datasetVersion.id };
  return { entries: map, datasetVersionId: datasetVersion.id };
}

export function resetOccupationRequirementsCache(): void {
  cache = null;
}
