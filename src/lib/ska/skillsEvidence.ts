import type { PrismaClient } from '@prisma/client';

import { loadOccupationRequirements } from './occupationRequirementsCache';

type EvidenceMatch = {
  course_title: string;
  skill_name: string;
  taxonomy_type: string;
  skill_weight: number;
};

export type SkillsEvidenceSummary = {
  course_count: number;
  top_matches: EvidenceMatch[];
};

type EvidenceEntry = {
  transcriptId: string;
  courseKey: string;
  skillId: string;
  skillWeight: number;
};

export async function buildSkillsEvidenceByOnet(params: {
  prisma: PrismaClient;
  transcriptIds: string[];
  onetCodes: string[];
  maxMatches?: number;
}): Promise<Map<string, SkillsEvidenceSummary>> {
  const { prisma, transcriptIds, onetCodes } = params;
  const maxMatches = Math.max(1, params.maxMatches ?? 5);
  const summaries = new Map<string, SkillsEvidenceSummary>();

  if (transcriptIds.length === 0 || onetCodes.length === 0) {
    return summaries;
  }

  const { entries: occReqs, datasetVersionId } = await loadOccupationRequirements();

  const skillIdsByOnet = new Map<string, Set<string>>();
  const skillUnion = new Set<string>();

  for (const code of onetCodes) {
    const reqs = occReqs.get(code) ?? [];
    const set = new Set<string>();
    for (const req of reqs) {
      set.add(req.skillId);
      skillUnion.add(req.skillId);
    }
    skillIdsByOnet.set(code, set);
  }

  if (skillUnion.size === 0) {
    for (const code of onetCodes) {
      summaries.set(code, { course_count: 0, top_matches: [] });
    }
    return summaries;
  }

  const evidence = await prisma.transcriptInferredSka.findMany({
    where: {
      transcriptId: { in: transcriptIds },
      datasetVersionId,
      skillId: { in: Array.from(skillUnion) },
    },
    select: {
      transcriptId: true,
      courseKey: true,
      skillId: true,
      skillWeight: true,
    },
  });

  if (evidence.length === 0) {
    for (const code of onetCodes) {
      summaries.set(code, { course_count: 0, top_matches: [] });
    }
    return summaries;
  }

  const courseKeys = Array.from(
    new Set(evidence.map((entry) => `${entry.transcriptId}:${entry.courseKey}`)),
  );
  const courses = courseKeys.length
    ? await prisma.transcriptCourse.findMany({
        where: {
          OR: courseKeys.map((key) => {
            const [transcriptId, courseKey] = key.split(':');
            return { transcriptId, courseKey };
          }),
        },
        select: { transcriptId: true, courseKey: true, title: true },
      })
    : [];

  const skillRows = await prisma.skillCatalog.findMany({
    where: { datasetVersionId, skillId: { in: Array.from(skillUnion) } },
    select: { skillId: true, name: true, taxonomyType: true },
  });

  const courseMap = new Map(
    courses.map((course) => [`${course.transcriptId}:${course.courseKey}`, course]),
  );
  const skillMap = new Map(
    skillRows.map((skill) => [skill.skillId, skill]),
  );

  const evidenceBySkillId = new Map<string, EvidenceEntry[]>();
  for (const entry of evidence) {
    const bucket = evidenceBySkillId.get(entry.skillId) ?? [];
    bucket.push(entry);
    evidenceBySkillId.set(entry.skillId, bucket);
  }

  for (const code of onetCodes) {
    const skillIds = skillIdsByOnet.get(code);
    if (!skillIds || skillIds.size === 0) {
      summaries.set(code, { course_count: 0, top_matches: [] });
      continue;
    }

    const matches: Array<EvidenceEntry & { skillName?: string; taxonomyType?: string }> = [];
    const courseSet = new Set<string>();

    for (const skillId of skillIds) {
      const entries = evidenceBySkillId.get(skillId) ?? [];
      for (const entry of entries) {
        const key = `${entry.transcriptId}:${entry.courseKey}`;
        courseSet.add(key);
        const skill = skillMap.get(skillId);
        matches.push({
          ...entry,
          skillName: skill?.name,
          taxonomyType: skill?.taxonomyType,
        });
      }
    }

    matches.sort((a, b) => b.skillWeight - a.skillWeight);

    const topMatches: EvidenceMatch[] = matches.slice(0, maxMatches).map((entry) => {
      const course = courseMap.get(`${entry.transcriptId}:${entry.courseKey}`);
      return {
        course_title: course?.title ?? 'Unknown course',
        skill_name: entry.skillName ?? 'Unknown skill',
        taxonomy_type: entry.taxonomyType ?? 'skill',
        skill_weight: entry.skillWeight,
      };
    });

    summaries.set(code, {
      course_count: courseSet.size,
      top_matches: topMatches,
    });
  }

  return summaries;
}
