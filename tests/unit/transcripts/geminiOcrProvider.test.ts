import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createStorageProviderFromEnv: vi.fn(),
  GoogleGenerativeAI: vi.fn(),
}));

vi.mock('../../../src/lib/storage', () => ({
  createStorageProviderFromEnv: mocks.createStorageProviderFromEnv,
}));

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: mocks.GoogleGenerativeAI,
}));

import { geminiOcrProvider } from '../../../src/lib/transcripts/providers/geminiOcrProvider';

describe('geminiOcrProvider', () => {
  const originalKey = process.env.EMBEDDING_API_KEY;
  const originalWindow = globalThis.window;

  beforeEach(() => {
    mocks.createStorageProviderFromEnv.mockReset();
    mocks.GoogleGenerativeAI.mockReset();
  });

  afterEach(() => {
    globalThis.window = originalWindow;
    if (originalKey) {
      process.env.EMBEDDING_API_KEY = originalKey;
    } else {
      delete process.env.EMBEDDING_API_KEY;
    }
  });

  it('returns empty results when API key is missing', async () => {
    delete process.env.EMBEDDING_API_KEY;
    const result = await geminiOcrProvider.parseFromUrl('local://file.pdf');
    expect(result.courses).toHaveLength(0);
    expect(result.confidence).toBe(0);
    expect(result.usedPath).toBe('ocr');
  });

  it('throws when executed in a browser context', async () => {
    process.env.EMBEDDING_API_KEY = 'key';
    // @ts-expect-error - simulate window in test runtime
    globalThis.window = {};
    await expect(geminiOcrProvider.parseFromUrl('local://file.pdf')).rejects.toThrow(
      'Transcript OCR must run server-side.',
    );
  });

  it('parses OCR response when API key exists', async () => {
    process.env.EMBEDDING_API_KEY = 'key';
    mocks.createStorageProviderFromEnv.mockReturnValue({
      readObject: vi.fn().mockResolvedValue(Buffer.from('pdf-bytes')),
    });

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

    const result = await geminiOcrProvider.parseFromUrl('local://file.pdf');
    expect(result.courses).toHaveLength(1);
    expect(result.courses[0]?.title).toBe('Algorithms');
    expect(result.confidence).toBe(0.9);
    expect(result.usedPath).toBe('ocr');
  });

  it('captures summary and skill evidence from OCR output', async () => {
    process.env.EMBEDDING_API_KEY = 'key';
    mocks.createStorageProviderFromEnv.mockReturnValue({
      readObject: vi.fn().mockResolvedValue(Buffer.from('pdf-bytes')),
    });

    const generateContent = vi.fn().mockResolvedValue({
      response: {
        text: () =>
          JSON.stringify({
            courses: [
              {
                title: 'Data Mining',
                credits: 3,
                grade: 'A',
                summary: 'Covers clustering.  Skills: clustering; feature engineering; evaluation.',
                hasSkillEvidence: true,
              },
            ],
            confidence: 0.7,
          }),
      },
    });
    const getGenerativeModel = vi.fn().mockReturnValue({ generateContent });
    mocks.GoogleGenerativeAI.mockImplementation(() => ({ getGenerativeModel }));

    const result = await geminiOcrProvider.parseFromUrl('local://file.pdf');
    expect(result.courses[0]?.summary).toBe(
      'Covers clustering. Skills: clustering; feature engineering; evaluation.',
    );
    expect(result.courses[0]?.hasSkillEvidence).toBe(true);
  });

  it('returns empty results on OCR errors', async () => {
    process.env.EMBEDDING_API_KEY = 'key';
    mocks.createStorageProviderFromEnv.mockReturnValue({
      readObject: vi.fn().mockResolvedValue(Buffer.from('pdf-bytes')),
    });
    const generateContent = vi.fn().mockRejectedValue(new Error('bad response'));
    const getGenerativeModel = vi.fn().mockReturnValue({ generateContent });
    mocks.GoogleGenerativeAI.mockImplementation(() => ({ getGenerativeModel }));

    const result = await geminiOcrProvider.parseFromUrl('local://file.pdf');
    expect(result.courses).toHaveLength(0);
    expect(result.confidence).toBe(0);
  });
});
