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
  return value.trim().toLowerCase();
}

function normalizeDigits(raw?: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  return digits ? digits : null;
}

function normalizeCountyFips(raw?: string | null): string | null {
  const digits = normalizeDigits(raw);
  if (!digits) return null;
  return digits.padStart(5, '0');
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
  const geoFile = getArgValue('--geoFile');

  if (!zipPath && !zipUrl) {
    throw new Error('Provide --zipPath or --zipUrl.');
  }

  const resolvedZipPath = await resolveZipPath({ zipPath, zipUrl });
  const zip = await openZip(resolvedZipPath);
  const entries = zip.files.filter((entry) => !entry.path.endsWith('/'));
  const csvEntries = entries.filter((entry) => entry.path.toLowerCase().endsWith('.csv'));
  const geoEntry = pickEntry(csvEntries, [/geography/i, /geo/i, /area/i], geoFile);

  if (!geoEntry) {
    throw new Error('Geography.csv not found in OFLC zip.');
  }

  const datasetVersion = datasetVersionId
    ? await prisma.datasetVersion.findUnique({ where: { id: datasetVersionId } })
    : await prisma.datasetVersion.findFirst({
        where: {
          datasetName: 'oflc',
          ...(datasetVersionLabel ? { versionLabel: datasetVersionLabel } : { isActive: true }),
        },
        orderBy: { createdAt: 'desc' },
      });

  if (!datasetVersion) {
    throw new Error('Target oflc dataset version not found.');
  }

  const cbsaActive = await prisma.datasetVersion.findFirst({
    where: { datasetName: 'cbsa', isActive: true },
    select: { id: true },
  });

  if (!cbsaActive) {
    throw new Error('Active cbsa dataset required to derive county FIPS.');
  }

  const counties = await prisma.geoCounty.findMany({
    where: { datasetVersionId: cbsaActive.id },
    select: { stateAb: true, countyNameNorm: true, countyFips: true },
  });

  const countyIndex: Record<string, string> = {};
  for (const county of counties) {
    countyIndex[`${county.stateAb}:${county.countyNameNorm}`] = county.countyFips;
  }

  const areaStateUpdates = new Map<string, string>();
  const areaCountyBatch: Array<{
    datasetVersionId: string;
    areaCode: string;
    countyFips: string;
    stateAb: string;
    countyTownName: string;
    countyTownNameNorm: string;
    matchKind: string;
  }> = [];

  let areaCount = 0;
  let countyCount = 0;

  await parseCsvStream({
    stream: geoEntry.stream(),
    delimiter: inferDelimiter(geoEntry.path),
    onRow: async (row) => {
      const areaCode =
        getField(row, ['area_code', 'area']) ?? getField(row, ['areacode', 'areaid']);
      const stateAb = getField(row, ['state_ab', 'stateab', 'state']);
      const countyTownRaw =
        getField(row, ['county_town_name', 'county_town', 'countytownname']) ?? null;
      const countyName =
        getField(row, ['county_name', 'county']) ??
        getField(row, ['county_name_text']) ??
        (countyTownRaw && /county/i.test(countyTownRaw) ? countyTownRaw : null);
      const townName =
        getField(row, ['town', 'city', 'place', 'place_name']) ??
        (countyTownRaw && !/county/i.test(countyTownRaw) ? countyTownRaw : null);
      const matchKind = townName ? 'town' : 'county';
      const countyTownName = townName ?? countyName ?? countyTownRaw ?? 'Unknown';
      const countyTownNameNorm = normalizeText(countyTownName);

      if (!areaCode || !stateAb) {
        return;
      }

      if (!areaStateUpdates.has(areaCode)) {
        areaStateUpdates.set(areaCode, stateAb);
        areaCount += 1;
      }

      const directFips =
        getField(row, ['county_fips', 'fips', 'countycode']) ?? null;
      const countyFips =
        normalizeCountyFips(directFips) ??
        (countyName ? countyIndex[`${stateAb}:${normalizeText(countyName)}`] : undefined) ??
        (countyTownRaw ? countyIndex[`${stateAb}:${normalizeText(countyTownRaw)}`] : undefined) ??
        '00000';

      areaCountyBatch.push({
        datasetVersionId: datasetVersion.id,
        areaCode,
        countyFips,
        stateAb,
        countyTownName,
        countyTownNameNorm,
        matchKind,
      });
      countyCount += 1;
    },
  });

  await prisma.oflcAreaCounty.deleteMany({
    where: { datasetVersionId: datasetVersion.id },
  });

  const updateEntries = Array.from(areaStateUpdates.entries());
  for (const [areaCode, stateAb] of updateEntries) {
    await prisma.oflcArea.updateMany({
      where: { datasetVersionId: datasetVersion.id, areaCode },
      data: { stateAb },
    });
  }

  for (let i = 0; i < areaCountyBatch.length; i += BATCH_SIZE) {
    await prisma.oflcAreaCounty.createMany({
      data: areaCountyBatch.slice(i, i + BATCH_SIZE),
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
        geoRepair: {
          source: path.basename(resolvedZipPath),
          areas: areaCount,
          areaCounties: countyCount,
        },
      },
    },
  });

  console.log(
    `Repaired OFLC geo for version ${datasetVersion.versionLabel} (${datasetVersion.id}).`,
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
