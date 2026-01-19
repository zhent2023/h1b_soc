import { describe, expect, it } from 'vitest';

import { extractSummarySkills } from '../../../src/lib/transcripts/summarySkills';

describe('extractSummarySkills', () => {
  it('returns an empty list when no Skills marker is present', () => {
    expect(extractSummarySkills('Intro to research methods.')).toEqual([]);
  });

  it('parses skills after the marker', () => {
    const result = extractSummarySkills(
      'Overview of statistics. Skills: data analysis; hypothesis testing; reporting.',
    );
    expect(result).toEqual(['data analysis', 'hypothesis testing', 'reporting']);
  });

  it('deduplicates skills and trims punctuation', () => {
    const result = extractSummarySkills(
      'Skills: Python; python; SQL.; SQL',
    );
    expect(result).toEqual(['Python', 'SQL']);
  });
});
