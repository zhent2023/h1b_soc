import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findCourses: vi.fn(),
  loadOccupationRequirements: vi.fn(),
}));

vi.mock('../../../src/db/prisma', () => ({
  getPrisma: () => ({
    transcriptInferredSka: { findMany: mocks.findMany },
    transcriptCourse: { findMany: mocks.findCourses },
  }),
}));

vi.mock('../../../src/lib/ska/occupationRequirementsCache', () => ({
  loadOccupationRequirements: mocks.loadOccupationRequirements,
}));

import { getSupportingCourses, scoreOccupations } from '../../../src/lib/ska/scoreOccupations';

describe('scoreOccupations', () => {
  beforeEach(() => {
    mocks.findMany.mockReset();
    mocks.findCourses.mockReset();
    mocks.loadOccupationRequirements.mockResolvedValue({
      datasetVersionId: 'dataset-1',
      entries: new Map([
        [
          '15-1111.00',
          [
            { skillId: 'skill-a', reqWeight: 0.6 },
            { skillId: 'skill-b', reqWeight: 0.4 },
          ],
        ],
        [
          '15-1122.00',
          [
            { skillId: 'skill-a', reqWeight: 0.1 },
            { skillId: 'skill-b', reqWeight: 0.9 },
          ],
        ],
      ]),
    });
  });

  it('ranks occupations by coverage and match', async () => {
    mocks.findMany.mockResolvedValue([
      { skillId: 'skill-a', skillWeight: 1 },
      { skillId: 'skill-b', skillWeight: 0.2 },
    ]);

    const results = await scoreOccupations('transcript-1', 2);

    expect(results).toHaveLength(2);
    expect(results[0]?.onetCode).toBe('15-1111.00');
    expect(results[0]?.final).toBeGreaterThan(results[1]?.final ?? 0);
  });

  it('aggregates evidence across multiple transcripts', async () => {
    mocks.findMany.mockResolvedValue([
      { skillId: 'skill-a', skillWeight: 0.6 },
      { skillId: 'skill-a', skillWeight: 0.4 },
      { skillId: 'skill-b', skillWeight: 0.2 },
    ]);

    await scoreOccupations(['transcript-1', 'transcript-2', 'transcript-1'], 1);

    expect(mocks.findMany).toHaveBeenCalledWith({
      where: {
        transcriptId: { in: ['transcript-1', 'transcript-2'] },
        datasetVersionId: 'dataset-1',
      },
    });
  });

  it('returns empty results when no transcript ids are provided', async () => {
    const results = await scoreOccupations([], 2);

    expect(results).toEqual([]);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it('returns supporting courses for top skills', async () => {
    mocks.findMany.mockResolvedValue([
      { skillId: 'skill-a', skillWeight: 1, courseKey: 'course-1' },
      { skillId: 'skill-b', skillWeight: 0.4, courseKey: 'course-2' },
    ]);

    mocks.findCourses.mockResolvedValue([
      { courseKey: 'course-1', title: 'Algorithms', credits: 3, grade: 'A' },
      { courseKey: 'course-2', title: 'Databases', credits: 3, grade: 'B' },
    ]);

    const results = await getSupportingCourses('transcript-1', [{ skillId: 'skill-a' }]);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.course?.title).toBe('Algorithms');
  });

  it('restricts results to selected O*NET codes', async () => {
    mocks.findMany.mockResolvedValue([
      { skillId: 'skill-a', skillWeight: 1 },
      { skillId: 'skill-b', skillWeight: 0.2 },
    ]);

    const results = await scoreOccupations('transcript-1', 3, {
      restrictOnetCodes: ['15-1111.00'],
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.onetCode).toBe('15-1111.00');
  });
});
