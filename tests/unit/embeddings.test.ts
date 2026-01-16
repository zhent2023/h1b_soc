import { describe, expect, it } from 'vitest';

import { EMBEDDING_DIM } from '../../src/lib/embeddings/constants';
import { createStubProvider } from '../../src/lib/embeddings/providerStub';
import { toVectorLiteral, validateVectorDimension } from '../../src/lib/embeddings/vectorUtils';
import { buildOnetEmbeddingDocument } from '../../src/lib/onet/buildOnetEmbeddingDocument';

describe('vectorUtils', () => {
  it('rejects wrong dimensions', () => {
    expect(() => validateVectorDimension([0, 1, 2])).toThrow(/dimension/i);
  });

  it('rejects NaN values', () => {
    const values = Array.from({ length: EMBEDDING_DIM }, () => 0);
    values[10] = Number.NaN;
    expect(() => toVectorLiteral(values)).toThrow(/non-finite/i);
  });

  it('rejects Infinity values', () => {
    const values = Array.from({ length: EMBEDDING_DIM }, () => 0);
    values[20] = Number.POSITIVE_INFINITY;
    expect(() => toVectorLiteral(values)).toThrow(/non-finite/i);
  });

  it('formats values with stable precision', () => {
    const values = Array.from({ length: EMBEDDING_DIM }, (_, idx) =>
      idx === 0 ? 0.123456789 : 0,
    );
    const literal = toVectorLiteral(values);
    expect(literal.startsWith('[')).toBe(true);
    expect(literal.endsWith(']')).toBe(true);
    expect(literal).toContain('0.123457');
    expect(literal.split(',').length).toBe(EMBEDDING_DIM);
  });

  it('normalizes negative zero values', () => {
    const values = Array.from({ length: EMBEDDING_DIM }, () => 0);
    values[0] = -0;
    const literal = toVectorLiteral(values);
    expect(literal.startsWith('[0')).toBe(true);
  });
});

describe('providerStub', () => {
  it('returns deterministic vectors', async () => {
    const provider = createStubProvider('stub');
    const first = await provider.embedQuery('hello world');
    const second = await provider.embedQuery('hello world');
    expect(first).toEqual(second);
  });

  it('returns different vectors for different inputs', async () => {
    const provider = createStubProvider('stub');
    const first = await provider.embedQuery('alpha');
    const second = await provider.embedQuery('beta');
    expect(first).not.toEqual(second);
  });

  it('embeds documents with consistent dimensions', async () => {
    const provider = createStubProvider('stub');
    const vectors = await provider.embedDocuments(['one', 'two']);
    expect(vectors).toHaveLength(2);
    expect(vectors[0]).toHaveLength(EMBEDDING_DIM);
  });
});

describe('buildOnetEmbeddingDocument', () => {
  it('orders by sortOrder and dedups case-insensitively', () => {
    const { contentText, dutyCount, truncated } = buildOnetEmbeddingDocument(
      [
        { dutyText: 'Second duty', sortOrder: 2 },
        { dutyText: 'First duty', sortOrder: 1 },
        { dutyText: 'first duty', sortOrder: 3 },
      ],
      { maxDuties: 5, maxChars: 200 },
    );

    expect(contentText.split('\n')).toEqual(['First duty', 'Second duty']);
    expect(dutyCount).toBe(2);
    expect(truncated).toBe(false);
  });

  it('truncates by max duties', () => {
    const { dutyCount, truncated } = buildOnetEmbeddingDocument(
      [
        { dutyText: 'Duty A', sortOrder: 1 },
        { dutyText: 'Duty B', sortOrder: 2 },
      ],
      { maxDuties: 1, maxChars: 200 },
    );

    expect(dutyCount).toBe(1);
    expect(truncated).toBe(true);
  });

  it('truncates by max chars', () => {
    const longDuty = 'A'.repeat(50);
    const { contentText, truncated } = buildOnetEmbeddingDocument(
      [{ dutyText: longDuty, sortOrder: 1 }],
      { maxDuties: 5, maxChars: 10 },
    );

    expect(contentText.length).toBeLessThanOrEqual(10);
    expect(truncated).toBe(true);
  });

  it('filters empty duty entries', () => {
    const { contentText, dutyCount } = buildOnetEmbeddingDocument(
      [
        { dutyText: 'Duty A', sortOrder: 1 },
        { dutyText: '   ', sortOrder: 2 },
        { dutyText: '', sortOrder: 3 },
      ],
      { maxDuties: 5, maxChars: 200 },
    );

    expect(dutyCount).toBe(1);
    expect(contentText).toBe('Duty A');
  });
});
