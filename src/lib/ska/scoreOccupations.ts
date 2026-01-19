import { getPrisma } from '../../db/prisma';

import { loadOccupationRequirements } from './occupationRequirementsCache';

const TAU = 0.6;

export type ContributingSka = {
  skillId: string;
  contribution: number;
};

export type OccupationScore = {
  onetCode: string;
  final: number;
  coverage: number;
  match: number;
  topContributingSkills: ContributingSka[];
};

export async function scoreOccupations(
  transcriptId: string | string[],
  topN = 6,
  options?: { restrictOnetCodes?: string[] },
): Promise<OccupationScore[]> {
  const prisma = getPrisma();
  const { entries: occReqs, datasetVersionId } = await loadOccupationRequirements();
  const ids = Array.isArray(transcriptId) ? transcriptId : [transcriptId];
  const transcriptIds = Array.from(new Set(ids.filter(Boolean)));
  if (transcriptIds.length === 0) {
    return [];
  }
  const restrictSet = options?.restrictOnetCodes
    ? new Set(options.restrictOnetCodes)
    : null;
  const evidence = await prisma.transcriptInferredSka.findMany({
    where: { transcriptId: { in: transcriptIds }, datasetVersionId },
  });

  const userSkillMap = new Map<string, number>();
  for (const entry of evidence) {
    const current = userSkillMap.get(entry.skillId) ?? 0;
    userSkillMap.set(entry.skillId, current + entry.skillWeight);
  }

  const topSkills = [...userSkillMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50);
  const filteredUserSkillMap = new Map(topSkills);

  const scores: OccupationScore[] = [];

  for (const [onetCode, reqs] of occReqs) {
    if (restrictSet && !restrictSet.has(onetCode)) {
      continue;
    }
    let coverage = 0;
    let match = 0;
    const contributing: ContributingSka[] = [];

    for (const req of reqs) {
      const userWeight = filteredUserSkillMap.get(req.skillId) ?? 0;
      const sat = Math.min(1, userWeight / TAU);
      coverage += req.reqWeight * sat;
      match += req.reqWeight * userWeight;

      if (userWeight > 0) {
        contributing.push({
          skillId: req.skillId,
          contribution: req.reqWeight * userWeight,
        });
      }
    }

    const final = 0.7 * coverage + 0.3 * match;
    scores.push({
      onetCode,
      final,
      coverage,
      match,
      topContributingSkills: contributing
        .sort((a, b) => b.contribution - a.contribution)
        .slice(0, 5),
    });
  }

  return scores.sort((a, b) => b.final - a.final).slice(0, topN);
}

export async function getSupportingCourses(
  transcriptId: string,
  topSkills: { skillId: string }[],
) {
  const prisma = getPrisma();
  const { datasetVersionId } = await loadOccupationRequirements();
  const skillIds = topSkills.map((skill) => skill.skillId);
  if (skillIds.length === 0) return [];

  const evidence = await prisma.transcriptInferredSka.findMany({
    where: { transcriptId, datasetVersionId, skillId: { in: skillIds } },
    select: { courseKey: true, skillId: true, skillWeight: true },
  });

  const courseKeys = Array.from(new Set(evidence.map((entry) => entry.courseKey)));
  const courses = await prisma.transcriptCourse.findMany({
    where: { transcriptId, courseKey: { in: courseKeys } },
    select: { courseKey: true, title: true, credits: true, grade: true },
  });

  const courseMap = new Map(courses.map((course) => [course.courseKey, course]));

  return evidence
    .map((entry) => ({
      skillId: entry.skillId,
      course: courseMap.get(entry.courseKey),
      weight: entry.skillWeight,
    }))
    .filter((entry) => entry.course)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 10);
}
