import type { PrismaClient } from '@prisma/client';

export interface DatasetVersionLabel {
  id: string;
  datasetName: string;
  versionLabel: string;
}

export interface DatasetContext {
  oflcVersionId: string;
  onetVersionId: string;
  cbsaVersionId: string;
  labels: {
    oflc: DatasetVersionLabel;
    onet: DatasetVersionLabel;
    cbsa: DatasetVersionLabel;
  };
}

export async function captureDatasetContext(
  prisma: PrismaClient,
): Promise<DatasetContext> {
  const versions = await prisma.datasetVersion.findMany({
    where: { isActive: true },
    select: { id: true, datasetName: true, versionLabel: true },
  });

  const byName = versions.reduce<Record<string, DatasetVersionLabel>>((acc, entry) => {
    acc[entry.datasetName] = entry;
    return acc;
  }, {});

  const oflc = byName.oflc;
  const onet = byName.onet;
  const cbsa = byName.cbsa;

  if (!oflc || !onet || !cbsa) {
    const missing = ['oflc', 'onet', 'cbsa'].filter((key) => !byName[key]);
    throw new Error(`Active dataset version missing for: ${missing.join(', ')}`);
  }

  return {
    oflcVersionId: oflc.id,
    onetVersionId: onet.id,
    cbsaVersionId: cbsa.id,
    labels: { oflc, onet, cbsa },
  };
}
