import { EMBEDDING_DIM } from './constants';

const DEFAULT_PRECISION = 6;

function formatNumber(value: number, precision = DEFAULT_PRECISION): string {
  if (!Number.isFinite(value)) {
    throw new Error('Embedding vector contains non-finite values.');
  }
  const factor = 10 ** precision;
  const rounded = Math.round(value * factor) / factor;
  if (Object.is(rounded, -0)) {
    return '0';
  }
  let text = rounded.toFixed(precision);
  text = text.replace(/(?:\.0+|(\.\d+?)0+)$/, '$1');
  return text;
}

export function validateVectorDimension(values: number[], expected = EMBEDDING_DIM): void {
  if (!Array.isArray(values) || values.length !== expected) {
    throw new Error(`Expected embedding dimension ${expected}, got ${values?.length ?? 0}.`);
  }
}

export function toVectorLiteral(values: number[]): string {
  validateVectorDimension(values);
  const parts = values.map((value) => formatNumber(value));
  return `[${parts.join(',')}]`;
}
