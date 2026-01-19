import { afterEach, describe, expect, it, vi } from 'vitest';

import { EMBEDDING_DIM } from '../../../src/lib/embeddings/constants';
import { createRealProvider } from '../../../src/lib/embeddings/providerReal';

const makeVector = (value = 0) => Array.from({ length: EMBEDDING_DIM }, () => value);

describe('providerReal', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('rejects browser usage', () => {
    (globalThis as { window?: unknown }).window = {};
    expect(() =>
      createRealProvider({ provider: 'openai', model: 'text', apiKey: 'key' }),
    ).toThrow(/server-side/i);
    delete (globalThis as { window?: unknown }).window;
  });

  it('rejects missing configuration', () => {
    expect(() =>
      createRealProvider({ provider: 'openai', model: '', apiKey: 'key' }),
    ).toThrow(/EMBEDDING_MODEL/);
    expect(() =>
      createRealProvider({ provider: 'openai', model: 'text', apiKey: undefined }),
    ).toThrow(/EMBEDDING_API_KEY/);
  });

  it('embeds documents and queries', async () => {
    const vectors = [makeVector(0), makeVector(1)];
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: vectors.map((embedding) => ({ embedding })) }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ embedding: makeVector(2) }] }),
      });

    const provider = createRealProvider({ provider: 'openai', model: 'text', apiKey: 'key' });
    const docs = await provider.embedDocuments(['a', 'b']);
    expect(docs).toEqual(vectors);

    const query = await provider.embedQuery('c');
    expect(query).toHaveLength(EMBEDDING_DIM);
  });

  it('throws on non-ok responses', async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'fail',
    });

    const provider = createRealProvider({ provider: 'openai', model: 'text', apiKey: 'key' });
    const promise = provider.embedQuery('oops');
    const expectation = expect(promise).rejects.toThrow(/500/);
    await vi.runAllTimersAsync();
    await expectation;
  });

  it('throws on mismatched embedding counts', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });

    const provider = createRealProvider({ provider: 'openai', model: 'text', apiKey: 'key' });
    await expect(provider.embedDocuments(['a', 'b'])).rejects.toThrow(/unexpected result count/i);
  });

  it('validates embedding dimensions', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [0, 1, 2] }] }),
    });

    const provider = createRealProvider({ provider: 'openai', model: 'text', apiKey: 'key' });
    await expect(provider.embedQuery('short')).rejects.toThrow(/dimension/i);
  });

  it('retries on fetch errors and surfaces failure', async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down'));

    const provider = createRealProvider({ provider: 'openai', model: 'text', apiKey: 'key' });
    const promise = provider.embedQuery('oops');
    const expectation = expect(promise).rejects.toThrow(/network down/);
    await vi.runAllTimersAsync();
    await expectation;
  });
});
