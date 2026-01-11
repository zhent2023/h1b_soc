export function extractLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  const regex = /href=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(html)) !== null) {
    const raw = match[1];
    if (!raw || raw.startsWith('#') || raw.startsWith('mailto:')) {
      continue;
    }
    try {
      const absolute = new URL(raw, baseUrl).toString();
      links.push(absolute);
    } catch {
      continue;
    }
  }
  return Array.from(new Set(links));
}
