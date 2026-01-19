import { extractSummarySkills } from './summarySkills';

export type CourseInput = {
  title: string;
  credits?: number | null;
  grade?: string | null;
  passStatus?: string | null;
  summary?: string | null;
  hasSkillEvidence?: boolean | null;
  rawLine?: string | null;
};

export type PassStatus = 'pass' | 'fail' | 'unknown';

const COURSE_CODE_RE = /\b[A-Z]{2,6}\s*\d{2,4}[A-Z]?\b/i;
const COURSE_CODE_RE_GLOBAL = /\b[A-Z]{2,6}\s*\d{2,4}[A-Z]?\b/gi;
const GRADE_TOKEN_RE =
  /\b(A\+|A|A-|B\+|B|B-|C\+|C|C-|D\+|D|D-|F|P|PASS|S|U|NP|CR|NC|W|WD|WF|WITHDRAWN|WITHDRAW)\b/i;
const CREDITS_TOKEN_RE = /\b(\d+(?:\.\d+)?)\s*(?:credits?|cr|hrs?|hours?)\b/i;
const SENTENCE_PUNCT_RE = /[.!?]/;
const NUMERIC_TOKEN_RE = /\d+(?:\.\d+)?/g;
const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'is',
  'it',
  'may',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'was',
  'will',
  'with',
]);
const BLOCKLIST_PATTERNS = [
  /\bprogramme\b/i,
  /\bprogram\b/i,
  /\bspecification\b/i,
  /\bregulations?\b/i,
  /\bframework\b/i,
  /\bqualification(s)?\b/i,
  /\bcredit(s)?\s+per\b/i,
  /\bcredit\s+value\b/i,
  /\bworkload\b/i,
  /\bacademic year\b/i,
  /\baward\b/i,
  /\bpass degree\b/i,
  /\bmasters?\b/i,
  /\bstudy regulations\b/i,
  /\bqualifications framework\b/i,
  /\bmodule mark\b/i,
  /\bpass mark\b/i,
  /\bprogression\b/i,
  /\breassessment\b/i,
  /\bprofessional standing\b/i,
  /\badditional information\b/i,
  /\binformation on the course\b/i,
  /\bmay be registered\b/i,
  /\bentry to\b/i,
  /\baccreditation\b/i,
];

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeSummary(value?: string | null): string | undefined {
  if (!value) return undefined;
  const normalized = normalizeWhitespace(value);
  return normalized.length ? normalized : undefined;
}

function isNumericGrade(value: string): boolean {
  return /^\d+(?:\.\d+)?$/.test(value);
}

function splitPackedNumber(raw: string): number[] {
  const [base, decimal] = raw.split('.');
  if (!base || decimal === undefined) {
    return [];
  }
  if (decimal && decimal !== '0' && decimal !== '00') {
    return [];
  }
  if (base.length < 4 || base.length > 6 || base.length % 2 !== 0) {
    return [];
  }
  const parts: number[] = [];
  for (let i = 0; i < base.length; i += 2) {
    parts.push(Number(base.slice(i, i + 2)));
  }
  return parts;
}

function getCourseCodeRanges(value: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let match: RegExpExecArray | null;
  while ((match = COURSE_CODE_RE_GLOBAL.exec(value)) !== null) {
    if (typeof match.index === 'number') {
      ranges.push([match.index, match.index + match[0].length]);
    }
  }
  COURSE_CODE_RE_GLOBAL.lastIndex = 0;
  return ranges;
}

function isInsideRanges(index: number, end: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([start, stop]) => index >= start && end <= stop);
}

function extractNumericTokens(value: string): number[] {
  const tokens: number[] = [];
  const ranges = getCourseCodeRanges(value);
  let match: RegExpExecArray | null;
  while ((match = NUMERIC_TOKEN_RE.exec(value)) !== null) {
    const raw = match[0];
    const start = match.index ?? 0;
    const end = start + raw.length;
    if (isInsideRanges(start, end, ranges)) {
      continue;
    }
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      tokens.push(parsed);
    }
    const split = splitPackedNumber(raw);
    if (split.length) {
      tokens.push(...split);
    }
  }
  return tokens;
}

