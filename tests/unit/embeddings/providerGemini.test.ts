import { afterEach, describe, expect, it, vi } from 'vitest';

import { EMBEDDING_DIM } from '../../../src/lib/embeddings/constants';
import { createGeminiProvider } from '../../../src/lib/embeddings/providerGemini';

const makeVector = (value = 0) => Array.from({ length: EMBEDDING_DIM }, () => value);

describe('providerGemini', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('rejects browser usage', () => {
    (globalThis as { window?: unknown }).window = {};
    expect(() => createGeminiProvider({ model: 'gemini-embedding-001', apiKey: 'key' })).toThrow(
      /server-side/i,
    );
    delete (globalThis as { window?: unknown }).window;
  });

  it('rejects missing configuration', () => {
    expect(() => createGeminiProvider({ model: '', apiKey: 'key' })).toThrow(/EMBEDDING_MODEL/);
    expect(() => createGeminiProvider({ model: 'gemini-embedding-001', apiKey: undefined })).toThrow(
      /EMBEDDING_API_KEY/,
    );
  });

  it('normalizes model aliases', () => {
    const provider = createGeminiProvider({ model: 'gemini-embedding-1.0', apiKey: 'key' });
    expect(provider.model).toBe('models/gemini-embedding-001');
  });

  it('keeps models/ prefix', () => {
    const provider = createGeminiProvider({ model: 'models/gemini-embedding-001', apiKey: 'key' });
    expect(provider.model).toBe('models/gemini-embedding-001');
  });

  it('returns empty embeddings for empty input', async () => {
    globalThis.fetch = vi.fn();
    const provider = createGeminiProvider({ model: 'gemini-embedding-001', apiKey: 'key' });
    const result = await provider.embedDocuments([]);
    expect(result).toEqual([]);
  });

  it('embeds documents and queries', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          embeddings: [{ values: makeVector(1) }, { values: makeVector(2) }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embedding: { values: makeVector(3) } }),
      });

    const provider = createGeminiProvider({ model: 'gemini-embedding-001', apiKey: 'key' });
    const docs = await provider.embedDocuments(['a', 'b']);
    expect(docs).toHaveLength(2);
    const query = await provider.embedQuery('q');
    expect(query).toHaveLength(EMBEDDING_DIM);
  });

  it('throws on non-ok responses', async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'bad',
    });

    const provider = createGeminiProvider({ model: 'gemini-embedding-001', apiKey: 'key' });
    const promise = provider.embedQuery('oops');
    const expectation = expect(promise).rejects.toThrow(/400/);
    await vi.runAllTimersAsync();
    await expectation;
  });

  it('throws on missing embedding values', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: {} }),
    });

    const provider = createGeminiProvider({ model: 'gemini-embedding-001', apiKey: 'key' });
    await expect(provider.embedQuery('oops')).rejects.toThrow(/missing values/i);
  });

  it('throws when batch embedding count mismatches', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embeddings: [] }),
    });

    const provider = createGeminiProvider({ model: 'gemini-embedding-001', apiKey: 'key' });
    await expect(provider.embedDocuments(['a'])).rejects.toThrow(/unexpected result count/i);
  });
});
