import crypto from 'crypto';

import { normalizeCourseTitle } from '../text/normalizeCourseTitle';

export function computeCourseKey(
  title: string,
  credits?: number,
  grade?: string,
  rawLine?: string,
  index?: number,
): string {
  const normalized = normalizeCourseTitle(title);
  const creditsPart = credits ?? '';
  const gradePart = grade ?? '';
  const rawPart = rawLine ?? '';
  const indexPart = typeof index === 'number' ? index : '';
  const digest = crypto
    .createHash('sha256')
    .update(`${normalized}|${creditsPart}|${gradePart}|${rawPart}|${indexPart}`)
    .digest('hex');
  return digest.slice(0, 24);
}