function formatNumericGrade(value: number): string {
  if (!Number.isFinite(value)) return '';
  return Number.isInteger(value) ? String(value) : value.toString();
}

function hasNumericToken(value: string, target: number): boolean {
  const tokens = extractNumericTokens(value);
  return tokens.some((token) => Math.abs(token - target) < 0.01);
}

function inferNumericGrade(rawLine: string, credits?: number | null): string | undefined {
  const tokens = extractNumericTokens(rawLine);
  if (tokens.length === 0) return undefined;

  let candidates = tokens;
  if (typeof credits === 'number' && Number.isFinite(credits)) {
    const filtered = tokens.filter((token) => Math.abs(token - credits) > 0.01);
    if (filtered.length > 0) {
      candidates = filtered;
    }
  }

  const percentCandidates = candidates.filter((token) => token >= 10 && token <= 100);
  if (percentCandidates.length > 0) {
    return formatNumericGrade(Math.max(...percentCandidates));
  }

  const gpaCandidates = candidates.filter((token) => token >= 0 && token <= 4.5);
  if (gpaCandidates.length > 0) {
    return formatNumericGrade(Math.max(...gpaCandidates));
  }

  return undefined;
}

export function normalizeGrade(value?: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().toUpperCase();
  if (!trimmed) return undefined;
  if (trimmed === 'PASS') return 'P';
  return trimmed;
}

export function normalizePassStatus(value?: string | null): PassStatus | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return undefined;
  if (trimmed === 'pass' || trimmed === 'passed') return 'pass';
  if (trimmed === 'fail' || trimmed === 'failed') return 'fail';
  if (trimmed === 'unknown') return 'unknown';
  return undefined;
}

export function getRulePassStatus(grade?: string | null): PassStatus {
  const normalized = normalizeGrade(grade);
  if (!normalized) return 'unknown';

  if (normalized === 'F' || normalized === 'FAIL') return 'fail';
  if (normalized === 'D' || normalized === 'D+' || normalized === 'D-') return 'fail';
  if (normalized === 'U' || normalized === 'NP' || normalized === 'NC') return 'fail';
  if (normalized.startsWith('W')) return 'fail';
  if (normalized === 'WITHDRAW' || normalized === 'WITHDRAWN' || normalized === 'WITHDREW') {
    return 'fail';
  }
  if (normalized === 'P' || normalized === 'PASS' || normalized === 'S' || normalized === 'CR') {
    return 'pass';
  }
  if (/^[ABC][+-]?$/.test(normalized)) {
    return 'pass';
  }

  const numeric = Number(normalized);
  if (Number.isFinite(numeric)) {
    if (numeric <= 4.5) return 'unknown';
    if (numeric <= 100) return numeric < 60 ? 'fail' : 'pass';
  }

  return 'unknown';
}

export function getRuleFailReason(grade?: string | null): string | undefined {
  const normalized = normalizeGrade(grade);
  if (!normalized) return undefined;

  if (normalized.startsWith('W') || normalized === 'WITHDRAW' || normalized === 'WITHDRAWN') {
    return 'withdrawn grade';
  }
  if (normalized === 'F' || normalized === 'FAIL') return 'grade F';
  if (normalized === 'D' || normalized === 'D+' || normalized === 'D-') return `grade ${normalized}`;
  if (normalized === 'U' || normalized === 'NP' || normalized === 'NC') {
    return `grade ${normalized}`;
  }

  const numeric = Number(normalized);
  if (Number.isFinite(numeric) && numeric > 4.5 && numeric <= 100 && numeric < 60) {
    return `numeric grade ${normalized} < 60`;
  }

  return undefined;
}

