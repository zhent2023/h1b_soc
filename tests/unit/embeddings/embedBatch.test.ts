import { describe, expect, it, vi } from 'vitest';

import { embedBatch } from '../../../src/lib/embeddings/embedBatch';

function createProvider(providerId = 'stub') {
  return {
    provider: providerId,
    model: 'test-model',
    embedDocuments: vi.fn(async (texts: string[]) =>
      texts.map((text) => [text.length]),
    ),
  };
}

describe('embedBatch', () => {
  it('batches requests and preserves order', async () => {
    const provider = createProvider();
    const texts = ['a', 'bb', 'ccc', 'dddd'];

    const result = await embedBatch(provider, texts, 2);

    expect(provider.embedDocuments).toHaveBeenCalledTimes(2);
    expect(result).toEqual([[1], [2], [3], [4]]);
  });

  it('logs batch metrics for gemini providers', async () => {
    const provider = createProvider('gemini');
    const texts = ['one'];

    const result = await embedBatch(provider, texts, 10);

    expect(provider.embedDocuments).toHaveBeenCalledTimes(1);
    expect(result).toEqual([[3]]);
  });

  it('skips metric logging when there are no texts', async () => {
    const provider = createProvider('gemini');
    const result = await embedBatch(provider, [], 10);
    expect(provider.embedDocuments).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });
});
