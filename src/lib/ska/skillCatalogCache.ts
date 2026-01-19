import { getPrisma } from '../../db/prisma';

import { computeMagnitude } from './similarity';

export type SkillEntry = {
  skillId: string;
  name: string;
  taxonomyType: string;
  embedding: Float32Array;
  magnitude: number;
};

let cache: {
  entries: SkillEntry[];
  loadedAt: Date;
  datasetVersionId: string;
} | null = null;

const TTL_MS = 10 * 60 * 1000;

function parseVector(raw: string): Float32Array {
  const values = JSON.parse(raw) as number[];
  return new Float32Array(values);
}

export async function loadSkillCatalog(): Promise<{
  entries: SkillEntry[];
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

  const rows = await prisma.$queryRawUnsafe<
    Array<{ skillId: string; name: string; taxonomyType: string; embedding: string }>
  >(
    'SELECT "skillId", "name", "taxonomyType", "embedding"::text as embedding FROM "SkillCatalog" WHERE "datasetVersionId" = $1::uuid',
    datasetVersion.id,
  );

  const entries = rows.map((row) => {
    const embedding = parseVector(row.embedding);
    return {
      skillId: row.skillId,
      name: row.name,
      taxonomyType: row.taxonomyType,
      embedding,
      magnitude: computeMagnitude(embedding),
    };
  });

  cache = { entries, loadedAt: new Date(), datasetVersionId: datasetVersion.id };
  return { entries, datasetVersionId: datasetVersion.id };
}
