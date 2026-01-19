import fs from 'fs';
import path from 'path';

import { PrismaClient } from '@prisma/client';

import { getField, inferDelimiter, parseCsvStream } from './utils';

const prisma = new PrismaClient();

type SkaRecord = {
  onetCode: string;
  skillId: string;
  importance?: number;
  level?: number;
};

const BATCH_SIZE = 1000;

function getArgValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1]) {
    return process.argv[idx + 1];
  }
  const prefix = `${flag}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  if (found) {
    return found.slice(prefix.length);
  }
  return undefined;
}

function resolveBaseDir(): string {
  const raw = process.env.ONET_DATA_DIR ?? './data/onet';
  const resolved = path.resolve(process.cwd(), raw);
  if (!fs.existsSync(resolved)) {
    throw new Error(`ONET_DATA_DIR not found: ${resolved}`);
  }
  const entries = fs.readdirSync(resolved, { withFileTypes: true });
  if (entries.length === 1 && entries[0]?.isDirectory()) {
    return path.join(resolved, entries[0].name);
  }
  return resolved;
}

function findFile(baseDir: string, patterns: RegExp[], explicit?: string): string {
  if (explicit) {
    const explicitPath = path.join(baseDir, explicit);
    if (fs.existsSync(explicitPath)) {
      return explicitPath;
    }
  }
  const entries = fs.readdirSync(baseDir);
  for (const entry of entries) {
    const lowered = entry.toLowerCase();
    if (patterns.some((pattern) => pattern.test(lowered))) {
      return path.join(baseDir, entry);
    }
  }
  throw new Error(`File not found in ${baseDir}: ${patterns.map((p) => p.source).join(', ')}`);
}

function parseNumber(value?: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}

async function collectSkaRecords(filePath: string, records: Map<string, SkaRecord>) {
  await parseCsvStream({
    stream: fs.createReadStream(filePath),
    delimiter: inferDelimiter(filePath),
    onRow: (row) => {
      const onetCode = getField(row, ['o*net-soc code', 'onet-soc code', 'onet_soc_code']);
      const skillId = getField(row, ['element id', 'element_id']);
      const scaleId = getField(row, ['scale id', 'scale_id']);
      const dataValue = parseNumber(getField(row, ['data value', 'data_value']));

      if (!onetCode || !skillId || !scaleId || dataValue === undefined) {
        return;
      }

      if (scaleId !== 'IM' && scaleId !== 'LV') {
        return;
      }

      const key = `${onetCode}::${skillId}`;
      const existing = records.get(key) ?? { onetCode, skillId };

      if (scaleId === 'IM') {
        existing.importance = dataValue;
      } else if (scaleId === 'LV') {
        existing.level = dataValue;
      }

      records.set(key, existing);
    },
  });
}

async function main() {
  const datasetVersionIdOverride = getArgValue('--datasetVersionId');
  const skillsFile = getArgValue('--skillsFile');
  const knowledgeFile = getArgValue('--knowledgeFile');
  const abilitiesFile = getArgValue('--abilitiesFile');

  const baseDir = resolveBaseDir();
  const skillsPath = findFile(baseDir, [/skills\.txt/], skillsFile);
  const knowledgePath = findFile(baseDir, [/knowledge\.txt/], knowledgeFile);
  const abilitiesPath = findFile(baseDir, [/abilities\.txt/], abilitiesFile);

  const datasetVersion = datasetVersionIdOverride
    ? await prisma.datasetVersion.findUnique({ where: { id: datasetVersionIdOverride } })
    : await prisma.datasetVersion.findFirst({
        where: { datasetName: 'onet_ska' },
        orderBy: { createdAt: 'desc' },
      });

  if (!datasetVersion) {
    throw new Error('No onet_ska dataset version found. Run ingest_onet_ska first.');
  }

  await prisma.occupationSkaRequirement.deleteMany({
    where: { datasetVersionId: datasetVersion.id },
  });

  const records = new Map<string, SkaRecord>();
  await collectSkaRecords(skillsPath, records);
  await collectSkaRecords(knowledgePath, records);
  await collectSkaRecords(abilitiesPath, records);

  const byOcc = new Map<string, SkaRecord[]>();
  for (const record of records.values()) {
    const list = byOcc.get(record.onetCode) ?? [];
    list.push(record);
    byOcc.set(record.onetCode, list);
  }

  const batch: Array<{
    datasetVersionId: string;
    onetCode: string;
    skillId: string;
    importance?: number | null;
    level?: number | null;
    reqWeight: number;
  }> = [];

  for (const [onetCode, items] of byOcc) {
    const rawWeights = items.map((item) => (item.importance ?? 1) * (item.level ?? 1));
    const total = rawWeights.reduce((sum, value) => sum + value, 0);

    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      const reqWeight = total > 0 ? rawWeights[i] / total : 0;
      batch.push({
        datasetVersionId: datasetVersion.id,
        onetCode,
        skillId: item.skillId,
        importance: item.importance ?? null,
        level: item.level ?? null,
        reqWeight,
      });

      if (batch.length >= BATCH_SIZE) {
        await prisma.occupationSkaRequirement.createMany({ data: batch.splice(0, batch.length) });
      }
    }
  }

  if (batch.length > 0) {
    await prisma.occupationSkaRequirement.createMany({ data: batch.splice(0, batch.length) });
  }

  console.log(
    `INGEST onet_ska_requirements done versionId=${datasetVersion.id} rows=${records.size}`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
