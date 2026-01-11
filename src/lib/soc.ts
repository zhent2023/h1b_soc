export interface SocNormalizeResult {
  soc6: string | null;
  onet8: string | null;
  normalized: string | null;
  warnings: string[];
}

function buildResult(
  soc6: string | null,
  onet8: string | null,
  warnings: string[],
): SocNormalizeResult {
  return {
    soc6,
    onet8,
    normalized: soc6,
    warnings,
  };
}

export function normalizeSocInput(input: string): SocNormalizeResult {
  const warnings: string[] = [];
  const trimmed = input.trim();

  if (!trimmed) {
    warnings.push('SOC input is empty.');
    return buildResult(null, null, warnings);
  }

  if (/^\d{6}$/.test(trimmed)) {
    const soc6 = `${trimmed.slice(0, 2)}-${trimmed.slice(2)}`;
    return buildResult(soc6, null, warnings);
  }

  if (/^\d{2}\s+\d{4}$/.test(trimmed)) {
    const parts = trimmed.split(/\s+/);
    const soc6 = `${parts[0]}-${parts[1]}`;
    return buildResult(soc6, null, warnings);
  }

  if (/^\d{2}-\d{4}\.\d{2}$/.test(trimmed)) {
    const soc6 = trimmed.slice(0, 7);
    const suffix = trimmed.slice(7);
    if (suffix === '.00') {
      warnings.push('O*NET .00 is broad (aligned to SOC-6).');
      warnings.push('Wages use SOC-6; duties use O*NET 8-digit.');
    } else {
      warnings.push(`Using O*NET 8-digit ${trimmed} for duties.`);
      warnings.push('Wages use SOC-6.');
    }
    return buildResult(soc6, trimmed, warnings);
  }

  if (/^\d{2}-\d{4}$/.test(trimmed)) {
    return buildResult(trimmed, null, warnings);
  }

  warnings.push('SOC input format not recognized.');
  return buildResult(null, null, warnings);
}
