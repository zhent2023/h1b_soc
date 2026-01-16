import { describe, expect, it } from 'vitest';

import { parseFullAddress } from '../../src/lib/address';

describe('parseFullAddress', () => {
  it('parses sample addresses with unit handling', () => {
    const littleton = parseFullAddress(
      '410 Great Road B9 Unit 7-3, Littleton, MA 01460',
    );
    expect(littleton.line1).toBe('410 Great Road B9');
    expect(littleton.line2).toBe('Unit 7-3');
    expect(littleton.city).toBe('Littleton');
    expect(littleton.state).toBe('MA');
    expect(littleton.zip).toBe('01460');
    expect(littleton.confidence).toBe('high');
    expect(littleton.warnings).toHaveLength(0);

    const brooklyn = parseFullAddress('946 Albany Avenue, Brooklyn, NY 11203');
    expect(brooklyn.line1).toBe('946 Albany Avenue');
    expect(brooklyn.line2).toBeUndefined();
    expect(brooklyn.city).toBe('Brooklyn');
    expect(brooklyn.state).toBe('NY');
    expect(brooklyn.zip).toBe('11203');
    expect(brooklyn.confidence).toBe('high');

    const lorimer = parseFullAddress('265 Lorimer Street, Apt 637, Brooklyn, NY 11206');
    expect(lorimer.line1).toBe('265 Lorimer Street');
    expect(lorimer.line2).toBe('Apt 637');
    expect(lorimer.city).toBe('Brooklyn');
    expect(lorimer.state).toBe('NY');
    expect(lorimer.zip).toBe('11206');
    expect(lorimer.confidence).toBe('high');

    const austin = parseFullAddress(
      '9600 Great Hills Trail, Suite 150W, Austin, TX 78759',
    );
    expect(austin.line1).toBe('9600 Great Hills Trail');
    expect(austin.line2).toBe('Suite 150W');
    expect(austin.city).toBe('Austin');
    expect(austin.state).toBe('TX');
    expect(austin.zip).toBe('78759');
    expect(austin.confidence).toBe('high');

    const industry = parseFullAddress('131 Marcellin Dr, City of Industry, CA 91789');
    expect(industry.line1).toBe('131 Marcellin Dr');
    expect(industry.city).toBe('City of Industry');
    expect(industry.state).toBe('CA');
    expect(industry.zip).toBe('91789');
    expect(industry.confidence).toBe('high');
  });

  it('flags PO Box addresses as low confidence', () => {
    const parsed = parseFullAddress('PO Box 123, Boston, MA 02101');
    expect(parsed.confidence).toBe('low');
    expect(parsed.warnings.join(' ')).toContain('PO Box');
  });

  it('parses city/state inputs with warnings', () => {
    const cityOnly = parseFullAddress('San Jose, CA');
    expect(cityOnly.line1).toBe('');
    expect(cityOnly.city).toBe('San Jose');
    expect(cityOnly.state).toBe('CA');
    expect(cityOnly.zip).toBeUndefined();
    expect(cityOnly.confidence).toBe('low');
    expect(cityOnly.warnings.join(' ')).toContain('Street address missing');
    expect(cityOnly.warnings.join(' ')).toContain('ZIP code missing');

    const cityZip = parseFullAddress('San Jose, CA 95112');
    expect(cityZip.line1).toBe('');
    expect(cityZip.city).toBe('San Jose');
    expect(cityZip.state).toBe('CA');
    expect(cityZip.zip).toBe('95112');
    expect(cityZip.confidence).toBe('medium');
    expect(cityZip.warnings.join(' ')).toContain('Street address missing');

    const cityZipComma = parseFullAddress('San Jose, CA, 95112');
    expect(cityZipComma.line1).toBe('');
    expect(cityZipComma.city).toBe('San Jose');
    expect(cityZipComma.state).toBe('CA');
    expect(cityZipComma.zip).toBe('95112');
    expect(cityZipComma.confidence).toBe('medium');
    expect(cityZipComma.warnings.join(' ')).toContain('Street address missing');

    const cityZipNoComma = parseFullAddress('San Jose CA 95112');
    expect(cityZipNoComma.line1).toBe('');
    expect(cityZipNoComma.city).toBe('San Jose');
    expect(cityZipNoComma.state).toBe('CA');
    expect(cityZipNoComma.zip).toBe('95112');
    expect(cityZipNoComma.confidence).toBe('medium');
    expect(cityZipNoComma.warnings.join(' ')).toContain('Street address missing');
  });

  it('handles empty and malformed addresses', () => {
    const empty = parseFullAddress('   ');
    expect(empty.confidence).toBe('low');
    expect(empty.warnings.join(' ')).toContain('Address is empty');

    const malformed = parseFullAddress('12345');
    expect(malformed.confidence).toBe('low');
    expect(malformed.warnings.join(' ')).toContain('missing city/state');
  });

  it('keeps extra address segments and warns', () => {
    const parsed = parseFullAddress('123 Main, Building A, Boston, MA 02101');
    expect(parsed.line1).toBe('123 Main, Building A');
    expect(parsed.warnings.join(' ')).toContain('Additional address segments');
  });

  it('reports unit parsing warnings when needed', () => {
    const parsed = parseFullAddress('Unit 5, Boston, MA 02101');
    expect(parsed.line1).toBe('Unit 5');
    expect(parsed.warnings.join(' ')).toContain('Unit designator');
  });

  it('warns when city/state cannot be parsed from two segments', () => {
    const parsed = parseFullAddress('123 Main, Unknownland');
    expect(parsed.warnings.join(' ')).toContain('City/state could not be parsed');
  });
});
