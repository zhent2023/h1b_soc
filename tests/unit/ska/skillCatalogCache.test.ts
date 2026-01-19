import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  queryRaw: vi.fn(),
  computeMagnitude: vi.fn(() => 2),
}));

vi.mock('../../../src/db/prisma', () => ({
  getPrisma: () => ({
    datasetVersion: { findFirst: mocks.findFirst },
    $queryRaw: mocks.queryRaw,
    $queryRawUnsafe: mocks.queryRaw,
  }),
}));

vi.mock('../../../src/lib/ska/similarity', () => ({
  computeMagnitude: mocks.computeMagnitude,
}));

async function loadModule() {
  return await import('../../../src/lib/ska/skillCatalogCache');
}

describe('skillCatalogCache', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.findFirst.mockReset();
    mocks.queryRaw.mockReset();
    mocks.computeMagnitude.mockClear();
  });

  it('throws when no active dataset exists', async () => {
    const { loadSkillCatalog } = await loadModule();
    mocks.findFirst.mockResolvedValue(null);

    await expect(loadSkillCatalog()).rejects.toThrow(
      'Active O*NET SKA dataset version not found.',
    );
  });

  it('caches entries between calls', async () => {
    const { loadSkillCatalog } = await loadModule();
    mocks.findFirst.mockResolvedValue({ id: 'dataset-1' });
    mocks.queryRaw.mockResolvedValue([
      {
        skillId: 'skill-1',
        name: 'Skill One',
        taxonomyType: 'skill',
        embedding: JSON.stringify([1, 0]),
      },
    ]);

    const first = await loadSkillCatalog();
    const second = await loadSkillCatalog();

    expect(first.entries.length).toBe(1);
    expect(second.entries.length).toBe(1);
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
  });
});
