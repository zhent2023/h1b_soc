import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';

import type { ParsedCourse } from './types';
import { extractSummarySkills } from './summarySkills';

const MAX_TEXT_CHARS = 20_000;
const DEFAULT_TEXT_MODEL = 'gemini-1.5-flash';

const courseSchema = z.object({
  title: z.string().min(1),
  credits: z.number().optional().nullable(),
  grade: z.string().optional().nullable(),
  passStatus: z.enum(['pass', 'fail', 'unknown']).optional().nullable(),
  summary: z.string().optional().nullable(),
  hasSkillEvidence: z.boolean().optional().nullable(),
  rawLine: z.string().optional().nullable(),
});

const responseSchema = z.object({
  courses: z.array(courseSchema),
  confidence: z.number().min(0).max(1).optional(),
});

const GRADE_RE = /\b(A\+|A|A-|B\+|B|B-|C\+|C|C-|D\+|D|D-|F|P|PASS|S|U|NP|CR|NC)\b/i;
const CREDITS_RE = /\b(\d+(?:\.\d+)?)\s*(?:credits?|cr)\b/i;
const COURSE_CODE_RE = /^[A-Z]{2,6}\s*\d{2,4}[A-Z]?[-:]?\s*/;

function trimText(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeGrade(value?: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().toUpperCase();
  if (!trimmed) return undefined;
  if (trimmed === 'PASS') return 'P';
  return trimmed;
}

function normalizeSummary(value?: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed.length ? trimmed : undefined;
}

function normalizePassStatus(value?: string | null): ParsedCourse['passStatus'] | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return undefined;
  if (trimmed === 'pass' || trimmed === 'passed') return 'pass';
  if (trimmed === 'fail' || trimmed === 'failed') return 'fail';
  if (trimmed === 'unknown') return 'unknown';
  return undefined;
}

function parseCredits(value?: string | number | null): number | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}

function parseNumber(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function extractJson(raw: string): unknown {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1] : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in LLM response.');
  }
  const jsonText = candidate.slice(start, end + 1);
  return JSON.parse(jsonText);
}

function parseCoursesHeuristic(text: string): { courses: ParsedCourse[]; confidence: number } {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const courses: ParsedCourse[] = [];

  for (const line of lines) {
    const creditsMatch = line.match(CREDITS_RE);
    const gradeMatch = line.match(GRADE_RE);
    if (!creditsMatch && !gradeMatch) {
      continue;
    }

    let title = line;
    if (creditsMatch) {
      title = title.replace(creditsMatch[0], '');
    }
    if (gradeMatch) {
      title = title.replace(gradeMatch[0], '');
    }
    title = title.replace(COURSE_CODE_RE, '');
    title = trimText(title);

    if (title.length < 3) {
      continue;
    }

    courses.push({
      title,
      credits: parseCredits(creditsMatch?.[1] ?? null),
      grade: normalizeGrade(gradeMatch?.[1] ?? null),
      rawLine: line,
    });
  }

  if (courses.length === 0) {
    return { courses, confidence: 0 };
  }

  const confidence = Math.min(0.8, 0.3 + Math.min(courses.length, 10) * 0.05);
  return { courses, confidence };
}

