import { describe, expect, it } from 'vitest';

import { computeCourseKey } from '../../../src/lib/transcripts/courseKey';

describe('computeCourseKey', () => {
  it('is deterministic for same inputs', () => {
    const a = computeCourseKey('Intro to CS', 3, 'A', 'Intro to CS 3 A', 0);
    const b = computeCourseKey('Intro to CS', 3, 'A', 'Intro to CS 3 A', 0);
    expect(a).toBe(b);
  });

  it('changes when index differs', () => {
    const a = computeCourseKey('Intro to CS', 3, 'A', 'Intro to CS 3 A', 0);
    const b = computeCourseKey('Intro to CS', 3, 'A', 'Intro to CS 3 A', 1);
    expect(a).not.toBe(b);
  });

  it('normalizes titles', () => {
    const a = computeCourseKey('Intro to CS', 3, 'A', undefined, 0);
    const b = computeCourseKey('  intro to cs  ', 3, 'A', undefined, 0);
    expect(a).toBe(b);
  });

  it('handles missing optional fields', () => {
    const key = computeCourseKey('Systems', undefined, undefined, undefined, undefined);
    expect(key.length).toBeGreaterThan(0);
  });
});
