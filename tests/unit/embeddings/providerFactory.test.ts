import { describe, expect, it, vi, afterEach } from 'vitest';

const stubProvider = { provider: 'stub', model: 'stub', embedDocuments: vi.fn(), embedQuery: vi.fn() };
const geminiProvider = { provider: 'gemini', model: 'models/gemini-embedding-001', embedDocuments: vi.fn(), embedQuery: vi.fn() };
const realProvider = { provider: 'openai', model: 'text-embedding', embedDocuments: vi.fn(), embedQuery: vi.fn() };

vi.mock('../../../src/lib/embeddings/providerStub', () => ({
  createStubProvider: vi.fn(() => stubProvider),
}));
vi.mock('../../../src/lib/embeddings/providerGemini', () => ({
  createGeminiProvider: vi.fn(() => geminiProvider),
}));
vi.mock('../../../src/lib/embeddings/providerReal', () => ({
  createRealProvider: vi.fn(() => realProvider),
}));

async function loadFactory() {
  vi.resetModules();
  return import('../../../src/lib/embeddings/providerFactory');
}

describe('createEmbeddingProviderFromEnv', () => {
  const previousProvider = process.env.EMBEDDING_PROVIDER;
  const previousModel = process.env.EMBEDDING_MODEL;

  afterEach(() => {
    if (previousProvider === undefined) {
      delete process.env.EMBEDDING_PROVIDER;
    } else {
      process.env.EMBEDDING_PROVIDER = previousProvider;
    }
    if (previousModel === undefined) {
      delete process.env.EMBEDDING_MODEL;
    } else {
      process.env.EMBEDDING_MODEL = previousModel;
    }
  });

  it('returns stub provider by default', async () => {
    delete process.env.EMBEDDING_PROVIDER;
    const { createEmbeddingProviderFromEnv } = await loadFactory();
    const provider = createEmbeddingProviderFromEnv();
    expect(provider).toBe(stubProvider);
  });

  it('passes through model when stub provider is configured', async () => {
    process.env.EMBEDDING_PROVIDER = 'stub';
    process.env.EMBEDDING_MODEL = 'custom-stub';
    const { createEmbeddingProviderFromEnv } = await loadFactory();
    createEmbeddingProviderFromEnv();
    const { createStubProvider } = await import('../../../src/lib/embeddings/providerStub');
    expect(createStubProvider).toHaveBeenCalledWith('custom-stub');
  });

  it('returns gemini provider when configured', async () => {
    process.env.EMBEDDING_PROVIDER = 'gemini';
    process.env.EMBEDDING_MODEL = 'gemini-embedding-001';
    const { createEmbeddingProviderFromEnv } = await loadFactory();
    const provider = createEmbeddingProviderFromEnv();
    expect(provider).toBe(geminiProvider);
  });

  it('returns real provider for other providers', async () => {
    process.env.EMBEDDING_PROVIDER = 'openai';
    process.env.EMBEDDING_MODEL = 'text-embedding-3-large';
    const { createEmbeddingProviderFromEnv } = await loadFactory();
    const provider = createEmbeddingProviderFromEnv();
    expect(provider).toBe(realProvider);
  });
});