export function resolveCoursePassStatus(
  modelStatus?: string | null,
  grade?: string | null,
): {
  modelStatus: PassStatus;
  ruleStatus: PassStatus;
  finalStatus: PassStatus;
  conflict: boolean;
} {
  const normalizedModel = normalizePassStatus(modelStatus) ?? 'unknown';
  const ruleStatus = getRulePassStatus(grade);
  const finalStatus = normalizedModel === 'unknown' ? ruleStatus : normalizedModel;
  const conflict =
    normalizedModel !== 'unknown' &&
    ruleStatus !== 'unknown' &&
    normalizedModel !== ruleStatus;
  return {
    modelStatus: normalizedModel,
    ruleStatus,
    finalStatus,
    conflict,
  };
}

export function isExcludedGrade(value?: string | null): boolean {
  return getRulePassStatus(value) === 'fail';
}

export function isLikelyCourseRow(course: CourseInput): boolean {
  const title = normalizeWhitespace(course.title || '');
  if (!title || title.length < 3) return false;

  const rawLine = course.rawLine ? normalizeWhitespace(course.rawLine) : '';
  const combined = `${title} ${rawLine}`.toLowerCase();

  if (BLOCKLIST_PATTERNS.some((pattern) => pattern.test(combined))) {
    return false;
  }

  const hasCode = COURSE_CODE_RE.test(rawLine || title);
  const hasCreditsToken = CREDITS_TOKEN_RE.test(rawLine);
  const hasCredits = typeof course.credits === 'number' && course.credits > 0;
  const hasGradeToken = rawLine ? GRADE_TOKEN_RE.test(rawLine) : Boolean(course.grade);
  const hasNumeric = /\d/.test(rawLine || title);
  const hasGradeSignal =
    hasGradeToken && (hasCode || hasCredits || hasCreditsToken || hasNumeric);
  const hasSignal = hasCode || hasCredits || hasCreditsToken || hasGradeSignal;

  if (title.length > 120 && !hasCode) {
    return false;
  }

  if (!hasSignal) {
    if (SENTENCE_PUNCT_RE.test(title)) {
      return false;
    }
    if (title.length > 60) {
      return false;
    }
    const words = title.toLowerCase().split(/\s+/);
    const wordCount = words.length;
    if (wordCount === 1) {
      return title.length <= 30;
    }
    const stopCount = words.filter((word) => STOPWORDS.has(word)).length;
    const stopRatio = stopCount / Math.max(wordCount, 1);
    if (wordCount >= 10 || stopRatio >= 0.5) {
      return false;
    }
    return wordCount >= 2;
  }

  return true;
}

export function filterTranscriptCourses<T extends CourseInput>(courses: T[]): T[] {
  const results: T[] = [];

  for (const course of courses) {
    const title = normalizeWhitespace(course.title || '');
    if (!title) continue;

    const rawLine = course.rawLine ? normalizeWhitespace(course.rawLine) : undefined;
    const normalizedGrade = normalizeGrade(course.grade);

    let gradeToken = normalizedGrade;
    if (rawLine && gradeToken) {
      if (isNumericGrade(gradeToken)) {
        const gradeNum = Number(gradeToken);
        if (!Number.isFinite(gradeNum) || !hasNumericToken(rawLine, gradeNum)) {
          gradeToken = undefined;
        }
      } else if (!GRADE_TOKEN_RE.test(rawLine)) {
        gradeToken = undefined;
      }
    }

    if (!gradeToken && rawLine) {
      gradeToken = inferNumericGrade(rawLine, course.credits);
    }

    const { finalStatus, modelStatus } = resolveCoursePassStatus(
      course.passStatus ?? null,
      gradeToken,
    );
    if (finalStatus === 'fail') {
      continue;
    }

    const summary = normalizeSummary(course.summary ?? null);
    const summarySkills = extractSummarySkills(summary);
    const hasSkillEvidence = summarySkills.length >= 2;

    const normalizedCourse = {
      ...course,
      title,
      grade: gradeToken,
      passStatus: course.passStatus !== undefined ? modelStatus : course.passStatus,
      summary,
      hasSkillEvidence,
      rawLine,
    } as T;

    if (!isLikelyCourseRow(normalizedCourse)) {
      continue;
    }

    results.push(normalizedCourse);
  }

  return results;
}
