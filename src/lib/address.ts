export interface ParsedAddress {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  zip?: string;
  confidence: 'high' | 'medium' | 'low';
  warnings: string[];
  original: string;
}

const UNIT_RE = /\b(apt|unit|suite)\b/i;
const PO_BOX_RE = /\bP\.?\s*O\.?\s*Box\b/i;

function splitLine(text: string): { line1: string; line2?: string; warning?: string } {
  const match = text.match(UNIT_RE);
  if (!match || match.index === undefined) {
    return { line1: text };
  }

  const idx = match.index;
  const before = text.slice(0, idx).trim();
  const after = text.slice(idx).trim();

  if (!before) {
    return { line1: text, warning: 'Unit designator could not be separated.' };
  }

  return { line1: before, line2: after };
}

function parseStateZip(text: string): { state: string; zip?: string } | null {
  const trimmed = text.trim();
  const match = trimmed.match(/^([A-Za-z]{2})\s*(\d{5})?$/);
  if (!match) {
    const alt = trimmed.match(/\b([A-Za-z]{2})\s*(\d{5})?$/);
    if (!alt) return null;
    return { state: alt[1].toUpperCase(), zip: alt[2] };
  }
  return { state: match[1].toUpperCase(), zip: match[2] };
}

function parseCityStateZip(text: string): { city: string; state: string; zip?: string } | null {
  const match = text.trim().match(/^(.*)\s+([A-Za-z]{2})\s*(\d{5})?$/);
  if (!match) return null;
  return { city: match[1].trim(), state: match[2].toUpperCase(), zip: match[3] };
}

export function parseFullAddress(fullText: string): ParsedAddress {
  const original = fullText;
  const warnings: string[] = [];
  const trimmed = fullText.trim();

  if (!trimmed) {
    return {
      line1: '',
      city: '',
      state: '',
      confidence: 'low',
      warnings: ['Address is empty.'],
      original,
    };
  }

  if (PO_BOX_RE.test(trimmed)) {
    warnings.push('PO Box detected; results may be inaccurate.');
  }

  const parts = trimmed.split(',').map((part) => part.trim()).filter(Boolean);
  let line1 = parts[0] ?? '';
  let line2: string | undefined;
  let city = '';
  let state = '';
  let zip: string | undefined;

  if (parts.length >= 3) {
    const stateZipPart = parts[parts.length - 1];
    const statePartCandidate = parts[parts.length - 2];
    const cityPartCandidate = parts[parts.length - 3];
    const zipOnly = /^\d{5}$/.test(stateZipPart);
    const stateOnly = /^[A-Za-z]{2}$/.test(statePartCandidate ?? '');

    if (zipOnly && stateOnly && cityPartCandidate) {
      city = cityPartCandidate;
      state = statePartCandidate.toUpperCase();
      zip = stateZipPart;
    } else {
      const cityPart = parts[parts.length - 2];
      city = cityPart;

      const stateZip = parseStateZip(stateZipPart);
      if (stateZip) {
        state = stateZip.state;
        zip = stateZip.zip;
      } else {
        warnings.push('State/ZIP could not be parsed.');
      }
    }

    const streetParts = zipOnly && stateOnly ? parts.slice(0, -3) : parts.slice(0, -2);
    line1 = streetParts[0] ?? '';

    const lineSplit = splitLine(line1);
    line1 = lineSplit.line1;
    if (lineSplit.line2) {
      line2 = lineSplit.line2;
    } else {
      const unitPart = streetParts.find(
        (part, idx) => idx > 0 && UNIT_RE.test(part),
      );
      if (unitPart) {
        line2 = unitPart;
      } else if (streetParts.length > 1) {
        line1 = streetParts.join(', ');
        warnings.push('Additional address segments kept in line1.');
      }
    }

    if (lineSplit.warning) {
      warnings.push(lineSplit.warning);
    }
  } else if (parts.length === 2) {
    const parsed = parseCityStateZip(parts[1]);
    if (parsed) {
      city = parsed.city;
      state = parsed.state;
      zip = parsed.zip;
    } else {
      city = parts[1];
      warnings.push('City/state could not be parsed.');
    }
    const lineSplit = splitLine(parts[0]);
    line1 = lineSplit.line1;
    line2 = lineSplit.line2;
    if (lineSplit.warning) {
      warnings.push(lineSplit.warning);
    }
  } else {
    warnings.push('Address is missing city/state.');
  }

  let confidence: 'high' | 'medium' | 'low' = 'high';
  if (!state || !city) {
    confidence = 'low';
  } else if (!zip) {
    confidence = 'medium';
    warnings.push('ZIP code missing.');
  }

  if (PO_BOX_RE.test(trimmed)) {
    confidence = 'low';
  }

  return {
    line1,
    line2,
    city,
    state,
    zip,
    confidence,
    warnings,
    original,
  };
}