async function parseCoursesWithGemini(
  text: string,
  modelName: string,
): Promise<{ courses: ParsedCourse[]; confidence: number; model: string }> {
  const apiKey = process.env.EMBEDDING_API_KEY;
  if (!apiKey) {
    throw new Error('Missing EMBEDDING_API_KEY for transcript parsing.');
  }
  if (typeof window !== 'undefined') {
    throw new Error('Transcript parsing must run server-side.');
  }

  const resolvedModel = modelName.trim() || DEFAULT_TEXT_MODEL;
  const prompt =
    'Extract only actual course rows from the transcript text. ' +
    'Include rows that clearly list a course with a course code and/or explicit grade or credits. ' +
    'Exclude program specifications, regulations, workload/credit summaries, degree requirements, or narrative text. ' +
    'Do not invent grades or credits; use null if not explicitly stated. ' +
    'For each course, infer passStatus as pass, fail, or unknown based on the transcript line. ' +
    'For each course, add summary: 1-2 concise sentences describing the course plus concrete skills it teaches; end with "Skills: skill1; skill2; skill3". ' +
    'Only list skills you can clearly infer from the course title/line; be conservative. ' +
    'Set hasSkillEvidence=true only if you can list at least 2 concrete skills in the Skills line; otherwise set summary=null and hasSkillEvidence=false. ' +
    'If the course is generic (e.g., Seminar, Thesis, Special Topics) or too vague, set hasSkillEvidence=false and summary=null. ' +
    'If unsure, return an empty courses array. ' +
    'For each course, rawLine must be the exact line from the transcript. ' +
    'Return JSON with the shape {"courses":[{"title":"...","credits":3,"grade":"A","passStatus":"pass","summary":"...","hasSkillEvidence":true,"rawLine":"..."}],"confidence":0.0}. ' +
    'Only output JSON.';

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: resolvedModel,
    generationConfig: { temperature: 0.2 },
  });

  const trimmedText = text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text;
  const result = await model.generateContent([prompt, trimmedText]);
  const raw = result.response.text();
  const payload = responseSchema.parse(extractJson(raw));

  const courses = payload.courses.map((course) => {
    const summary = normalizeSummary(course.summary ?? null);
    const hasSkillEvidence = extractSummarySkills(summary).length >= 2;
    return {
      title: trimText(course.title),
      credits: parseCredits(course.credits ?? null),
      grade: normalizeGrade(course.grade ?? null),
      passStatus: normalizePassStatus(course.passStatus ?? null),
      summary,
      hasSkillEvidence,
      rawLine: course.rawLine ? trimText(course.rawLine) : undefined,
    };
  });

  const confidence = payload.confidence ?? (courses.length ? 0.7 : 0.1);
  return { courses, confidence, model: resolvedModel };
}

export async function parseCoursesFromText(text: string): Promise<{
  courses: ParsedCourse[];
  confidence: number;
  parser: 'heuristic' | 'llm';
  model?: string;
}> {
  if (!text.trim()) {
    return { courses: [], confidence: 0, parser: 'heuristic' };
  }

  if (process.env.NODE_ENV === 'test' || !process.env.EMBEDDING_API_KEY) {
    const heuristic = parseCoursesHeuristic(text);
    return { ...heuristic, parser: 'heuristic' };
  }

  const primaryModel = (process.env.TRANSCRIPT_PARSER_MODEL ?? DEFAULT_TEXT_MODEL).trim();
  const fallbackModel = (process.env.TRANSCRIPT_PARSER_FALLBACK_MODEL ?? '').trim();
  const minCourseCount = parseNumber(process.env.TRANSCRIPT_MIN_COURSE_COUNT, 3);
  const fallbackConfidence = parseNumber(process.env.TRANSCRIPT_FALLBACK_MIN_CONFIDENCE, 0.65);

  try {
    const parsed = await parseCoursesWithGemini(text, primaryModel);
    const shouldFallback =
      fallbackModel &&
      fallbackModel !== primaryModel &&
      (parsed.courses.length < minCourseCount || parsed.confidence < fallbackConfidence);

    if (shouldFallback) {
      try {
        const secondary = await parseCoursesWithGemini(text, fallbackModel);
        const improved =
          secondary.courses.length > parsed.courses.length ||
          secondary.confidence > parsed.confidence + 0.05;
        if (improved) {
          return { ...secondary, parser: 'llm' };
        }
      } catch {
        // Ignore fallback failures and keep primary result.
      }
    }

    if (parsed.courses.length > 0) {
      return { ...parsed, parser: 'llm' };
    }
  } catch {
    // Fall back to heuristic parsing.
  }

  const fallback = parseCoursesHeuristic(text);
  return { ...fallback, parser: 'heuristic' };
}
