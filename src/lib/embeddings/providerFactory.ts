import type { EmbeddingProvider } from './types';
import { createGeminiProvider } from './providerGemini';
import { createRealProvider } from './providerReal';
import { createStubProvider } from './providerStub';

export function createEmbeddingProviderFromEnv(): EmbeddingProvider {
  const providerName = (process.env.EMBEDDING_PROVIDER ?? 'stub').trim();
  const model = (process.env.EMBEDDING_MODEL ?? '').trim();

  if (providerName === 'stub') {
    return createStubProvider(model || 'stub');
  }

  if (providerName === 'gemini') {
    return createGeminiProvider({
      model: model || 'gemini-embedding-001',
      apiKey: process.env.EMBEDDING_API_KEY,
      apiUrl: process.env.EMBEDDING_API_URL,
    });
  }

  return createRealProvider({
    provider: providerName,
    model: model,
    apiKey: process.env.EMBEDDING_API_KEY,
    apiUrl: process.env.EMBEDDING_API_URL,
  });
}
