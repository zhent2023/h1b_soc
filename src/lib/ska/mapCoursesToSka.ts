import { getPrisma } from '../../db/prisma';
import { logMetric } from '../metrics';
import { isGenericTitle } from '../text/normalizeCourseTitle';
import { resolveCoursePassStatus } from '../transcripts/courseFilters';

import { loadSkillCatalog } from './skillCatalogCache';
import { cosineSimilarity, topK } from './similarity';

const TOP_K = 10;
const THRESHOLD = 0.75;
const FALLBACK_THRESHOLD = 0.6;
const MIN_ACCEPTABLE_SCORE = 0.5;

export type CourseWithEmbedding = {
  courseKey: string;
  title: string;
  embedding: number[];
  embeddingModelId: string;
  credits?: number;
  grade?: string;
  passStatus?: string;
  hasSkillEvidence?: boolean;
};

export type CourseSkaDebug = {
  courseKey: string;
  title: string;
  status: 'matched' | 'no_match' | 'skipped';
  reason?: string;
  maxScore?: number;
  matchCount?: number;
  thresholdUsed?: 'primary' | 'fallback' | 'best' | 'none';
  topSkill?: { skillId: string; name: string; taxonomyType: string };
};

type MapCoursesOptions = {
  debug?: (entry: CourseSkaDebug) => void;
};

export type InferredSka = {
  transcriptId: string;
  courseKey: string;
  skillId: string;
  matchScore: number;
  skillWeight: number;
  embeddingModelId: string;
  datasetVersionId: string;
};

export function getCreditsWeight(credits?: number) {
  if (!credits || credits <= 0) return 1;
  return Math.min(1.5, Math.max(0.5, credits / 3));
}

export function getGradeWeight(grade?: string) {
  if (!grade) return 1;
  const normalized = grade.trim().toUpperCase();
  if (normalized === 'P' || normalized === 'PASS') return 1;
  if (normalized === 'F' || normalized === 'FAIL') return 0.2;

  const letterMap: Record<string, number> = {
    A: 1.0,
    'A-': 0.95,
    'A+': 1.0,
    B: 0.85,
    'B+': 0.9,
    'B-': 0.8,
    C: 0.7,
    'C+': 0.75,
    'C-': 0.65,
    D: 0.5,
    'D+': 0.55,
    'D-': 0.45,
  };

  if (letterMap[normalized] !== undefined) {
    return letterMap[normalized];
  }

  const numeric = Number(normalized.replace(/[^\d.]/g, ''));
  if (Number.isFinite(numeric)) {
    if (numeric <= 4) {
      return Math.min(1, Math.max(0.2, numeric / 4));
    }
    if (numeric <= 100) {
      return Math.min(1, Math.max(0.2, numeric / 100));
    }
  }

  return 1;
}

export async function mapCoursesToSka(
  transcriptId: string,
  courses: CourseWithEmbedding[],
  options: MapCoursesOptions = {},
): Promise<InferredSka[]> {
  const prisma = getPrisma();
  const { entries: skills, datasetVersionId } = await loadSkillCatalog();
  const results: InferredSka[] = [];
  const emitDebug = options.debug;

  for (const course of courses) {
    const { finalStatus } = resolveCoursePassStatus(course.passStatus ?? null, course.grade ?? null);
    if (
      course.hasSkillEvidence === false ||
      !course.embedding.length ||
      isGenericTitle(course.title) ||
      finalStatus === 'fail'
    ) {
      if (emitDebug) {
        const reason = course.hasSkillEvidence === false
          ? 'no_skill_evidence'
          : !course.embedding.length
            ? 'no_embedding'
            : isGenericTitle(course.title)
              ? 'generic_title'
              : 'failed_course';
        emitDebug({
          courseKey: course.courseKey,
          title: course.title,
          status: 'skipped',
          reason,
        });
      }
      continue;
    }

    const scores = skills.map((skill) => cosineSimilarity(course.embedding, skill.embedding));
    let topMatches = topK(scores, TOP_K, THRESHOLD);
    let thresholdUsed: CourseSkaDebug['thresholdUsed'] = 'none';

    if (topMatches.length > 0) {
      thresholdUsed = 'primary';
    }

    if (topMatches.length === 0) {
      topMatches = topK(scores, TOP_K, FALLBACK_THRESHOLD);
      if (topMatches.length > 0) {
        thresholdUsed = 'fallback';
      }
    }

    let bestScore = -Infinity;
    let bestIndex = -1;
    for (let i = 0; i < scores.length; i += 1) {
      const score = scores[i] ?? -Infinity;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    if (topMatches.length === 0 && scores.length > 0) {
      if (bestScore >= MIN_ACCEPTABLE_SCORE && bestIndex >= 0) {
        topMatches = [{ score: bestScore, index: bestIndex }];
        thresholdUsed = 'best';
      }
    }

    if (emitDebug) {
      const topSkill =
        bestIndex >= 0
          ? {
              skillId: skills[bestIndex].skillId,
              name: skills[bestIndex].name,
              taxonomyType: skills[bestIndex].taxonomyType,
            }
          : undefined;
      emitDebug({
        courseKey: course.courseKey,
        title: course.title,
        status: topMatches.length > 0 ? 'matched' : 'no_match',
        maxScore: Number.isFinite(bestScore) ? bestScore : undefined,
        matchCount: topMatches.length,
        thresholdUsed,
        topSkill,
      });
    }

    for (const match of topMatches) {
      const skill = skills[match.index];
      const weight =
        match.score * getCreditsWeight(course.credits) * getGradeWeight(course.grade);
      results.push({
        transcriptId,
        courseKey: course.courseKey,
        skillId: skill.skillId,
        matchScore: match.score,
        skillWeight: weight,
        embeddingModelId: course.embeddingModelId,
        datasetVersionId,
      });
    }
  }

  if (results.length > 0) {
    await prisma.transcriptInferredSka.createMany({
      data: results,
      skipDuplicates: true,
    });
  }

  logMetric('ska_evidence_count', results.length, {
    transcript_id: transcriptId,
    course_count: courses.length,
    dataset_version_id: datasetVersionId,
  });

  return results;
}
