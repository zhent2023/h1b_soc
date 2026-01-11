import { describe, expect, it } from 'vitest';

import { normalizeSocInput } from '../../src/lib/soc';

const canonicalSocCodes = ['15-1252', '13-1161', '27-1021', '27-2012', '17-2071', '13-1081'];

describe('soc_normalizer: normalizeSocInput', () => {
  it('normalizes supported formats', () => {
    const simple = normalizeSocInput('151252');
    expect(simple.soc6).toBe('15-1252');
    expect(simple.onet8).toBeNull();
    expect(simple.normalized).toBe('15-1252');

    const spaced = normalizeSocInput('15 1252');
    expect(spaced.soc6).toBe('15-1252');
    expect(spaced.onet8).toBeNull();
    expect(spaced.normalized).toBe('15-1252');

    const canonical = normalizeSocInput('15-1252');
    expect(canonical.soc6).toBe('15-1252');
    expect(canonical.onet8).toBeNull();
    expect(canonical.normalized).toBe('15-1252');

    const broad = normalizeSocInput('15-1252.00');
    expect(broad.soc6).toBe('15-1252');
    expect(broad.onet8).toBe('15-1252.00');
    expect(broad.normalized).toBe('15-1252');

    const detailed = normalizeSocInput('13-1081.01');
    expect(detailed.soc6).toBe('13-1081');
    expect(detailed.onet8).toBe('13-1081.01');
    expect(detailed.normalized).toBe('13-1081');
  });

  it('keeps known SOC codes canonical', () => {
    for (const code of canonicalSocCodes) {
      const result = normalizeSocInput(code);
      expect(result.soc6).toBe(code);
      expect(result.onet8).toBeNull();
      expect(result.normalized).toBe(code);
      expect(result.warnings).toHaveLength(0);
    }
  });

  it('adds warnings when using O*NET 8-digit inputs', () => {
    const broad = normalizeSocInput('17-2071.00');
    expect(broad.soc6).toBe('17-2071');
    expect(broad.onet8).toBe('17-2071.00');
    expect(broad.warnings.join(' ')).toContain('O*NET .00 is broad');
    expect(broad.warnings.join(' ')).toContain('Wages use SOC-6');

    const detailed = normalizeSocInput('13-1081.01');
    expect(detailed.soc6).toBe('13-1081');
    expect(detailed.onet8).toBe('13-1081.01');
    expect(detailed.warnings.join(' ')).toContain('O*NET 8-digit');
    expect(detailed.warnings.join(' ')).toContain('Wages use SOC-6');
  });

  it('rejects unsupported formats', () => {
    expect(normalizeSocInput('15-125').soc6).toBeNull();
    expect(normalizeSocInput('15125').soc6).toBeNull();
    expect(normalizeSocInput('15-1252.001').soc6).toBeNull();
    expect(normalizeSocInput('15-1252.1').soc6).toBeNull();
    expect(normalizeSocInput('15-1252 01').soc6).toBeNull();
    expect(normalizeSocInput('15125201').soc6).toBeNull();
    expect(normalizeSocInput('abc').soc6).toBeNull();
  });
});
