import { logMetric } from '../metrics';
import type { EmbeddingProvider } from './types';

export async function embedBatch(
  provider: EmbeddingProvider,
  texts: string[],
  batchSize = 64,
): Promise<number[][]> {
  const results: number[][] = [];
  let callCount = 0;
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const embeddings = await provider.embedDocuments(batch);
    callCount += 1;
    results.push(...embeddings);
  }

  if (provider.provider === 'gemini' && texts.length > 0) {
    logMetric('gemini_embed_batch_calls', callCount, {
      model: provider.model,
      batch_size: batchSize,
      total_texts: texts.length,
    });
  }
  return results;
}
