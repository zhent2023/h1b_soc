import { createHash } from 'crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { normalizeCourseTitle } from '../../../src/lib/text/normalizeCourseTitle';
import { extractSummarySkills } from '../../../src/lib/transcripts/summarySkills';

const TEXT_POLICY = 'skills_only_v1';

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  executeRawUnsafe: vi.fn(),
  embedBatch: vi.fn(),
  createEmbeddingProviderFromEnv: vi.fn(),
}));

vi.mock('../../../src/db/prisma', () => ({
  getPrisma: () => ({
    $queryRaw: mocks.queryRaw,
    $executeRawUnsafe: mocks.executeRawUnsafe,
  }),
}));

vi.mock('../../../src/lib/embeddings/embedBatch', () => ({
  embedBatch: mocks.embedBatch,
}));

vi.mock('../../../src/lib/embeddings/providerFactory', () => ({
  createEmbeddingProviderFromEnv: mocks.createEmbeddingProviderFromEnv,
}));

import { getCourseEmbeddings } from '../../../src/lib/courses/getCourseEmbeddings';

function buildHash(title: string, model: string, summary?: string) {
  const skills = extractSummarySkills(summary);
  const courseText =
    skills.length >= 2
      ? `Skills: ${skills.join('; ')}`
      : `College course title: ${normalizeCourseTitle(title)}`;
  return createHash('sha256')
    .update(`${courseText}\n${model}\n${TEXT_POLICY}`)
    .digest('hex')
    .slice(0, 32);
}

describe('getCourseEmbeddings', () => {
  beforeEach(() => {
    mocks.queryRaw.mockReset();
    mocks.executeRawUnsafe.mockReset();
    mocks.embedBatch.mockReset();
    mocks.createEmbeddingProviderFromEnv.mockReset();
  });

  it('returns cached embeddings when available', async () => {
    const provider = { model: 'model-1', provider: 'stub' };
    mocks.createEmbeddingProviderFromEnv.mockReturnValue(provider);
    const hash = buildHash('Intro to CS', provider.model);
    const cachedEmbedding = Array.from({ length: 3072 }, () => 0.01);
    mocks.queryRaw.mockResolvedValue([
      { courseTextHash: hash, embedding: JSON.stringify(cachedEmbedding) },
    ]);

    const results = await getCourseEmbeddings([
      { courseKey: 'course-1', title: 'Intro to CS' },
    ]);

    const entry = results.get('course-1');
    expect(entry?.cacheHit).toBe(true);
    expect(entry?.embedding).toEqual(cachedEmbedding);
    expect(mocks.embedBatch).not.toHaveBeenCalled();
    expect(mocks.executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('computes and stores embeddings for cache misses', async () => {
    const provider = { model: 'model-2', provider: 'stub' };
    mocks.createEmbeddingProviderFromEnv.mockReturnValue(provider);
    mocks.queryRaw.mockResolvedValue([]);
    const generatedEmbedding = Array.from({ length: 3072 }, () => 0.02);
    mocks.embedBatch.mockResolvedValue([generatedEmbedding]);
    mocks.executeRawUnsafe.mockResolvedValue(1);

    const results = await getCourseEmbeddings([
      { courseKey: 'course-2', title: 'Data Structures' },
    ]);

    const entry = results.get('course-2');
    expect(entry?.cacheHit).toBe(false);
    expect(entry?.embedding).toEqual(generatedEmbedding);
    expect(mocks.embedBatch).toHaveBeenCalledTimes(1);
    expect(mocks.executeRawUnsafe).toHaveBeenCalledTimes(1);
  });

  it('returns empty result for empty input', async () => {
    const provider = { model: 'model-3', provider: 'stub' };
    mocks.createEmbeddingProviderFromEnv.mockReturnValue(provider);

    const results = await getCourseEmbeddings([]);
    expect(results.size).toBe(0);
    expect(mocks.queryRaw).not.toHaveBeenCalled();
    expect(mocks.embedBatch).not.toHaveBeenCalled();
  });

  it('embeds only the Skills list when present', async () => {
    const provider = { model: 'model-5', provider: 'stub' };
    mocks.createEmbeddingProviderFromEnv.mockReturnValue(provider);
    mocks.queryRaw.mockResolvedValue([]);
    const generatedEmbedding = Array.from({ length: 3072 }, () => 0.03);
    mocks.embedBatch.mockResolvedValue([generatedEmbedding]);
    mocks.executeRawUnsafe.mockResolvedValue(1);

    await getCourseEmbeddings([
      {
        courseKey: 'course-4',
        title: 'Data Visualization',
        summary: 'Intro to charts. Skills: data visualization; chart design; storytelling.',
      },
    ]);

    expect(mocks.embedBatch).toHaveBeenCalledWith(
      provider,
      ['Skills: data visualization; chart design; storytelling'],
      64,
    );
  });

  it('skips courses when embeddings are missing', async () => {
    const provider = { model: 'model-4', provider: 'stub' };
    mocks.createEmbeddingProviderFromEnv.mockReturnValue(provider);
    mocks.queryRaw.mockResolvedValue([]);
    mocks.embedBatch.mockResolvedValue([]);

    const results = await getCourseEmbeddings([
      { courseKey: 'course-3', title: 'Operating Systems' },
    ]);

    expect(results.size).toBe(0);
  });
});
