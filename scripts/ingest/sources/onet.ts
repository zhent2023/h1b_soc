import { extractLinks } from './html';
import { fetchWithRetry } from './fetcher';

const DEFAULT_ONET_PAGE =
  process.env.ONET_DOWNLOAD_PAGE_URL ?? 'https://www.onetcenter.org/database.html';

function extractVersionLabel(url: string): string | null {
  const match = url.match(/db[_-]?(\d+)[._](\d+)_text\.zip/i);
  if (!match) {
    return null;
  }
  return `${match[1]}.${match[2]}`;
}

export function parseOnetDbPage(
  html: string,
  baseUrl = DEFAULT_ONET_PAGE,
): { url: string; versionLabel: string } | null {
  const links = extractLinks(html, baseUrl).filter((link) =>
    /db.*text\.zip/i.test(link),
  );
  const candidates = links
    .map((link) => ({ link, versionLabel: extractVersionLabel(link) }))
    .filter((entry) => entry.versionLabel) as Array<{ link: string; versionLabel: string }>;

  if (candidates.length === 0) {
    return null;
  }

  const sorted = candidates.sort((a, b) => {
    const [aMajor, aMinor] = a.versionLabel.split('.').map(Number);
    const [bMajor, bMinor] = b.versionLabel.split('.').map(Number);
    if (aMajor !== bMajor) return bMajor - aMajor;
    return bMinor - aMinor;
  });

  return { url: sorted[0].link, versionLabel: sorted[0].versionLabel };
}

export async function resolveOnetDbTextZipUrl(): Promise<{
  url: string;
  versionLabel: string;
}> {
  const res = await fetchWithRetry(DEFAULT_ONET_PAGE);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch O*NET downloads page (${res.status}). Use --onetZipPath for offline ingest.`,
    );
  }
  const html = await res.text();
  const resolved = parseOnetDbPage(html, DEFAULT_ONET_PAGE);
  if (!resolved) {
    throw new Error(
      'Unable to find O*NET database text zip. Use --onetZipPath for offline ingest.',
    );
  }
  return resolved;
}
