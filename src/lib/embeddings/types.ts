export type EmbeddingVector = number[];

export interface EmbeddingProvider {
  provider: string;
  model: string;
  embedDocuments(texts: string[]): Promise<EmbeddingVector[]>;
  embedQuery(text: string): Promise<EmbeddingVector>;
}
