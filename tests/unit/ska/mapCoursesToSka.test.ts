import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createMany: vi.fn().mockResolvedValue({ count: 0 }),
  loadSkillCatalog: vi.fn(),
}));

vi.mock('../../../src/db/prisma', () => ({
  getPrisma: () => ({
    transcriptInferredSka: { createMany: mocks.createMany },
  }),
}));

vi.mock('../../../src/lib/ska/skillCatalogCache', () => ({
  loadSkillCatalog: mocks.loadSkillCatalog,
}));

import { getCreditsWeight, getGradeWeight, mapCoursesToSka } from '../../../src/lib/ska/mapCoursesToSka';

const skillEntries = [
  {
    skillId: 'skill-1',
    name: 'Skill One',
    taxonomyType: 'skill',
    embedding: new Float32Array([1, 0]),
    magnitude: 1,
  },
  {
    skillId: 'skill-2',
    name: 'Skill Two',
    taxonomyType: 'skill',
    embedding: new Float32Array([0, 1]),
    magnitude: 1,
  },
];

describe('mapCoursesToSka', () => {
  beforeEach(() => {
    mocks.createMany.mockClear();
    mocks.loadSkillCatalog.mockResolvedValue({
      entries: skillEntries,
      datasetVersionId: 'dataset-1',
    });
  });

  it('maps course embeddings to top matching skills', async () => {
    const results = await mapCoursesToSka('transcript-1', [
      {
        courseKey: 'course-1',
        title: 'Data Analysis',
        embedding: [1, 0],
        embeddingModelId: 'model-1',
        credits: 3,
        grade: 'A',
      },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0]?.skillId).toBe('skill-1');
    expect(mocks.createMany).toHaveBeenCalledTimes(1);
    expect(mocks.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            transcriptId: 'transcript-1',
            skillId: 'skill-1',
          }),
        ]),
      }),
    );
  });

  it('skips generic course titles', async () => {
    const results = await mapCoursesToSka('transcript-1', [
      {
        courseKey: 'course-2',
        title: 'Seminar',
        embedding: [1, 0],
        embeddingModelId: 'model-1',
      },
    ]);

    expect(results).toHaveLength(0);
    expect(mocks.createMany).not.toHaveBeenCalled();
  });

  it('skips courses with empty embeddings', async () => {
    const results = await mapCoursesToSka('transcript-1', [
      {
        courseKey: 'course-3',
        title: 'Algorithms',
        embedding: [],
        embeddingModelId: 'model-1',
      },
    ]);

    expect(results).toHaveLength(0);
    expect(mocks.createMany).not.toHaveBeenCalled();
  });

  it('skips failed or withdrawn courses', async () => {
    const results = await mapCoursesToSka('transcript-1', [
      {
        courseKey: 'course-4',
        title: 'Operating Systems',
        embedding: [1, 0],
        embeddingModelId: 'model-1',
        grade: 'F',
      },
      {
        courseKey: 'course-5',
        title: 'Databases',
        embedding: [1, 0],
        embeddingModelId: 'model-1',
        grade: 'W',
      },
    ]);

    expect(results).toHaveLength(0);
    expect(mocks.createMany).not.toHaveBeenCalled();
  });

  it('skips courses without skill evidence', async () => {
    const results = await mapCoursesToSka('transcript-1', [
      {
        courseKey: 'course-7',
        title: 'Seminar',
        embedding: [1, 0],
        embeddingModelId: 'model-1',
        hasSkillEvidence: false,
      },
    ]);

    expect(results).toHaveLength(0);
    expect(mocks.createMany).not.toHaveBeenCalled();
  });

  it('keeps courses when model marks pass', async () => {
    const results = await mapCoursesToSka('transcript-1', [
      {
        courseKey: 'course-6',
        title: 'Systems',
        embedding: [1, 0],
        embeddingModelId: 'model-1',
        grade: 'F',
        passStatus: 'pass',
      },
    ]);

    expect(results).toHaveLength(1);
    expect(mocks.createMany).toHaveBeenCalledTimes(1);
  });

  it('falls back when scores are below the primary threshold', async () => {
    const results = await mapCoursesToSka('transcript-1', [
      {
        courseKey: 'course-1',
        title: 'Social Science',
        embedding: [0.5, 0.5],
        embeddingModelId: 'model-1',
      },
    ]);

    expect(results.length).toBeGreaterThan(0);
    expect(mocks.createMany).toHaveBeenCalledTimes(1);
  });

  it('weights credits and grades', () => {
    expect(getCreditsWeight(6)).toBe(1.5);
    expect(getCreditsWeight(1)).toBeCloseTo(0.5);
    expect(getCreditsWeight(0)).toBe(1);
    expect(getCreditsWeight(undefined)).toBe(1);
    expect(getGradeWeight('B+')).toBeCloseTo(0.9);
    expect(getGradeWeight('F')).toBeCloseTo(0.2);
    expect(getGradeWeight('Pass')).toBe(1);
    expect(getGradeWeight('3.0')).toBeCloseTo(0.75);
    expect(getGradeWeight('85')).toBeCloseTo(0.85);
  });
});
