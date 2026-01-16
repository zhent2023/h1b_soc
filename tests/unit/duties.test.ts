import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { getDutiesForOnetCode, getDutiesForSoc } from '../../src/lib/duties';

const cacheGet = vi.fn();
const cacheSet = vi.fn();

vi.mock('../../src/lib/cache', () => ({
  cacheGet: (...args: unknown[]) => cacheGet(...args),
  cacheSet: (...args: unknown[]) => cacheSet(...args),
}));

describe('duties', () => {
  beforeEach(() => {
    cacheGet.mockReset();
    cacheSet.mockReset();
  });

  it('returns cached O*NET duties', async () => {
    cacheGet.mockResolvedValue({ duties: [{ text: 'cached', sources: ['15-0000.00'] }] });
    const prisma = {
      onetDuty: { findMany: vi.fn() },
    } as unknown as PrismaClient;

    const result = await getDutiesForOnetCode({
      prisma,
      datasetVersionId: 'onet',
      onetCode: '15-0000.00',
    });

    expect(result.duties).toHaveLength(1);
    expect(prisma.onetDuty.findMany).not.toHaveBeenCalled();
  });

  it('returns note when no O*NET duties are found', async () => {
    cacheGet.mockResolvedValue(null);
    const prisma = {
      onetDuty: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    const result = await getDutiesForOnetCode({
      prisma,
      datasetVersionId: 'onet',
      onetCode: '15-0000.00',
    });

    expect(result.note).toContain('No O*NET tasks');
    expect(cacheSet).toHaveBeenCalled();
  });

  it('maps duties when available', async () => {
    cacheGet.mockResolvedValue(null);
    const prisma = {
      onetDuty: {
        findMany: vi.fn().mockResolvedValue([
          { dutyText: 'Duty A', onetCode: '15-0000.00' },
          { dutyText: 'Duty B', onetCode: '15-0000.00' },
        ]),
      },
    } as unknown as PrismaClient;

    const result = await getDutiesForOnetCode({
      prisma,
      datasetVersionId: 'onet',
      onetCode: '15-0000.00',
    });

    expect(result.duties).toEqual([
      { text: 'Duty A', sources: ['15-0000.00'] },
      { text: 'Duty B', sources: ['15-0000.00'] },
    ]);
  });

  it('returns note when SOC has no mappings', async () => {
    cacheGet.mockResolvedValue(null);
    const prisma = {
      onetSocMap: { findMany: vi.fn().mockResolvedValue([]) },
      onetDuty: { findMany: vi.fn() },
    } as unknown as PrismaClient;

    const result = await getDutiesForSoc({
      prisma,
      datasetVersionId: 'onet',
      socCode: '15-0000',
    });

    expect(result.note).toContain('No O*NET tasks');
    expect(prisma.onetDuty.findMany).not.toHaveBeenCalled();
  });

  it('loads duties for mapped SOC codes', async () => {
    cacheGet.mockResolvedValue(null);
    const prisma = {
      onetSocMap: {
        findMany: vi.fn().mockResolvedValue([
          { onetCode: '15-0000.00' },
          { onetCode: '15-0000.00' },
          { onetCode: '15-0001.00' },
        ]),
      },
      onetDuty: {
        findMany: vi.fn().mockResolvedValue([
          { dutyText: 'Duty A', onetCode: '15-0000.00' },
          { dutyText: 'Duty B', onetCode: '15-0001.00' },
        ]),
      },
    } as unknown as PrismaClient;

    const result = await getDutiesForSoc({
      prisma,
      datasetVersionId: 'onet',
      socCode: '15-0000',
    });

    expect(result.duties).toHaveLength(2);
    expect(cacheSet).toHaveBeenCalled();
    expect(prisma.onetDuty.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          onetCode: { in: ['15-0000.00', '15-0001.00'] },
        }),
      }),
    );
  });
});
