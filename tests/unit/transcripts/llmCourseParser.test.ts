import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  GoogleGenerativeAI: vi.fn(),
}));

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: mocks.GoogleGenerativeAI,
}));

import { parseCoursesFromText } from '../../../src/lib/transcripts/llmCourseParser';

describe('parseCoursesFromText', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalApiKey = process.env.EMBEDDING_API_KEY;

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
    delete process.env.EMBEDDING_API_KEY;
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalApiKey) {
      process.env.EMBEDDING_API_KEY = originalApiKey;
    } else {
      delete process.env.EMBEDDING_API_KEY;
    }
  });

  it('returns empty results for blank text', async () => {
    const parsed = await parseCoursesFromText('   ');
    expect(parsed.courses).toHaveLength(0);
    expect(parsed.confidence).toBe(0);
    expect(parsed.parser).toBe('heuristic');
  });

  it('extracts courses via heuristic parsing', async () => {
    const sample = [
      'CS101 Introduction to Programming 3 credits A',
      'MATH201 Calculus II 4 cr B+',
    ].join('\n');

    const parsed = await parseCoursesFromText(sample);
    expect(parsed.parser).toBe('heuristic');
    expect(parsed.courses.length).toBeGreaterThan(0);
    expect(parsed.courses[0]?.title).toContain('Introduction to Programming');
    expect(parsed.courses[0]?.credits).toBe(3);
    expect(parsed.courses[0]?.grade).toBe('A');
  });

  it('uses the LLM parser when configured', async () => {
    process.env.EMBEDDING_API_KEY = 'key';
    const generateContent = vi.fn().mockResolvedValue({
      response: {
        text: () =>
          JSON.stringify({
            courses: [{ title: 'Algorithms', credits: 3, grade: 'A' }],
            confidence: 0.9,
          }),
      },
    });
    const getGenerativeModel = vi.fn().mockReturnValue({ generateContent });
    mocks.GoogleGenerativeAI.mockImplementation(() => ({ getGenerativeModel }));

    const parsed = await parseCoursesFromText('Algorithms 3 credits A');
    expect(parsed.parser).toBe('llm');
    expect(parsed.courses[0]?.title).toBe('Algorithms');
    expect(parsed.confidence).toBe(0.9);
  });

  it('normalizes grades from LLM output', async () => {
    process.env.EMBEDDING_API_KEY = 'key';
    const generateContent = vi.fn().mockResolvedValue({
      response: {
        text: () =>
          JSON.stringify({
            courses: [{ title: 'Databases', credits: null, grade: 'PASS' }],
            confidence: 0.8,
          }),
      },
    });
    const getGenerativeModel = vi.fn().mockReturnValue({ generateContent });
    mocks.GoogleGenerativeAI.mockImplementation(() => ({ getGenerativeModel }));

    const parsed = await parseCoursesFromText('Databases');
    expect(parsed.parser).toBe('llm');
    expect(parsed.courses[0]?.grade).toBe('P');
    expect(parsed.courses[0]?.credits).toBeUndefined();
  });

  it('captures summary and skill evidence from LLM output', async () => {
    process.env.EMBEDDING_API_KEY = 'key';
    const generateContent = vi.fn().mockResolvedValue({
      response: {
        text: () =>
          JSON.stringify({
            courses: [
              {
                title: 'Marketing Research',
                credits: 3,
                grade: 'A',
                summary: 'Intro to surveys.  Skills: survey design; data analysis; sampling.',
                hasSkillEvidence: true,
              },
            ],
            confidence: 0.7,
          }),
      },
    });
    const getGenerativeModel = vi.fn().mockReturnValue({ generateContent });
    mocks.GoogleGenerativeAI.mockImplementation(() => ({ getGenerativeModel }));

    const parsed = await parseCoursesFromText('Marketing Research');
    expect(parsed.parser).toBe('llm');
    expect(parsed.courses[0]?.summary).toBe(
      'Intro to surveys. Skills: survey design; data analysis; sampling.',
    );
    expect(parsed.courses[0]?.hasSkillEvidence).toBe(true);
  });

  it('respects hasSkillEvidence=false when provided', async () => {
    process.env.EMBEDDING_API_KEY = 'key';
    const generateContent = vi.fn().mockResolvedValue({
      response: {
        text: () =>
          JSON.stringify({
            courses: [
              {
                title: 'Seminar I',
                credits: 1,
                grade: 'P',
                summary: null,
                hasSkillEvidence: false,
              },
            ],
            confidence: 0.6,
          }),
      },
    });
    const getGenerativeModel = vi.fn().mockReturnValue({ generateContent });
    mocks.GoogleGenerativeAI.mockImplementation(() => ({ getGenerativeModel }));

    const parsed = await parseCoursesFromText('Seminar I');
    expect(parsed.courses[0]?.summary).toBeUndefined();
    expect(parsed.courses[0]?.hasSkillEvidence).toBe(false);
  });

  it('falls back to heuristic when LLM parsing fails', async () => {
    process.env.EMBEDDING_API_KEY = 'key';
    const generateContent = vi.fn().mockRejectedValue(new Error('bad response'));
    const getGenerativeModel = vi.fn().mockReturnValue({ generateContent });
    mocks.GoogleGenerativeAI.mockImplementation(() => ({ getGenerativeModel }));

    const parsed = await parseCoursesFromText('CS101 Intro 3 credits A');
    expect(parsed.parser).toBe('heuristic');
    expect(parsed.courses.length).toBeGreaterThan(0);
  });

  it('falls back to heuristic when LLM returns no courses', async () => {
    process.env.EMBEDDING_API_KEY = 'key';
    const generateContent = vi.fn().mockResolvedValue({
      response: {
        text: () =>
          JSON.stringify({
            courses: [],
            confidence: 0.1,
          }),
      },
    });
    const getGenerativeModel = vi.fn().mockReturnValue({ generateContent });
    mocks.GoogleGenerativeAI.mockImplementation(() => ({ getGenerativeModel }));

    const parsed = await parseCoursesFromText('CS101 Intro 3 credits A');
    expect(parsed.parser).toBe('heuristic');
    expect(parsed.courses.length).toBeGreaterThan(0);
  });
});
