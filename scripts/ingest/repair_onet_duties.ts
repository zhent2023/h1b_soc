import path from 'path';

import { PrismaClient } from '@prisma/client';

import {
  ZipEntry,
  getField,
  inferDelimiter,
  openZip,
  parseCsvStream,
  resolveZipPath,
} from './utils';

const prisma = new PrismaClient();
const BATCH_SIZE = 2000;

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

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function pickEntry(entries: ZipEntry[], patterns: RegExp[], explicit?: string) {
  if (explicit) {
    return entries.find((entry) => entry.path.endsWith(explicit));
  }
  return entries.find((entry) => patterns.some((pattern) => pattern.test(entry.path)));
}

async function main() {
  const zipPath = getArgValue('--zipPath');
  const zipUrl = getArgValue('--zipUrl');
  const datasetVersionId = getArgValue('--datasetVersionId');
  const datasetVersionLabel = getArgValue('--datasetVersionLabel');
  const dutyFile = getArgValue('--dutyFile');

  if (!zipPath && !zipUrl) {
    throw new Error('Provide --zipPath or --zipUrl.');
  }

  const resolvedZipPath = await resolveZipPath({ zipPath, zipUrl });
  const zip = await openZip(resolvedZipPath);
  const entries = zip.files.filter((entry) => !entry.path.endsWith('/'));

  const dutyEntry =
    (dutyFile ? pickEntry(entries, [/task/i, /duty/i], dutyFile) : null) ??
    entries.find((entry) => /task statements/i.test(entry.path)) ??
    pickEntry(entries, [/task/i, /duty/i], dutyFile);

  if (!dutyEntry) {
    throw new Error('Task Statements file not found in O*NET zip.');
  }

  const datasetVersion = datasetVersionId
    ? await prisma.datasetVersion.findUnique({ where: { id: datasetVersionId } })
    : await prisma.datasetVersion.findFirst({
        where: {
          datasetName: 'onet',
          ...(datasetVersionLabel ? { versionLabel: datasetVersionLabel } : { isActive: true }),
        },
        orderBy: { createdAt: 'desc' },
      });

  if (!datasetVersion) {
    throw new Error('Target onet dataset version not found.');
  }

  await prisma.onetDuty.deleteMany({
    where: { datasetVersionId: datasetVersion.id },
  });

  const dutyBatch: Array<any> = [];
  let dutyCount = 0;
  let dutyOrder = 0;

  await parseCsvStream({
    stream: dutyEntry.stream(),
    delimiter: inferDelimiter(dutyEntry.path),
    onRow: async (row) => {
      const onetCode =
        getField(row, ['onet_soc_code', 'onet_code', 'onet_soc', 'onet-soc code']) ??
        getField(row, ['onet']);
      const dutyText =
        getField(row, ['task', 'task_statement', 'task statement']) ??
        getField(row, ['duty', 'duty_text', 'description']);
      if (!onetCode || !dutyText) {
        return;
      }
      dutyOrder += 1;
      dutyBatch.push({
        datasetVersionId: datasetVersion.id,
        onetCode,
        dutyText,
        dutyTextNorm: normalizeText(dutyText),
        sortOrder: dutyOrder,
      });
      dutyCount += 1;
      if (dutyBatch.length >= BATCH_SIZE) {
        await prisma.onetDuty.createMany({
          data: dutyBatch.splice(0, dutyBatch.length),
          skipDuplicates: true,
        });
      }
    },
  });

  if (dutyBatch.length) {
    await prisma.onetDuty.createMany({
      data: dutyBatch.splice(0, dutyBatch.length),
      skipDuplicates: true,
    });
  }

  const existingMeta =
    datasetVersion.metaJson &&
    typeof datasetVersion.metaJson === 'object' &&
    !Array.isArray(datasetVersion.metaJson)
      ? (datasetVersion.metaJson as Record<string, unknown>)
      : {};

  await prisma.datasetVersion.update({
    where: { id: datasetVersion.id },
    data: {
      metaJson: {
        ...existingMeta,
        dutyRepair: {
          source: path.basename(resolvedZipPath),
          dutyFile: dutyEntry.path,
          duties: dutyCount,
        },
      },
    },
  });

  console.log(
    `Repaired O*NET duties for version ${datasetVersion.versionLabel} (${datasetVersion.id}) using ${dutyEntry.path}.`,
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
