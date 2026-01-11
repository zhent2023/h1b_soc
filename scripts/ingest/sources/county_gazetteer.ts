import { extractLinks } from './html';
import { fetchWithRetry } from './fetcher';

const DEFAULT_GAZETTEER_PAGE =
  process.env.COUNTY_GAZETTEER_PAGE_URL ??
  'https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html';

function parseYear(link: string): number | null {
  const match = link.match(/(\d{4})_gaz_counties_national\.zip/i);
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

export function parseCountyGazetteerPage(
  html: string,
  baseUrl = DEFAULT_GAZETTEER_PAGE,
): { url: string; label: string } | null {
  const links = extractLinks(html, baseUrl).filter((link) =>
    /gaz_counties_national\.zip/i.test(link),
  );
  if (links.length === 0) {
    return null;
  }

  const candidates = links
    .map((link) => ({ link, year: parseYear(link) }))
    .filter((entry) => entry.year !== null) as Array<{ link: string; year: number }>;

  if (candidates.length === 0) {
    return { url: links[0], label: 'unknown' };
  }

  const best = candidates.sort((a, b) => b.year - a.year)[0];
  return { url: best.link, label: String(best.year) };
}

export async function resolveCountyGazetteerZipUrl(): Promise<{
  url: string;
  label: string;
}> {
  const res = await fetchWithRetry(DEFAULT_GAZETTEER_PAGE);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch Census gazetteer page (${res.status}). Use --countyZipPath for offline ingest.`,
    );
  }
  const html = await res.text();
  const resolved = parseCountyGazetteerPage(html, DEFAULT_GAZETTEER_PAGE);
  if (!resolved) {
    throw new Error(
      'Unable to find county gazetteer zip. Use --countyZipPath for offline ingest.',
    );
  }
  return resolved;
}
