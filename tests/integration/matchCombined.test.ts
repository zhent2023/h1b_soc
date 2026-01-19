import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { POST } from '../../app/api/v1/match/combined/route';
import { computeOnetEmbeddings } from '../../src/lib/embeddings/computeOnetEmbeddings';
import { createStubProvider } from '../../src/lib/embeddings/providerStub';
import { createSessionToken, hashSessionToken } from '../../src/lib/session';
import { resetOccupationRequirementsCache } from '../../src/lib/ska/occupationRequirementsCache';

const prisma = new PrismaClient();

const envSnapshot = new Map<string, string | undefined>();
const trackedKeys = [
  'FEATURE_SKILL_MATCHING',
  'FEATURE_MATCH_FUSION',
  'ACCESS_MODE',
  'EMBEDDING_PROVIDER',
  'EMBEDDING_MODEL',
  'SOC_RECOMMEND_INTERNAL_TOPK',
  'SOC_RECOMMEND_STATEMENT_TIMEOUT_MS',
  'SOC_RECOMMEND_FUSION_CANDIDATES',
  'SKILLS_GATE_MIN_EVIDENCE',
  'SKILLS_GATE_MIN_COVERAGE',
  'SKILLS_TIEBREAK_EPS',
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

describe('match combined API', () => {
  let userId = '';
  let sessionToken = '';
  let transcriptIdA = '';
  let transcriptIdB = '';
  let datasetVersionId = '';
  let createdDataset = false;
  let onetDatasetVersionId = '';
  let createdOnetDataset = false;
  let onetEmbeddingVersionId = '';
  let previousActiveEmbeddingIds: string[] = [];
  let onetCodeFail = '';
  let onetCodePass = '';
  let skillIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();

    const user = await prisma.user.create({
      data: {
        email: `combined-${Date.now()}@example.com`,
        passwordHash: 'hashed',
        fullName: 'Combined Test',
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

    onetCodeFail = `99-9999.${String(Date.now() % 100).padStart(2, '0')}`;
    onetCodePass = `99-9999.${String((Date.now() + 1) % 100).padStart(2, '0')}`;
    const skillIdsFail = [`skill-fail-${Date.now()}`];
    const skillIdsPass = [`skill-pass-${Date.now()}`];
    skillIds = [...skillIdsFail, ...skillIdsPass];

    await prisma.occupationSkaRequirement.createMany({
      data: [
        {
          datasetVersionId,
          onetCode: onetCodeFail,
          skillId: skillIdsFail[0],
          importance: 3,
          level: 3,
          reqWeight: 1,
        },
        {
          datasetVersionId,
          onetCode: onetCodePass,
          skillId: skillIdsPass[0],
          importance: 3,
          level: 3,
          reqWeight: 1,
        },
      ],
    });

    const transcriptA = await prisma.transcript.create({
      data: { userId, status: 'READY', parseConfidence: 0.9 },
    });
    const transcriptB = await prisma.transcript.create({
      data: { userId, status: 'READY', parseConfidence: 0.9 },
    });
    transcriptIdA = transcriptA.id;
    transcriptIdB = transcriptB.id;

    await prisma.transcriptCourse.createMany({
      data: [
        {
          transcriptId: transcriptIdA,
          courseKey: 'course-pass',
          title: 'Algorithms',
          credits: 3,
          grade: 'A',
        },
        {
          transcriptId: transcriptIdB,
          courseKey: 'course-b',
          title: 'Databases',
          credits: 3,
          grade: 'B',
        },
      ],
    });

    await prisma.transcriptInferredSka.createMany({
      data: [
        {
          transcriptId: transcriptIdA,
          courseKey: 'course-pass',
          skillId: skillIdsPass[0],
          matchScore: 0.9,
          skillWeight: 0.9,
          embeddingModelId: 'stub',
          datasetVersionId,
        },
      ],
    });

    const onetDataset = await prisma.datasetVersion.create({
      data: {
        datasetName: 'onet',
        versionLabel: `test-onet-${Date.now()}`,
        isActive: false,
      },
    });
    onetDatasetVersionId = onetDataset.id;
    createdOnetDataset = true;

    await prisma.onetDuty.createMany({
      data: [
        {
          datasetVersionId: onetDatasetVersionId,
          onetCode: onetCodeFail,
          dutyText: 'Analyze data sets.',
          dutyTextNorm: 'analyze data sets.',
          sortOrder: 1,
        },
        {
          datasetVersionId: onetDatasetVersionId,
          onetCode: onetCodeFail,
          dutyText: 'Build analytics pipelines.',
          dutyTextNorm: 'build analytics pipelines.',
          sortOrder: 2,
        },
        {
          datasetVersionId: onetDatasetVersionId,
          onetCode: onetCodePass,
          dutyText: 'Write reports.',
          dutyTextNorm: 'write reports.',
          sortOrder: 1,
        },
      ],
    });

    previousActiveEmbeddingIds = (
      await prisma.onetEmbeddingVersion.findMany({
        where: { isActive: true },
        select: { id: true },
      })
    ).map((row) => row.id);

    const provider = createStubProvider('stub');
    const embedResult = await computeOnetEmbeddings({
      prisma,
      provider,
      onetDatasetVersionId,
    });
    onetEmbeddingVersionId = embedResult.embeddingVersionId;
  });

  beforeEach(() => {
    setEnv('FEATURE_SKILL_MATCHING', 'true');
    setEnv('FEATURE_MATCH_FUSION', 'true');
    setEnv('ACCESS_MODE', 'invite');
    setEnv('EMBEDDING_PROVIDER', 'stub');
    setEnv('EMBEDDING_MODEL', 'stub');
    setEnv('SOC_RECOMMEND_INTERNAL_TOPK', '10');
    setEnv('SOC_RECOMMEND_STATEMENT_TIMEOUT_MS', '1500');
    setEnv('SOC_RECOMMEND_FUSION_CANDIDATES', '10');
    setEnv('SKILLS_GATE_MIN_EVIDENCE', '1');
    setEnv('SKILLS_GATE_MIN_COVERAGE', '0.15');
    setEnv('SKILLS_TIEBREAK_EPS', '0.01');
    resetOccupationRequirementsCache();
  });

  afterAll(async () => {
    resetEnv();
    resetOccupationRequirementsCache();

    await prisma.transcriptInferredSka.deleteMany({ where: { transcriptId: { in: [transcriptIdA, transcriptIdB] } } });
    await prisma.transcriptCourse.deleteMany({ where: { transcriptId: { in: [transcriptIdA, transcriptIdB] } } });
    await prisma.transcript.deleteMany({ where: { id: { in: [transcriptIdA, transcriptIdB] } } });

    if (skillIds.length > 0) {
      await prisma.occupationSkaRequirement.deleteMany({
        where: { datasetVersionId, skillId: { in: skillIds } },
      });
    }

    if (onetEmbeddingVersionId) {
      await prisma.onetDutyEmbedding.deleteMany({
        where: { embeddingVersionId: onetEmbeddingVersionId },
      });
      await prisma.onetEmbeddingVersion.deleteMany({
        where: { id: onetEmbeddingVersionId },
      });
    }

    if (previousActiveEmbeddingIds.length > 0) {
      await prisma.onetEmbeddingVersion.updateMany({ data: { isActive: false } });
      await prisma.onetEmbeddingVersion.updateMany({
        where: { id: { in: previousActiveEmbeddingIds } },
        data: { isActive: true },
      });
    }

    if (createdOnetDataset) {
      await prisma.onetDuty.deleteMany({ where: { datasetVersionId: onetDatasetVersionId } });
      await prisma.datasetVersion.deleteMany({ where: { id: onetDatasetVersionId } });
    }

    if (createdDataset) {
      await prisma.datasetVersion.deleteMany({ where: { id: datasetVersionId } });
    }

    await prisma.session.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const buildRequest = async (body: Record<string, unknown>) =>
    new Request('http://localhost/api/v1/match/combined', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `h1b_session=${sessionToken}`,
      },
      body: JSON.stringify(body),
    });

  it('applies skills gate when duties and skills are both present', async () => {
    const req = await buildRequest({
      dutiesText: 'Analyze data sets.',
      transcript_ids: [transcriptIdA, transcriptIdB],
      top_n: 2,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.fusion_applied).toBe(true);
    expect(Array.isArray(payload.results)).toBe(true);
    expect(payload.fusion_meta.skills_gate_enabled).toBe(true);
    expect(payload.results[0]?.onet_code).toBe(onetCodePass);
    expect(payload.results[0]?.skills_gate).toBe('pass');
    expect(payload.results[1]?.onet_code).toBe(onetCodeFail);
    expect(payload.results[1]?.skills_gate).toBe('fail');

    const passEntry = payload.results.find((entry: any) => entry.onet_code === onetCodePass);
    const failEntry = payload.results.find((entry: any) => entry.onet_code === onetCodeFail);
    expect(passEntry?.skills_evidence?.course_count).toBe(1);
    expect(failEntry?.skills_evidence?.course_count).toBe(0);
  });

  it('accepts NEEDS_REVIEW transcripts for skills matching', async () => {
    await prisma.transcript.update({
      where: { id: transcriptIdB },
      data: { status: 'NEEDS_REVIEW' },
    });

    const req = await buildRequest({
      dutiesText: 'Analyze data sets.',
      transcript_ids: [transcriptIdA, transcriptIdB],
      top_n: 2,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.fusion_applied).toBe(true);
    expect(payload.fusion_meta.skills_gate_enabled).toBe(true);

    await prisma.transcript.update({
      where: { id: transcriptIdB },
      data: { status: 'READY' },
    });
  });

  it('returns skills-only results when some transcripts are not ready', async () => {
    await prisma.transcript.update({
      where: { id: transcriptIdB },
      data: { status: 'PARSING' },
    });

    const req = await buildRequest({
      transcript_ids: [transcriptIdA, transcriptIdB],
      top_n: 2,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.fusion_applied).toBe(false);
    expect(payload.results[0]?.source).toBe('skills');

    await prisma.transcript.update({
      where: { id: transcriptIdB },
      data: { status: 'READY' },
    });
  });
});
