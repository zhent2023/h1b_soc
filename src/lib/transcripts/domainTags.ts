import type { PrismaClient } from '@prisma/client';

import { isGenericTitle } from '../text/normalizeCourseTitle';

import { resolveCoursePassStatus } from './courseFilters';

type DomainTagConfig = {
  id: string;
  label: string;
  weight: number;
  extract: Array<{ term: string; word?: boolean }>;
  match: Array<{ term: string; word?: boolean }>;
};

type TranscriptCourseForTags = {
  title: string;
  summary?: string | null;
  passStatus?: string | null;
  grade?: string | null;
  hasSkillEvidence?: boolean | null;
};

export type DomainTagWeights = Map<string, number>;

const DOMAIN_TAGS: DomainTagConfig[] = [
  {
    id: 'digital_media',
    label: 'Digital media',
    weight: 1.0,
    extract: [
      { term: 'digital media' },
      { term: 'multimedia' },
      { term: 'media', word: true },
      { term: 'film', word: true },
      { term: 'video', word: true },
      { term: 'broadcast' },
      { term: 'journalism' },
      { term: 'animation' },
      { term: 'social media' },
      { term: 'communication', word: true },
      { term: 'communications' },
    ],
    match: [
      { term: 'media', word: true },
      { term: 'multimedia' },
      { term: 'broadcast' },
      { term: 'film', word: true },
      { term: 'video', word: true },
      { term: 'communication', word: true },
      { term: 'communications' },
      { term: 'journalist' },
      { term: 'animator' },
      { term: 'producer', word: true },
    ],
  },
  {
    id: 'vr_ar',
    label: 'VR/AR',
    weight: 1.1,
    extract: [
      { term: 'virtual reality' },
      { term: 'augmented reality' },
      { term: 'mixed reality' },
      { term: 'immersive' },
      { term: 'vr', word: true },
      { term: 'ar', word: true },
    ],
    match: [
      { term: 'virtual', word: true },
      { term: 'augmented' },
      { term: 'immersive' },
      { term: 'simulation' },
      { term: 'vr', word: true },
      { term: 'ar', word: true },
    ],
  },
  {
    id: 'visual_design',
    label: 'Visual design',
    weight: 0.9,
    extract: [
      { term: 'design', word: true },
      { term: 'designer', word: true },
      { term: 'graphic', word: true },
      { term: 'visual', word: true },
      { term: 'illustration' },
      { term: 'typography' },
      { term: 'ux', word: true },
      { term: 'ui', word: true },
    ],
    match: [
      { term: 'designer', word: true },
      { term: 'design', word: true },
      { term: 'graphic', word: true },
      { term: 'visual', word: true },
      { term: 'artist', word: true },
      { term: 'illustrator' },
    ],
  },
  {
    id: 'storytelling',
    label: 'Storytelling',
    weight: 0.8,
    extract: [
      { term: 'storytelling' },
      { term: 'narrative' },
      { term: 'story', word: true },
      { term: 'writing', word: true },
      { term: 'script', word: true },
    ],
    match: [
      { term: 'writer', word: true },
      { term: 'writing', word: true },
      { term: 'author', word: true },
      { term: 'editor', word: true },
      { term: 'content', word: true },
    ],
  },
  {
    id: 'sound_audio',
    label: 'Sound & audio',
    weight: 0.9,
    extract: [
      { term: 'audio', word: true },
      { term: 'sound', word: true },
      { term: 'music', word: true },
      { term: 'sonic' },
      { term: 'acoustic' },
    ],
    match: [
      { term: 'audio', word: true },
      { term: 'sound', word: true },
      { term: 'music', word: true },
      { term: 'recording' },
    ],
  },
  {
    id: 'performance',
    label: 'Performance',
    weight: 0.8,
    extract: [
      { term: 'performance', word: true },
      { term: 'performative' },
      { term: 'theatre' },
      { term: 'theater' },
      { term: 'stage', word: true },
      { term: 'acting' },
      { term: 'dance', word: true },
    ],
    match: [
      { term: 'performer', word: true },
      { term: 'performance', word: true },
      { term: 'theatre' },
      { term: 'theater' },
      { term: 'stage', word: true },
    ],
  },
  {
    id: 'art_critique',
    label: 'Art & critique',
    weight: 0.7,
    extract: [
      { term: 'art', word: true },
      { term: 'creative' },
      { term: 'aesthetics' },
      { term: 'critique' },
      { term: 'studio', word: true },
    ],
    match: [
      { term: 'artist', word: true },
      { term: 'art', word: true },
      { term: 'creative', word: true },
      { term: 'aesthetic' },
    ],
  },
  {
    id: 'programming',
    label: 'Programming',
    weight: 0.4,
    extract: [
      { term: 'programming' },
      { term: 'coding' },
      { term: 'software', word: true },
      { term: 'web', word: true },
      { term: 'developer', word: true },
      { term: 'computer', word: true },
    ],
    match: [
      { term: 'programmer', word: true },
      { term: 'developer', word: true },
      { term: 'software', word: true },
      { term: 'web', word: true },
      { term: 'computer', word: true },
    ],
  },
  {
    id: 'data_analytics',
    label: 'Data & analytics',
    weight: 0.4,
    extract: [
      { term: 'data', word: true },
      { term: 'analytics' },
      { term: 'analysis' },
      { term: 'statistics' },
      { term: 'machine learning' },
      { term: 'ml', word: true },
    ],
    match: [
      { term: 'data', word: true },
      { term: 'analyst', word: true },
      { term: 'statistics' },
      { term: 'research', word: true },
    ],
  },
  {
    id: 'business_management',
    label: 'Business & management',
    weight: 0.5,
    extract: [
      { term: 'management' },
      { term: 'marketing' },
      { term: 'strategy' },
      { term: 'business', word: true },
      { term: 'finance', word: true },
      { term: 'entrepreneur' },
    ],
    match: [
      { term: 'manager', word: true },
      { term: 'management' },
      { term: 'marketing' },
      { term: 'business', word: true },
      { term: 'finance', word: true },
    ],
  },
  {
    id: 'engineering',
    label: 'Engineering',
    weight: 0.5,
    extract: [
      { term: 'engineering' },
      { term: 'systems', word: true },
      { term: 'hardware', word: true },
      { term: 'electronics' },
      { term: 'robotics' },
    ],
    match: [
      { term: 'engineer', word: true },
      { term: 'engineering' },
      { term: 'systems', word: true },
      { term: 'electronics' },
    ],
  },
];

