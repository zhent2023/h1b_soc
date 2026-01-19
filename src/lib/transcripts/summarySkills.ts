export function extractSummarySkills(summary?: string | null): string[] {
  if (!summary) return [];
  const lower = summary.toLowerCase();
  const marker = lower.lastIndexOf('skills:');
  if (marker === -1) return [];

  const afterMarker = summary.slice(marker + 'skills:'.length);
  const line = afterMarker.split(/\r?\n/)[0] ?? '';
  const cleaned = line.replace(/^[\s\-–—:]+/, '').trim();
  if (!cleaned) return [];

  const rawSkills = cleaned.split(/[;,•]/);
  const deduped: string[] = [];
  const seen = new Set<string>();

  for (const raw of rawSkills) {
    const value = raw.trim().replace(/[.]+$/, '');
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(value);
  }

  return deduped;
}
