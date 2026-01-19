import { EMBEDDING_DIM } from '../../src/lib/embeddings/constants';
import { createEmbeddingProviderFromEnv } from '../../src/lib/embeddings/providerFactory';
import { validateVectorDimension } from '../../src/lib/embeddings/vectorUtils';

const TEST_TEXT = 'College course title: Introduction to Computer Science';

async function main() {
  console.log('Running embedding dimension smoke test...');
  const provider = createEmbeddingProviderFromEnv();
  const [embedding] = await provider.embedDocuments([TEST_TEXT]);
  validateVectorDimension(embedding, EMBEDDING_DIM);
  console.log(`PASS: Dimension is ${embedding.length}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`FAIL: ${message}`);
  process.exit(1);
});
