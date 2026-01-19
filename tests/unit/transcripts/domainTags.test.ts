import { describe, expect, it } from 'vitest';

import {
  computeDomainMatchScore,
  extractDomainTagWeights,
} from '../../../src/lib/transcripts/domainTags';

describe('domain tag extraction', () => {
  it('extracts domain tags from course title and summary', () => {
    const weights = extractDomainTagWeights([
      {
        title: 'Virtual Reality Storytelling',
        summary: 'Explores immersive media design and narrative techniques.',
        hasSkillEvidence: true,
      },
    ]);

    expect(weights.size).toBeGreaterThan(0);
    expect(weights.get('vr_ar')).toBeGreaterThan(0);
    expect(weights.get('digital_media')).toBeGreaterThan(0);
  });

  it('scores occupations higher when titles match tags', () => {
    const weights = extractDomainTagWeights([
      {
        title: 'Digital Media Production',
        summary: 'Covers video, editing, and media workflows.',
        hasSkillEvidence: true,
      },
    ]);

    const matchScore = computeDomainMatchScore(
      'Multimedia Artists and Animators',
      weights,
    );
    const nonMatchScore = computeDomainMatchScore('Farmworkers, Farm, Ranch, and Aquacultural Animals', weights);

    expect(matchScore).toBeGreaterThan(0);
    expect(nonMatchScore).toBe(0);
  });
});

