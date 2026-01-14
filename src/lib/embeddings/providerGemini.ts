import { EMBEDDING_DIM } from './constants';
import type { EmbeddingProvider, EmbeddingVector } from './types';
import { validateVectorDimension } from './vectorUtils';

type ProviderOptions = {
  model: string;
  apiUrl?: string;
  apiKey?: string;
};

type GeminiEmbedding = {
  values?: number[];
};

type EmbedContentResponse = {
  embedding?: GeminiEmbedding;
};

type BatchEmbedResponse = {
  embeddings?: GeminiEmbedding[];
};

const DEFAULT_API_URL = 'https://generativelanguage.googleapis.com/v1beta';

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

function buildContent(text: string) {
  return { parts: [{ text }] };
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

function parseEmbedding(values: number[] | undefined, label: string): EmbeddingVector {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`Gemini embedding response missing values for ${label}.`);
  }
  validateVectorDimension(values, EMBEDDING_DIM);
  return values;
}

const MODEL_ALIASES: Record<string, string> = {
  'gemini-embedding-1.0': 'gemini-embedding-001',
};

function normalizeModel(model: string): string {
  const trimmed = model.trim();
  const bare = trimmed.startsWith('models/') ? trimmed.slice('models/'.length) : trimmed;
  const resolved = MODEL_ALIASES[bare] ?? bare;
  return resolved.startsWith('models/') ? resolved : `models/${resolved}`;
}

export function createGeminiProvider(options: ProviderOptions): EmbeddingProvider {
  assertServerSide();
  const model = normalizeModel(assertNonEmpty(options.model, 'EMBEDDING_MODEL'));
  const apiKey = assertNonEmpty(options.apiKey, 'EMBEDDING_API_KEY');
  const apiUrl = options.apiUrl ?? DEFAULT_API_URL;

  const baseHeaders = {
    'Content-Type': 'application/json',
    'x-goog-api-key': apiKey,
  };

  return {
    provider: 'gemini',
    model,
    async embedDocuments(texts: string[]) {
      if (texts.length === 0) return [];
      const response = await fetchWithRetry(`${apiUrl}/${model}:batchEmbedContents`, {
        method: 'POST',
        headers: baseHeaders,
        body: JSON.stringify({
          requests: texts.map((text) => ({
            model,
            content: buildContent(text),
            taskType: 'RETRIEVAL_DOCUMENT',
          })),
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Gemini embedding failed: ${response.status} ${body}`);
      }

      const payload = (await response.json()) as BatchEmbedResponse;
      const embeddings = payload.embeddings ?? [];
      if (embeddings.length !== texts.length) {
        throw new Error('Gemini embedding returned unexpected result count.');
      }
      return embeddings.map((embedding, idx) =>
        parseEmbedding(embedding.values, `document ${idx + 1}`),
      );
    },
    async embedQuery(text: string) {
      const response = await fetchWithRetry(`${apiUrl}/${model}:embedContent`, {
        method: 'POST',
        headers: baseHeaders,
        body: JSON.stringify({
          content: buildContent(text),
          taskType: 'RETRIEVAL_QUERY',
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Gemini embedding failed: ${response.status} ${body}`);
      }

      const payload = (await response.json()) as EmbedContentResponse;
      return parseEmbedding(payload.embedding?.values, 'query');
    },
  };
}
