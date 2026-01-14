export type DutyEntry = {
  dutyText: string;
  sortOrder?: number | null;
};

type BuildOptions = {
  maxDuties?: number;
  maxChars?: number;
};

const DEFAULT_MAX_DUTIES = 20;
const DEFAULT_MAX_CHARS = 4000;

function normalizeDuty(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function buildOnetEmbeddingDocument(
  duties: DutyEntry[],
  options: BuildOptions = {},
): { contentText: string; dutyCount: number; truncated: boolean } {
  const maxDuties = options.maxDuties ?? DEFAULT_MAX_DUTIES;
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;

  const sorted = duties
    .map((duty, idx) => ({ ...duty, idx }))
    .filter((entry) => entry.dutyText && entry.dutyText.trim().length > 0)
    .sort((a, b) => {
      const orderA = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
      const orderB = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      return a.idx - b.idx;
    });

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const entry of sorted) {
    const normalized = normalizeDuty(entry.dutyText);
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(entry.dutyText.trim());
  }

  let truncated = false;
  let sliced = unique;
  if (unique.length > maxDuties) {
    sliced = unique.slice(0, maxDuties);
    truncated = true;
  }

  let contentText = sliced.join('\n');
  if (contentText.length > maxChars) {
    contentText = contentText.slice(0, maxChars).trimEnd();
    truncated = true;
  }

  return { contentText, dutyCount: sliced.length, truncated };
}
