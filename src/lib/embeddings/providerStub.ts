import { createHash } from 'crypto';

import { EMBEDDING_DIM } from './constants';
import type { EmbeddingProvider, EmbeddingVector } from './types';
import { validateVectorDimension } from './vectorUtils';

function vectorFromSeed(seed: string, dimension = EMBEDDING_DIM): EmbeddingVector {
  const values: number[] = [];
  for (let idx = 0; idx < dimension; idx += 1) {
    const hash = createHash('sha256').update(`${seed}:${idx}`).digest();
    const int = hash.readUInt32BE(0);
    values.push(int / 0xffffffff);
  }
  validateVectorDimension(values, dimension);
  return values;
}

export function createStubProvider(model = 'stub'): EmbeddingProvider {
  return {
    provider: 'stub',
    model,
    async embedDocuments(texts: string[]) {
      return texts.map((text) => vectorFromSeed(text));
    },
    async embedQuery(text: string) {
      return vectorFromSeed(text);
    },
  };
}
