import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pdfParse: vi.fn(),
  createStorageProviderFromEnv: vi.fn(),
  parseCoursesFromText: vi.fn(),
}));

vi.mock('pdf-parse', () => ({
  default: mocks.pdfParse,
}));

vi.mock('../../../src/lib/storage', () => ({
  createStorageProviderFromEnv: mocks.createStorageProviderFromEnv,
}));

vi.mock('../../../src/lib/transcripts/llmCourseParser', () => ({
  parseCoursesFromText: mocks.parseCoursesFromText,
}));

import { pdfTextProvider } from '../../../src/lib/transcripts/providers/pdfTextProvider';

describe('pdfTextProvider', () => {
  beforeEach(() => {
    mocks.pdfParse.mockReset();
    mocks.createStorageProviderFromEnv.mockReset();
    mocks.parseCoursesFromText.mockReset();
  });

  it('reads PDF and parses courses', async () => {
    mocks.createStorageProviderFromEnv.mockReturnValue({
      readObject: vi.fn().mockResolvedValue(Buffer.from('pdf-bytes')),
    });
    mocks.pdfParse.mockResolvedValue({ text: 'CS101 3 credits A', numpages: 2 });
    mocks.parseCoursesFromText.mockResolvedValue({
      courses: [{ title: 'CS101', credits: 3, grade: 'A' }],
      confidence: 0.8,
      parser: 'heuristic',
    });

    const result = await pdfTextProvider.parseFromUrl('local://file.pdf');
    expect(result.courses).toHaveLength(1);
    expect(result.confidence).toBe(0.8);
    expect(result.usedPath).toBe('pdf_text');
    expect(result.pageCount).toBe(2);
  });

  it('handles PDFs with empty text', async () => {
    mocks.createStorageProviderFromEnv.mockReturnValue({
      readObject: vi.fn().mockResolvedValue(Buffer.from('pdf-bytes')),
    });
    mocks.pdfParse.mockResolvedValue({ text: undefined, numpages: 1 });
    mocks.parseCoursesFromText.mockResolvedValue({
      courses: [],
      confidence: 0,
      parser: 'heuristic',
    });

    const result = await pdfTextProvider.parseFromUrl('local://file.pdf');
    expect(result.courses).toHaveLength(0);
    expect(result.confidence).toBe(0);
    expect(result.pageCount).toBe(1);
  });
});
