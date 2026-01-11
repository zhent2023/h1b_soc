import { createHash } from 'crypto';

import { parseFullAddress } from './address';
import { cacheGet, cacheSet } from './cache';

export type GeocoderProvider = 'stub' | 'census';

export interface GeocodeInput {
  fullText?: string;
  line1?: string;
  city?: string;
  state?: string;
  zip?: string;
}

export interface GeocodeResult {
  stateAb: string;
  countyFips?: string;
  countyName?: string;
  placeName?: string;
  confidence: 'high' | 'medium' | 'low';
  explain: string[];
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function toScore(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getStateAb(input: GeocodeInput, fallback?: string): string {
  if (input.state && input.state.trim().length === 2) {
    return input.state.trim().toUpperCase();
  }
  return fallback ?? 'NA';
}

function normalizeInput(input: GeocodeInput): GeocodeInput {
  if (!input.fullText) {
    return input;
  }
  const parsed = parseFullAddress(input.fullText);
  const line1Base = input.line1?.trim() || parsed.line1;
  const line1 =
    parsed.line2 && line1Base && !line1Base.toLowerCase().includes(parsed.line2.toLowerCase())
      ? `${line1Base} ${parsed.line2}`.trim()
      : line1Base;

  return {
    ...input,
    line1: input.line1 ?? (line1 || undefined),
    city: input.city ?? (parsed.city || undefined),
    state: input.state ?? (parsed.state || undefined),
    zip: input.zip ?? (parsed.zip || undefined),
  };
}

function buildCensusUrl(input: GeocodeInput): string | null {
  const base = 'https://geocoding.geo.census.gov/geocoder/geographies';
  const params = new URLSearchParams({
    benchmark: '2020',
    vintage: '2020',
    format: 'json',
    layers: 'Counties,Places,County Subdivisions',
  });

  const hasStructured = Boolean(input.line1 || input.city || input.state || input.zip);
  if (hasStructured) {
    params.set('street', input.line1 ?? '');
    params.set('city', input.city ?? '');
    params.set('state', input.state ?? '');
    if (input.zip) {
      params.set('zip', input.zip);
    }
    return `${base}/address?${params.toString()}`;
  }

  if (!input.fullText) {
    return null;
  }

  params.set('address', input.fullText);
  return `${base}/onelineaddress?${params.toString()}`;
}

function resolveCounty(geographies: any): { countyFips?: string; countyName?: string } {
  const countyList =
    geographies?.Counties ?? geographies?.County ?? geographies?.counties ?? geographies?.county;
  const county = Array.isArray(countyList) ? countyList[0] : undefined;
  if (!county) return {};
  const countyFips =
    county.GEOID ??
    (county.STATE && county.COUNTY ? `${county.STATE}${county.COUNTY}` : undefined);
  return {
    countyFips,
    countyName: county.NAME ?? county.BASENAME,
  };
}

function resolvePlace(geographies: any): { placeName?: string } {
  const candidates = [
    geographies?.Places,
    geographies?.Place,
    geographies?.places,
    geographies?.place,
    geographies?.['County Subdivisions'],
    geographies?.['County Subdivision'],
    geographies?.CountySubdivisions,
    geographies?.countySubdivisions,
    geographies?.Cousubs,
    geographies?.cousubs,
  ];

  const list = candidates.find((entry) => Array.isArray(entry));
  const place = Array.isArray(list) ? list[0] : undefined;
  if (!place) return {};
  return {
    placeName: place.BASENAME ?? place.NAME,
  };
}

export async function geocodeCensus(
  input: GeocodeInput,
  timeoutMs: number,
): Promise<GeocodeResult> {
  const normalized = normalizeInput(input);
  const explain: string[] = ['provider=census'];
  const stateAb = getStateAb(normalized);
  const url = buildCensusUrl(normalized);

  if (!url) {
    return {
      stateAb,
      confidence: 'low',
      explain: [...explain, 'Missing address input for census geocoder.'],
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      return {
        stateAb,
        confidence: 'low',
        explain: [...explain, `Census geocoder error: ${response.status}.`],
      };
    }

    const payload = await response.json();
    const matches = payload?.result?.addressMatches ?? [];
    if (!Array.isArray(matches) || matches.length === 0) {
      return {
        stateAb,
        confidence: 'low',
        explain: [...explain, 'No census geocoder matches.'],
      };
    }

    const sorted = [...matches].sort((a, b) => toScore(b.score) - toScore(a.score));
    const top = sorted[0];
    const components = top?.addressComponents ?? {};
    const geographies = top?.geographies ?? {};
    const { countyFips, countyName } = resolveCounty(geographies);
    const { placeName } = resolvePlace(geographies);

    let confidence: 'high' | 'medium' | 'low' = 'high';
    if (sorted.length > 1) {
      const gap = Math.abs(toScore(sorted[0].score) - toScore(sorted[1].score));
      if (gap <= 2) {
        confidence = 'low';
        explain.push('Multiple matches with similar scores.');
      } else {
        confidence = 'medium';
        explain.push('Multiple matches returned; using top score.');
      }
    }

    if (!countyFips && !placeName) {
      confidence = 'medium';
      explain.push('Geographies missing in census response.');
    }

    return {
      stateAb: getStateAb(normalized, components.state),
      countyFips,
      countyName,
      placeName,
      confidence,
      explain,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        stateAb,
        confidence: 'low',
        explain: [...explain, `Census geocoder timed out after ${timeoutMs}ms.`],
      };
    }

    return {
      stateAb,
      confidence: 'low',
      explain: [
        ...explain,
        `Census geocoder error: ${error instanceof Error ? error.message : 'Unknown error'}.`,
      ],
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function geocode(input: GeocodeInput): Promise<GeocodeResult> {
  const provider = (process.env.GEOCODER_PROVIDER ?? 'stub') as GeocoderProvider;
  const explain: string[] = [`provider=${provider}`];
  const normalized = normalizeInput(input);
  const addressHash = createHash('sha256')
    .update(JSON.stringify(normalized))
    .digest('hex');
  const cacheKey = `geo:${provider}:${addressHash}`;
  const cached = await cacheGet<GeocodeResult>(cacheKey);
  if (cached) {
    return {
      ...cached,
      explain: [...cached.explain, 'cache=hit'],
    };
  }

  if (provider === 'census') {
    const timeoutMs = Number(process.env.GEOCODER_TIMEOUT_MS ?? '5000');
    const result = await geocodeCensus(normalized, Number.isFinite(timeoutMs) ? timeoutMs : 5000);
    const withExplain = {
      ...result,
      explain: [...explain, ...result.explain.filter((entry) => entry !== 'provider=census')],
    };
    await cacheSet(cacheKey, withExplain, 3600);
    return withExplain;
  }

  const text = normalizeText(
    [
      normalized.fullText,
      normalized.line1,
      normalized.city,
      normalized.state,
      normalized.zip,
    ]
      .filter(Boolean)
      .join(' '),
  );
  const zip = normalized.zip?.trim();
  const stateAb = getStateAb(normalized);

  if (
    zip === '01460' ||
    (text.includes('littleton') && (text.includes('ma') || stateAb === 'MA'))
  ) {
    const result = {
      stateAb: 'MA',
      countyFips: '25017',
      countyName: 'Middlesex County',
      placeName: 'Littleton',
      confidence: 'high',
      explain: [...explain, 'Matched stub Littleton, MA.'],
    };
    await cacheSet(cacheKey, result, 3600);
    return result;
  }

  if (
    zip === '11203' ||
    zip === '11206' ||
    (text.includes('brooklyn') && (text.includes('ny') || stateAb === 'NY'))
  ) {
    const result = {
      stateAb: 'NY',
      countyFips: '36047',
      countyName: 'Kings County',
      placeName: 'Brooklyn',
      confidence: 'high',
      explain: [...explain, 'Matched stub Brooklyn, NY.'],
    };
    await cacheSet(cacheKey, result, 3600);
    return result;
  }

  if (
    zip === '78759' ||
    (text.includes('austin') && (text.includes('tx') || stateAb === 'TX'))
  ) {
    const result = {
      stateAb: 'TX',
      countyFips: '48453',
      countyName: 'Travis County',
      placeName: 'Austin',
      confidence: 'high',
      explain: [...explain, 'Matched stub Austin, TX.'],
    };
    await cacheSet(cacheKey, result, 3600);
    return result;
  }

  if (
    zip === '91789' ||
    (text.includes('city of industry') && (text.includes('ca') || stateAb === 'CA'))
  ) {
    const result = {
      stateAb: 'CA',
      countyFips: '06037',
      countyName: 'Los Angeles County',
      placeName: 'City of Industry',
      confidence: 'high',
      explain: [...explain, 'Matched stub City of Industry, CA.'],
    };
    await cacheSet(cacheKey, result, 3600);
    return result;
  }

  const fallback = {
    stateAb,
    confidence: 'low',
    explain: [...explain, 'No stub match found.'],
  };
  await cacheSet(cacheKey, fallback, 3600);
  return fallback;
}
