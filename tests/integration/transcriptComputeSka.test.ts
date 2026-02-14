import { createHash, randomUUID } from 'crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { POST } from '../../app/api/v1/transcripts/[id]/compute-ska/route';
import { ensurePrismaEngineStartupLogs } from '../../src/db/prismaEnv';
import { createStubProvider } from '../../src/lib/embeddings/providerStub';
import { toVectorLiteral } from '../../src/lib/embeddings/vectorUtils';
import { createSessionToken, hashSessionToken } from '../../src/lib/session';

ensurePrismaEngineStartupLogs();

const prisma = new PrismaClient();

const envSnapshot = new Map<string, string | undefined>();
const trackedKeys = [
  'FEATURE_SKILL_MATCHING',
  'ACCESS_MODE',
  'EMBEDDING_PROVIDER',
  'EMBEDDING_MODEL',
];

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

describe('transcript compute-ska API', () => {
  let userId = '';
  let sessionToken = '';
  let transcriptId = '';
  let datasetVersionId = '';
  let createdDataset = false;
  let skillRowId = '';

  beforeAll(async () => {
    await prisma.$connect();

    const user = await prisma.user.create({
      data: {
        email: `compute-ska-${Date.now()}@example.com`,
        passwordHash: 'hashed',
        fullName: 'Compute SKA',
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

    const provider = createStubProvider('stub');
    const skillsText = 'Skills: data analysis; visualization; python';
    const embedding = await provider.embedQuery(skillsText);
    const contentHash = createHash('sha256').update(skillsText).digest('hex').slice(0, 32);
    skillRowId = randomUUID();

    await prisma.$executeRawUnsafe(
      'INSERT INTO "SkillCatalog" ("id","datasetVersionId","skillId","name","taxonomyType","embedding","embeddingModelId","contentHash","updatedAt") VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::vector, $7, $8, NOW())',
      skillRowId,
      datasetVersionId,
      `skill-${Date.now()}`,
      'Data Analysis',
      'skill',
      toVectorLiteral(embedding),
      provider.model,
      contentHash,
    );

    const transcript = await prisma.transcript.create({
      data: {
        userId,
        status: 'NEEDS_REVIEW',
        parseConfidence: 0.6,
      },
    });
    transcriptId = transcript.id;

    await prisma.transcriptCourse.create({
      data: {
        transcriptId,
        courseKey: 'course-1',
        title: 'Data Visualization',
        credits: 3,
        grade: 'A',
        summary: 'Skills: data analysis; visualization; python',
        hasSkillEvidence: true,
      },
    });
  });

  beforeEach(() => {
    setEnv('FEATURE_SKILL_MATCHING', 'true');
    setEnv('ACCESS_MODE', 'invite');
    setEnv('EMBEDDING_PROVIDER', 'stub');
    setEnv('EMBEDDING_MODEL', 'stub');
  });

  afterAll(async () => {
    resetEnv();
    await prisma.transcriptInferredSka.deleteMany({ where: { transcriptId } });
    await prisma.transcriptCourse.deleteMany({ where: { transcriptId } });
    await prisma.transcript.deleteMany({ where: { id: transcriptId } });
    if (skillRowId) {
      await prisma.skillCatalog.deleteMany({ where: { id: skillRowId } });
    }
    if (createdDataset) {
      await prisma.datasetVersion.deleteMany({ where: { id: datasetVersionId } });
    }
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const buildRequest = async () =>
    new Request(`http://localhost/api/v1/transcripts/${transcriptId}/compute-ska`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `h1b_session=${sessionToken}`,
      },
    });

  it('computes skills for NEEDS_REVIEW transcripts', async () => {
    const req = await buildRequest();
    const res = await POST(req, { params: { id: transcriptId } });
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.evidenceCount).toBeGreaterThan(0);
  });
});
