import { createHash } from 'crypto';

import { getPrisma } from '../../db/prisma';
import { embedBatch } from '../embeddings/embedBatch';
import { createEmbeddingProviderFromEnv } from '../embeddings/providerFactory';
import { toVectorLiteral } from '../embeddings/vectorUtils';
import { logMetric } from '../metrics';
import { normalizeCourseTitle } from '../text/normalizeCourseTitle';
import { extractSummarySkills } from '../transcripts/summarySkills';

const TEXT_POLICY = 'skills_only_v1';

type CourseInput = {
  courseKey: string;
  title: string;
  summary?: string | null;
};

type CourseEmbeddingResult = {
  embedding: number[];
  cacheHit: boolean;
};

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function buildCourseText(title: string, summary?: string | null): string {
  const skills = extractSummarySkills(summary);
  if (skills.length >= 2) {
    return `Skills: ${skills.join('; ')}`;
  }
  const normalizedTitle = normalizeCourseTitle(title);
  return `College course title: ${normalizedTitle}`;
}

function parseVector(raw: string): number[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  return JSON.parse(trimmed) as number[];
}

export async function getCourseEmbeddings(
  courses: CourseInput[],
): Promise<Map<string, CourseEmbeddingResult>> {
  const prisma = getPrisma();
  const provider = createEmbeddingProviderFromEnv();

  const coursesWithHash = courses.map((course) => {
    const courseText = buildCourseText(course.title, course.summary);
    const hash = sha256(`${courseText}\n${provider.model}\n${TEXT_POLICY}`).slice(0, 32);
    return {
      ...course,
      courseText,
      hash,
    };
  });

  const hashes = coursesWithHash.map((course) => course.hash);
  const cachedRows = hashes.length
    ? await prisma.$queryRaw<Array<{ courseTextHash: string; embedding: string }>>`
        SELECT "courseTextHash", "embedding"::text as embedding
        FROM "CourseEmbeddingCache"
        WHERE "courseTextHash" = ANY(${hashes})
      `
    : [];

  const cacheMap = new Map<string, number[]>();
  const cachedHashes = new Set<string>();
  for (const row of cachedRows) {
    cacheMap.set(row.courseTextHash, parseVector(row.embedding));
    cachedHashes.add(row.courseTextHash);
  }

  const misses = coursesWithHash.filter((course) => !cacheMap.has(course.hash));

  if (misses.length > 0) {
    const embeddings = await embedBatch(
      provider,
      misses.map((course) => course.courseText),
      64,
    );

    await Promise.all(
      embeddings.map(async (embedding, idx) => {
        const miss = misses[idx];
        const vectorLiteral = toVectorLiteral(embedding);
        cacheMap.set(miss.hash, embedding);
        await prisma.$executeRawUnsafe(
          'INSERT INTO "CourseEmbeddingCache" ("courseTextHash","titleRaw","embedding","embeddingModelId","textPolicy","updatedAt") VALUES ($1, $2, $3::vector, $4, $5, NOW()) ON CONFLICT ("courseTextHash") DO NOTHING',
          miss.hash,
          miss.title,
          vectorLiteral,
          provider.model,
          TEXT_POLICY,
        );
      }),
    );
  }

  const results = new Map<string, CourseEmbeddingResult>();
  for (const course of coursesWithHash) {
    const embedding = cacheMap.get(course.hash);
    if (!embedding) {
      continue;
    }
    results.set(course.courseKey, {
      embedding,
      cacheHit: cachedHashes.has(course.hash),
    });
  }

  const total = coursesWithHash.length;
  if (total > 0) {
    const hits = cachedHashes.size;
    logMetric('course_cache_hit_rate', hits / total, {
      hits,
      misses: total - hits,
      total,
      model: provider.model,
      policy: TEXT_POLICY,
    });
  }

  return results;
}
