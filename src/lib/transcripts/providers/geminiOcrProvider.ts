import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';

import { createStorageProviderFromEnv } from '../../storage';
import type { TranscriptParserProvider } from '../types';
import { extractSummarySkills } from '../summarySkills';

const DEFAULT_OCR_MODEL = 'gemini-1.5-flash';
const DEFAULT_MIN_COURSE_COUNT = 3;

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

function normalizePassStatus(value?: string | null): 'pass' | 'fail' | 'unknown' | undefined {
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
    throw new Error('No JSON object found in OCR response.');
  }
  const jsonText = candidate.slice(start, end + 1);
  return JSON.parse(jsonText);
}

export const geminiOcrProvider: TranscriptParserProvider = {
  providerId: 'gemini_ocr',
  version: (process.env.TRANSCRIPT_OCR_MODEL ?? DEFAULT_OCR_MODEL).trim(),
  async parseFromUrl(storageUrl: string) {
    const apiKey = process.env.EMBEDDING_API_KEY;
    if (!apiKey) {
      return { courses: [], confidence: 0, usedPath: 'ocr' };
    }
    if (typeof window !== 'undefined') {
      throw new Error('Transcript OCR must run server-side.');
    }

    try {
      const storage = createStorageProviderFromEnv();
      const buffer = await storage.readObject(storageUrl);
      const base64 = buffer.toString('base64');
      const primaryModel = (process.env.TRANSCRIPT_OCR_MODEL ?? DEFAULT_OCR_MODEL).trim();
      const fallbackModel = (process.env.TRANSCRIPT_OCR_FALLBACK_MODEL ?? '').trim();
      const minCourseCount = parseNumber(
        process.env.TRANSCRIPT_MIN_COURSE_COUNT,
        DEFAULT_MIN_COURSE_COUNT,
      );
      const fallbackConfidence = parseNumber(process.env.TRANSCRIPT_FALLBACK_MIN_CONFIDENCE, 0.65);

      const prompt =
        'Extract only actual course rows from the transcript PDF. ' +
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

      const runModel = async (modelName: string) => {
        const resolvedModel = modelName.trim() || DEFAULT_OCR_MODEL;
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
          model: resolvedModel,
          generationConfig: { temperature: 0.2 },
        });

        const result = await model.generateContent([
          prompt,
          {
            inlineData: {
              data: base64,
              mimeType: 'application/pdf',
            },
          },
        ]);

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

        const confidence = payload.confidence ?? (courses.length ? 0.65 : 0.1);
        return { courses, confidence, model: resolvedModel };
      };

      let parsed = await runModel(primaryModel);
      const shouldFallback =
        fallbackModel &&
        fallbackModel !== primaryModel &&
        (parsed.courses.length < minCourseCount || parsed.confidence < fallbackConfidence);

      if (shouldFallback) {
        try {
          const secondary = await runModel(fallbackModel);
          const improved =
            secondary.courses.length > parsed.courses.length ||
            secondary.confidence > parsed.confidence + 0.05;
          if (improved) {
            parsed = secondary;
          }
        } catch {
          // Ignore fallback errors and keep primary result.
        }
      }
      return {
        courses: parsed.courses,
        confidence: parsed.confidence,
        usedPath: 'ocr',
        parserVersion: parsed.model,
      };
    } catch {
      return { courses: [], confidence: 0, usedPath: 'ocr' };
    }
  },
};
