import { describe, expect, it } from 'vitest';

import {
  filterTranscriptCourses,
  getRulePassStatus,
  isExcludedGrade,
  isLikelyCourseRow,
  resolveCoursePassStatus,
} from '../../../src/lib/transcripts/courseFilters';

describe('courseFilters', () => {
  it('flags failed and withdrawn grades', () => {
    expect(isExcludedGrade('F')).toBe(true);
    expect(isExcludedGrade('fail')).toBe(true);
    expect(isExcludedGrade('D')).toBe(true);
    expect(isExcludedGrade('W')).toBe(true);
    expect(isExcludedGrade('WD')).toBe(true);
    expect(isExcludedGrade('WITHDRAWN')).toBe(true);
    expect(isExcludedGrade('A')).toBe(false);
  });

  it('filters out policy-like rows', () => {
    const filtered = filterTranscriptCourses([
      { title: 'Programme Specification is produced for any course on', grade: 'A' },
      { title: 'University study regulations', grade: 'A' },
      { title: 'Data Structures', credits: 3, grade: 'A' },
    ]);

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.title).toBe('Data Structures');
  });

  it('requires minimal course-like signals', () => {
    expect(
      isLikelyCourseRow({ title: 'Algorithms', grade: null, credits: null }),
    ).toBe(true);
    expect(
      isLikelyCourseRow({ title: '10 hours of student workload per', credits: 1 }),
    ).toBe(false);
  });

  it('does not treat standalone A as a grade signal', () => {
    expect(
      isLikelyCourseRow({
        title: 'A student is required to complete the program.',
        rawLine: 'A student is required to complete the program.',
      }),
    ).toBe(false);
  });

  it('infers numeric grades from raw lines', () => {
    const filtered = filterTranscriptCourses([
      {
        title: 'Spanish 1A',
        credits: 20,
        rawLine: 'INCM1017 Spanish 1A 66 20 10.0',
      },
    ]);

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.grade).toBe('66');
  });

  it('infers numeric grades from packed raw lines', () => {
    const filtered = filterTranscriptCourses([
      {
        title: 'International Communications Dissertation',
        credits: 40,
        rawLine: 'INCM3033BA International Communications Dissertation704020.0',
      },
    ]);

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.grade).toBe('70');
  });

  it('prefers model pass over rule fail', () => {
    const filtered = filterTranscriptCourses([
      {
        title: 'Networks',
        grade: '58',
        passStatus: 'pass',
        rawLine: 'CS101 Networks 58 3',
      },
    ]);

    expect(filtered).toHaveLength(1);
  });

  it('infers skill evidence from summary when missing', () => {
    const filtered = filterTranscriptCourses([
      {
        title: 'Marketing Research',
        summary: 'Overview of survey methods. Skills: survey design; data analysis.',
      },
    ]);

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.hasSkillEvidence).toBe(true);
  });

  it('requires an explicit Skills list to mark evidence', () => {
    const filtered = filterTranscriptCourses([
      {
        title: 'Seminar II',
        summary: 'General discussion of media topics.',
      },
    ]);

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.hasSkillEvidence).toBe(false);
  });

  it('keeps hasSkillEvidence=false when provided', () => {
    const filtered = filterTranscriptCourses([
      {
        title: 'Seminar I',
        summary: 'General discussion.',
        hasSkillEvidence: false,
      },
    ]);

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.hasSkillEvidence).toBe(false);
  });

  it('uses rule when model is unknown', () => {
    const resolved = resolveCoursePassStatus('unknown', '55');
    expect(resolved.finalStatus).toBe('fail');
    expect(getRulePassStatus('85')).toBe('pass');
  });
});
