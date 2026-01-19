import { describe, expect, it } from 'vitest';

import { computeMagnitude, cosineSimilarity, topK } from '../../../src/lib/ska/similarity';

describe('similarity helpers', () => {
  it('computes magnitude', () => {
    expect(computeMagnitude([3, 4])).toBe(5);
  });

  it('computes cosine similarity with zero guard', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });

  it('selects topK scores above threshold', () => {
    const scores = [0.9, 0.4, 0.8, 0.95];
    const result = topK(scores, 2, 0.75);
    expect(result).toHaveLength(2);
    expect(result[0]?.index).toBe(3);
    expect(result[1]?.index).toBe(0);
  });
});
