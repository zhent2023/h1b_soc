import { extractLinks } from './html';
import { fetchWithRetry } from './fetcher';

const DEFAULT_OFLC_PAGE =
  process.env.OFLC_DOWNLOAD_PAGE_URL ??
  'https://www.foreignlaborcert.doleta.gov/oes/oes_wage_library.cfm';

function normalizeYear(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase();
}

function matchesWageYear(link: string, wageYear: string): boolean {
  const normalizedLink = normalizeYear(link);
  const normalizedYear = normalizeYear(wageYear);
  const digits = wageYear.replace(/\D/g, '');
  if (normalizedLink.includes(normalizedYear)) {
    return true;
  }
  const alt = normalizedYear.replace('-', '_');
  if (normalizedLink.includes(alt)) {
    return true;
  }
  if (digits && normalizedLink.replace(/\D/g, '').includes(digits)) {
    return true;
  }
  return false;
}

export function parseOflcDownloadPage(
  html: string,
  wageYear: string,
  baseUrl = DEFAULT_OFLC_PAGE,
): string | null {
  const links = extractLinks(html, baseUrl).filter((link) => link.toLowerCase().includes('.zip'));
  const match = links.find((link) => matchesWageYear(link, wageYear));
  return match ?? null;
}

export async function resolveOflcWageZipUrl(wageYear: string): Promise<string> {
  const res = await fetchWithRetry(DEFAULT_OFLC_PAGE);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch OFLC downloads page (${res.status}). Use --oflcZipPath for offline ingest.`,
    );
  }
  const html = await res.text();
  const url = parseOflcDownloadPage(html, wageYear, DEFAULT_OFLC_PAGE);
  if (!url) {
    throw new Error(
      `Unable to find OFLC wage zip for ${wageYear}. Use --oflcZipPath for offline ingest.`,
    );
  }
  return url;
}
