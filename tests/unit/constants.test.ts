import type { PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { captureDatasetContext } from '../../src/lib/constants';

describe('captureDatasetContext', () => {
  it('returns active dataset versions when present', async () => {
    const prisma = {
      datasetVersion: {
        findMany: async () => [
          { id: 'oflc-id', datasetName: 'oflc', versionLabel: '2024' },
          { id: 'onet-id', datasetName: 'onet', versionLabel: '2024' },
          { id: 'cbsa-id', datasetName: 'cbsa', versionLabel: '2024' },
        ],
      },
    } as unknown as PrismaClient;

    const result = await captureDatasetContext(prisma);
    expect(result.oflcVersionId).toBe('oflc-id');
    expect(result.onetVersionId).toBe('onet-id');
    expect(result.cbsaVersionId).toBe('cbsa-id');
    expect(result.labels.onet.datasetName).toBe('onet');
  });

  it('throws when a dataset version is missing', async () => {
    const prisma = {
      datasetVersion: {
        findMany: async () => [
          { id: 'oflc-id', datasetName: 'oflc', versionLabel: '2024' },
          { id: 'onet-id', datasetName: 'onet', versionLabel: '2024' },
        ],
      },
    } as unknown as PrismaClient;

    await expect(captureDatasetContext(prisma)).rejects.toThrow(/cbsa/i);
  });
});
