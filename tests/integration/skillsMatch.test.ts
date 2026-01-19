import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { POST } from '../../app/api/v1/match/skills/route';
import { createSessionToken, hashSessionToken } from '../../src/lib/session';
import { resetOccupationRequirementsCache } from '../../src/lib/ska/occupationRequirementsCache';

const prisma = new PrismaClient();

const envSnapshot = new Map<string, string | undefined>();
const trackedKeys = ['FEATURE_SKILL_MATCHING', 'ACCESS_MODE'];

function setEnv(key: string, value: string | undefined) {
  if (!envSnapshot.has(key)) {
    envSnapshot.set(key, process.env[key]);
  }
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

function resetEnv() {
  for (const key of trackedKeys) {
    if (!envSnapshot.has(key)) continue;
    const value = envSnapshot.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe('skills match API', () => {
  let userId = '';
  let transcriptId = '';
  let datasetVersionId = '';
  let sessionToken = '';
  let createdDataset = false;
  let onetCode = '';
  let skillIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();

    const user = await prisma.user.create({
      data: {
        email: `skills-match-${Date.now()}@example.com`,
        passwordHash: 'hashed',
        fullName: 'Skills Test',
        lawFirm: 'Test Firm',
      },
    });
    userId = user.id;

    sessionToken = createSessionToken();
    await prisma.session.create({
      data: {
        userId,
        tokenHash: hashSessionToken(sessionToken),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const existingDataset = await prisma.datasetVersion.findFirst({
      where: { datasetName: 'onet_ska', isActive: true },
      select: { id: true },
    });

    if (existingDataset) {
      datasetVersionId = existingDataset.id;
    } else {
      const dataset = await prisma.datasetVersion.create({
        data: {
          datasetName: 'onet_ska',
          versionLabel: `test-onet-ska-${Date.now()}`,
          isActive: true,
        },
      });
      datasetVersionId = dataset.id;
      createdDataset = true;
    }

    onetCode = `99-9999.${String(Date.now() % 100).padStart(2, '0')}`;
    skillIds = [`test-skill-a-${Date.now()}`, `test-skill-b-${Date.now()}`];

    await prisma.occupationSkaRequirement.createMany({
      data: [
        {
          datasetVersionId,
          onetCode,
          skillId: skillIds[0],
          importance: 3,
          level: 3,
          reqWeight: 0.7,
        },
        {
          datasetVersionId,
          onetCode,
          skillId: skillIds[1],
          importance: 2,
          level: 2,
          reqWeight: 0.3,
        },
      ],
    });

    const transcript = await prisma.transcript.create({
      data: {
        userId,
        status: 'READY',
        parseConfidence: 0.9,
      },
    });
    transcriptId = transcript.id;

    await prisma.transcriptCourse.create({
      data: {
        transcriptId,
        courseKey: 'course-1',
        title: 'Algorithms',
        credits: 3,
        grade: 'A',
      },
    });

    await prisma.transcriptInferredSka.create({
      data: {
        transcriptId,
        courseKey: 'course-1',
        skillId: skillIds[0],
        matchScore: 0.9,
        skillWeight: 0.9,
        embeddingModelId: 'model-1',
        datasetVersionId,
      },
    });
  });

  beforeEach(() => {
    setEnv('FEATURE_SKILL_MATCHING', 'true');
    setEnv('ACCESS_MODE', 'invite');
    resetOccupationRequirementsCache();
  });

  afterAll(async () => {
    resetEnv();
    await prisma.transcriptInferredSka.deleteMany({ where: { transcriptId } });
    await prisma.transcriptCourse.deleteMany({ where: { transcriptId } });
    await prisma.transcript.deleteMany({ where: { id: transcriptId } });
    if (skillIds.length > 0) {
      await prisma.occupationSkaRequirement.deleteMany({
        where: { datasetVersionId, skillId: { in: skillIds } },
      });
    }
    if (createdDataset) {
      await prisma.datasetVersion.deleteMany({ where: { id: datasetVersionId } });
    }
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const buildRequest = async (body: Record<string, unknown>) =>
    new Request('http://localhost/api/v1/match/skills', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `h1b_session=${sessionToken}`,
      },
      body: JSON.stringify(body),
    });

  it('returns 404 when feature flag is off', async () => {
    setEnv('FEATURE_SKILL_MATCHING', 'false');
    const req = await buildRequest({ transcript_id: transcriptId });
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it('returns 400 when transcript is not ready', async () => {
    await prisma.transcript.update({
      where: { id: transcriptId },
      data: { status: 'PARSING' },
    });

    const req = await buildRequest({ transcript_id: transcriptId });
    const res = await POST(req);
    expect(res.status).toBe(400);

    await prisma.transcript.update({
      where: { id: transcriptId },
      data: { status: 'READY' },
    });
  });

  it('accepts NEEDS_REVIEW transcripts', async () => {
    await prisma.transcript.update({
      where: { id: transcriptId },
      data: { status: 'NEEDS_REVIEW' },
    });

    const req = await buildRequest({ transcript_id: transcriptId });
    const res = await POST(req);
    expect(res.status).toBe(200);

    await prisma.transcript.update({
      where: { id: transcriptId },
      data: { status: 'READY' },
    });
  });

  it('returns ranked occupations for ready transcript', async () => {
    const req = await buildRequest({ transcript_id: transcriptId, top_n: 3 });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(Array.isArray(payload.occupations)).toBe(true);
    expect(payload.occupations.length).toBeGreaterThan(0);
    expect(payload.occupations[0].onetCode).toBe(onetCode);
  });
});
