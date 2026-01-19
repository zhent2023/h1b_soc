export function normalizeCourseTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/\b(fall|spring|summer|winter)\s*\d{2,4}\b/gi, '')
    .replace(/\bsec(tion)?\s*[a-z0-9]+\b/gi, '')
    .replace(/\(honors?\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isGenericTitle(title: string): boolean {
  const normalized = normalizeCourseTitle(title);
  return (
    normalized.length < 5 ||
    /^(seminar|lab|practicum|thesis)$/i.test(normalized)
  );
}