const DOMAIN_TAG_BY_ID = new Map(DOMAIN_TAGS.map((tag) => [tag.id, tag]));

function stripSkillsSection(summary?: string | null): string {
  if (!summary) return '';
  const lower = summary.toLowerCase();
  const marker = lower.indexOf('skills:');
  if (marker === -1) return summary;
  return summary.slice(0, marker).trim();
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function matchesTerm(text: string, term: { term: string; word?: boolean }): boolean {
  if (!term.word) {
    return text.includes(term.term);
  }
  const escaped = term.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\b${escaped}\\b`, 'i');
  return regex.test(text);
}

export function extractDomainTagWeights(
  courses: TranscriptCourseForTags[],
): DomainTagWeights {
  const weights: DomainTagWeights = new Map();

  for (const course of courses) {
    const { finalStatus } = resolveCoursePassStatus(
      course.passStatus ?? null,
      course.grade ?? null,
    );
    if (
      course.hasSkillEvidence === false ||
      finalStatus === 'fail' ||
      isGenericTitle(course.title)
    ) {
      continue;
    }

    const title = normalizeText(course.title);
    const summaryText = normalizeText(stripSkillsSection(course.summary));
    const text = `${title} ${summaryText}`.trim();
    if (!text) continue;

    for (const tag of DOMAIN_TAGS) {
      if (tag.extract.some((term) => matchesTerm(text, term))) {
        const current = weights.get(tag.id) ?? 0;
        weights.set(tag.id, current + 1);
      }
    }
  }

  return weights;
}

export async function loadTranscriptDomainTagWeights(
  prisma: PrismaClient,
  transcriptIds: string[],
): Promise<DomainTagWeights> {
  if (transcriptIds.length === 0) return new Map();

  const courses = await prisma.transcriptCourse.findMany({
    where: { transcriptId: { in: transcriptIds } },
    select: {
      title: true,
      summary: true,
      passStatus: true,
      grade: true,
      hasSkillEvidence: true,
    },
  });

  return extractDomainTagWeights(courses);
}

export function computeDomainMatchScore(
  title: string | null | undefined,
  tagWeights: DomainTagWeights,
): number {
  if (!title || tagWeights.size === 0) return 0;
  const normalized = normalizeText(title);
  if (!normalized) return 0;

  let totalWeight = 0;
  let matchedWeight = 0;

  for (const [tagId, count] of tagWeights.entries()) {
    const tag = DOMAIN_TAG_BY_ID.get(tagId);
    if (!tag) continue;
    const weight = count * tag.weight;
    totalWeight += weight;
    if (tag.match.some((term) => matchesTerm(normalized, term))) {
      matchedWeight += weight;
    }
  }

  if (totalWeight <= 0) return 0;
  return Math.min(1, matchedWeight / totalWeight);
}

export function formatDomainTags(tagWeights: DomainTagWeights) {
  const entries = Array.from(tagWeights.entries())
    .map(([tagId, count]) => {
      const tag = DOMAIN_TAG_BY_ID.get(tagId);
      if (!tag) return null;
      return {
        id: tagId,
        label: tag.label,
        count,
        weight: tag.weight,
      };
    })
    .filter(Boolean);

  entries.sort((a, b) => (b?.count ?? 0) - (a?.count ?? 0));
  return entries;
}

