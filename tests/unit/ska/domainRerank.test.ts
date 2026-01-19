import { describe, expect, it } from 'vitest';

import { rerankByDomainTags } from '../../../src/lib/ska/domainRerank';
import type { OccupationScore } from '../../../src/lib/ska/scoreOccupations';
import { extractDomainTagWeights } from '../../../src/lib/transcripts/domainTags';

describe('rerankByDomainTags', () => {
  it('boosts occupations aligned with transcript domains', () => {
    const tagWeights = extractDomainTagWeights([
      {
        title: 'Digital Media Studio',
        summary: 'Covers immersive media production and storytelling.',
        hasSkillEvidence: true,
      },
    ]);

    const scores: OccupationScore[] = [
      {
        onetCode: '11-0000.00',
        final: 0.6,
        coverage: 0.6,
        match: 0.6,
        topContributingSkills: [],
      },
      {
        onetCode: '27-0000.00',
        final: 0.59,
        coverage: 0.59,
        match: 0.59,
        topContributingSkills: [],
      },
    ];

    const titleByCode = new Map([
      ['11-0000.00', 'Farmworkers, Farm, Ranch, and Aquacultural Animals'],
      ['27-0000.00', 'Multimedia Artists and Animators'],
    ]);

    const reranked = rerankByDomainTags({
      scores,
      titleByCode,
      tagWeights,
      boost: 0.2,
    });

    expect(reranked.results[0]?.onetCode).toBe('27-0000.00');
    expect(reranked.meta?.tags.length).toBeGreaterThan(0);
  });
});

