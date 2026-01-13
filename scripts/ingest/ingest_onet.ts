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

function pickEntry(
  entries: ZipEntry[],
  patterns: RegExp[],
  explicit?: string,
  exclude?: string,
) {
  if (explicit) {
    return entries.find((entry) => entry.path.endsWith(explicit));
  }
  return entries.find(
    (entry) =>
      (!exclude || entry.path !== exclude) &&
      patterns.some((pattern) => pattern.test(entry.path)),
  );
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function deriveSocCode(onetCode: string): string | null {
  const match = onetCode.match(/^\d{2}-\d{4}/);
  return match ? match[0] : null;
}

async function main() {
  const zipPath = getArgValue('--zipPath');
  const zipUrl = getArgValue('--zipUrl');
  const label = getArgValue('--label');
  const dutyFile = getArgValue('--dutyFile');
  const mapFile = getArgValue('--mapFile');
  const occupationFile = getArgValue('--occupationFile');

  const resolvedZipPath = await resolveZipPath({ zipPath, zipUrl });
  const zip = await openZip(resolvedZipPath);
  const entries = zip.files.filter((entry: ZipEntry) => !entry.path.endsWith('/'));

  const dutyEntry =
    (dutyFile ? pickEntry(entries, [/task/i, /duty/i], dutyFile) : null) ??
    entries.find((entry) => /task statements/i.test(entry.path)) ??
    pickEntry(entries, [/task/i, /duty/i], dutyFile);
  const occupationEntry =
    (occupationFile ? pickEntry(entries, [/occupation data/i], occupationFile) : null) ??
    entries.find((entry) => /occupation data/i.test(entry.path)) ??
    pickEntry(entries, [/occupation data/i, /occupation/i], occupationFile, dutyEntry?.path);
  let mapEntry = pickEntry(
    entries,
    [/soc/i, /crosswalk/i, /mapping/i],
    mapFile,
    occupationEntry?.path ?? dutyEntry?.path,
  );
  if (!mapEntry && occupationEntry) {
    mapEntry = occupationEntry;
  }

  if (!dutyEntry && !mapEntry && !occupationEntry) {
    throw new Error('No O*NET files detected (duty, occupation, or mapping).');
  }

  const versionLabel = label ?? path.basename(resolvedZipPath);
  const datasetVersion = await prisma.datasetVersion.create({
    data: {
      datasetName: 'onet',
      versionLabel,
      isActive: false,
      metaJson: { source: resolvedZipPath },
    },
  });

  let dutyCount = 0;
  let dutyOrder = 0;
  if (dutyEntry) {
    const dutyBatch: Array<any> = [];
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
  }

  let occupationCount = 0;
  if (occupationEntry) {
    const occupationBatch: Array<any> = [];
    await parseCsvStream({
      stream: occupationEntry.stream(),
      delimiter: inferDelimiter(occupationEntry.path),
      onRow: async (row) => {
        const onetCode =
          getField(row, ['onet_soc_code', 'onet_code', 'onet_soc', 'onet-soc code']) ??
          getField(row, ['onet']);
        const title =
          getField(row, ['title', 'occupation_title', 'occupation', 'soc_title']) ??
          (onetCode ? `O*NET ${onetCode}` : undefined);

        if (!onetCode || !title) {
          return;
        }

        occupationBatch.push({
          datasetVersionId: datasetVersion.id,
          onetCode,
          title,
        });
        occupationCount += 1;

        if (occupationBatch.length >= BATCH_SIZE) {
          await prisma.onetOccupation.createMany({
            data: occupationBatch.splice(0, occupationBatch.length),
            skipDuplicates: true,
          });
        }
      },
    });
    if (occupationBatch.length) {
      await prisma.onetOccupation.createMany({
        data: occupationBatch.splice(0, occupationBatch.length),
        skipDuplicates: true,
      });
    }
  }

  let mapCount = 0;
  let socTitleCount = 0;
  if (mapEntry) {
    const mappingBatch: Array<any> = [];
    const socTitleBatch: Array<any> = [];
    const seenSoc = new Set<string>();

    const flushSocTitles = async () => {
      if (!socTitleBatch.length) return;
      await prisma.socTitle.createMany({
        data: socTitleBatch.splice(0, socTitleBatch.length),
        skipDuplicates: true,
      });
    };

    const flushMappings = async () => {
      await flushSocTitles();
      if (!mappingBatch.length) return;
      await prisma.onetSocMap.createMany({
        data: mappingBatch.splice(0, mappingBatch.length),
        skipDuplicates: true,
      });
    };

    await parseCsvStream({
      stream: mapEntry.stream(),
      delimiter: inferDelimiter(mapEntry.path),
      onRow: async (row) => {
        const onetCode =
          getField(row, ['onet_soc_code', 'onet_code', 'onet_soc', 'onet-soc code']) ??
          getField(row, ['onet']);
        const socCode =
          getField(row, ['soc_code', 'soc', 'soc_code_2018', 'soc_code_2010']) ??
          (onetCode ? deriveSocCode(onetCode) : null);
        const title =
          getField(row, ['title', 'occupation_title', 'occupation', 'soc_title']) ??
          (socCode ? `SOC ${socCode}` : undefined);

        if (!onetCode || !socCode) {
          return;
        }

        if (!seenSoc.has(socCode)) {
          seenSoc.add(socCode);
          socTitleBatch.push({
            datasetVersionId: datasetVersion.id,
            socCode,
            title: title ?? `SOC ${socCode}`,
          });
          socTitleCount += 1;
        }

        mappingBatch.push({
          datasetVersionId: datasetVersion.id,
          onetCode,
          socCode,
        });
        mapCount += 1;

        if (socTitleBatch.length >= BATCH_SIZE) {
          await flushSocTitles();
        }
        if (mappingBatch.length >= BATCH_SIZE) {
          await flushMappings();
        }
      },
    });

    await flushMappings();
  }

  await prisma.datasetVersion.update({
    where: { id: datasetVersion.id },
    data: {
      metaJson: {
        source: resolvedZipPath,
        duties: dutyCount,
        occupations: occupationCount,
        mappings: mapCount,
        socTitles: socTitleCount,
      },
    },
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
