import { EMBEDDING_DIM } from './constants';
import type { EmbeddingProvider, EmbeddingVector } from './types';
import { validateVectorDimension } from './vectorUtils';

type ProviderOptions = {
  provider: string;
  model: string;
  apiUrl?: string;
  apiKey?: string;
};

type EmbeddingApiResponse = {
  data?: Array<{ embedding?: number[] }>;
};

function assertServerSide() {
  if (typeof window !== 'undefined') {
    throw new Error('Embedding provider must run server-side.');
  }
}

function assertNonEmpty(value: string | undefined, label: string): string {
  if (!value) {
    throw new Error(`Missing ${label} for embedding provider.`);
  }
  return value;
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 2,
): Promise<Response> {
  let attempt = 0;
  let delay = 200;
  while (true) {
    try {
      const response = await fetch(url, options);
      if (!response.ok && attempt < retries) {
        attempt += 1;
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
        continue;
      }
      return response;
    } catch (error) {
      if (attempt >= retries) {
        throw error;
      }
      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2;
    }
  }
}

export function createRealProvider(options: ProviderOptions): EmbeddingProvider {
  assertServerSide();
  const provider = options.provider;
  const model = assertNonEmpty(options.model, 'EMBEDDING_MODEL');
  const apiUrl = options.apiUrl ?? 'https://api.openai.com/v1/embeddings';
  const apiKey = assertNonEmpty(options.apiKey, 'EMBEDDING_API_KEY');

  const embed = async (inputs: string[]): Promise<EmbeddingVector[]> => {
    const response = await fetchWithRetry(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, input: inputs }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Embedding provider ${provider} failed: ${response.status} ${body}`);
    }

    const payload = (await response.json()) as EmbeddingApiResponse;
    const embeddings = payload.data?.map((item) => item.embedding ?? []) ?? [];
    if (embeddings.length !== inputs.length) {
      throw new Error('Embedding provider returned unexpected result count.');
    }
    embeddings.forEach((vector) => validateVectorDimension(vector, EMBEDDING_DIM));
    return embeddings;
  };

  return {
    provider,
    model,
    async embedDocuments(texts: string[]) {
      return embed(texts);
    },
    async embedQuery(text: string) {
      const [vector] = await embed([text]);
      return vector;
    },
  };
}
