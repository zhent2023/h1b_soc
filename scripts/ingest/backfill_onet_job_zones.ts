import fs from 'fs';
import path from 'path';

import { PrismaClient } from '@prisma/client';

import { ensurePrismaEngineStartupLogs } from '../../src/db/prismaEnv';
import { getField, inferDelimiter, parseCsvStream } from './utils';

ensurePrismaEngineStartupLogs();

const prisma = new PrismaClient();

const DEFAULT_DATA_DIR = path.join('data', 'onet', 'db_30_1_text');
const JOB_ZONE_FILENAME = 'Job Zones.txt';
const BATCH_SIZE = 300;

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

async function resolveDatasetVersionId(override?: string) {
  if (override) return override;
  const dataset = await prisma.datasetVersion.findFirst({
    where: { datasetName: 'onet', isActive: true },
    select: { id: true },
  });
  if (!dataset) {
    throw new Error('Active O*NET dataset version not found.');
  }
  return dataset.id;
}

function resolveJobZonePath(explicit?: string) {
  if (explicit) {
    return explicit;
  }
  const dataDir = getArgValue('--dataDir') ?? process.env.ONET_DATA_DIR ?? DEFAULT_DATA_DIR;
  const candidate = path.join(dataDir, JOB_ZONE_FILENAME);
  if (!fs.existsSync(candidate)) {
    throw new Error(`Job Zones file not found at ${candidate}. Provide --jobZonePath.`);
  }
  return candidate;
}

async function main() {
  const datasetVersionId = await resolveDatasetVersionId(getArgValue('--datasetVersionId'));
  const jobZonePath = resolveJobZonePath(getArgValue('--jobZonePath'));
  const jobZoneByCode = new Map<string, number>();
  let parsedRows = 0;

  await parseCsvStream({
    stream: fs.createReadStream(jobZonePath),
    delimiter: inferDelimiter(jobZonePath),
    onRow: async (row) => {
      parsedRows += 1;
      const onetCode =
        getField(row, ['o*net-soc code', 'onet_soc_code', 'onet_code', 'onet_soc', 'onet-soc code']) ??
        getField(row, ['onet']);
      const jobZoneRaw =
        getField(row, ['job zone', 'job_zone', 'jobzone', 'job_zone_id', 'jobzone_id']);
      if (!onetCode || !jobZoneRaw) return;
      const jobZone = Number.parseInt(jobZoneRaw, 10);
      if (!Number.isFinite(jobZone)) return;
      jobZoneByCode.set(onetCode, jobZone);
    },
  });

  if (jobZoneByCode.size === 0) {
    throw new Error('No job zone rows parsed. Check the input file.');
  }

  const entries = Array.from(jobZoneByCode.entries());
  let updatedRows = 0;

  for (let offset = 0; offset < entries.length; offset += BATCH_SIZE) {
    const chunk = entries.slice(offset, offset + BATCH_SIZE);
    const results = await prisma.$transaction(
      chunk.map(([onetCode, jobZone]) =>
        prisma.onetOccupation.updateMany({
          where: { datasetVersionId, onetCode },
          data: { jobZone },
        }),
      ),
    );
    updatedRows += results.reduce((sum, item) => sum + item.count, 0);
  }

  console.log(
    JSON.stringify(
      {
        datasetVersionId,
        jobZonePath,
        parsedRows,
        uniqueOnetCodes: jobZoneByCode.size,
        updatedRows,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
