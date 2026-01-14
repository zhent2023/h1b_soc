import fs from 'fs';
import path from 'path';

import { PrismaClient } from '@prisma/client';

import { downloadToCache } from './lib/download';
import { getField, parseCsvStream } from './utils';

const prisma = new PrismaClient();

const ROOT_DIR = path.resolve(__dirname, '../..');
const BATCH_SIZE = 2000;
const DEFAULT_CITY_COUNTY_URL =
  process.env.CITY_COUNTY_CSV_URL ??
  'https://raw.githubusercontent.com/kelvins/US-Cities-Database/master/csv/us_cities.csv';

const COUNTY_SUFFIX_RE =
  /(,?\s*(county|parish|borough|census area|municipio|municipality|city and borough|city and|city))$/i;

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

function normalizeSaint(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\bsaint\b/g, 'st')
    .replace(/\bste\b/g, 'st');
}

function normalizeCityName(value: string): string {
  return normalizeSaint(value).replace(/[^a-z0-9]+/g, '');
}

function normalizeCountyName(value: string): string {
  return normalizeSaint(value).replace(/[^a-z0-9]+/g, '');
}

function normalizeCountyKey(value: string): string {
  const stripped = normalizeSaint(value).replace(COUNTY_SUFFIX_RE, '').trim();
  return stripped.replace(/[^a-z0-9]+/g, '');
}

function buildCountyKey(stateAb: string, countyName: string): string {
  return `${stateAb}:${normalizeCountyKey(countyName)}`;
}

async function resolveCsvPath(params: {
  csvPath?: string;
  csvUrl?: string;
  cacheDir: string;
}): Promise<{ path: string; source: 'download' | 'path'; url: string | null }> {
  if (params.csvPath) {
    return { path: params.csvPath, source: 'path', url: null };
  }
  const url = params.csvUrl ?? DEFAULT_CITY_COUNTY_URL;
  const resolved = await downloadToCache(url, params.cacheDir);
  return { path: resolved.path, source: 'download', url };
}

type CountyIndexEntry = { countyFips: string; countyName: string };

async function loadCountyIndex(cbsaVersionId?: string) {
  if (!cbsaVersionId) {
    return {
      full: new Map<string, CountyIndexEntry | null>(),
      stripped: new Map<string, CountyIndexEntry | null>(),
    };
  }
  const counties = await prisma.geoCounty.findMany({
    where: { datasetVersionId: cbsaVersionId },
    select: { stateAb: true, countyName: true, countyFips: true },
  });

  const full = new Map<string, CountyIndexEntry | null>();
  const stripped = new Map<string, CountyIndexEntry | null>();
  const upsertIndex = (
    index: Map<string, CountyIndexEntry | null>,
    key: string,
    entry: CountyIndexEntry,
  ) => {
    const existing = index.get(key);
    if (!existing) {
      index.set(key, entry);
      return;
    }
    if (existing.countyFips !== entry.countyFips) {
      index.set(key, null);
    }
  };
  for (const county of counties) {
    const entry = { countyFips: county.countyFips, countyName: county.countyName };
    const fullKey = `${county.stateAb}:${normalizeCountyName(county.countyName)}`;
    const strippedKey = buildCountyKey(county.stateAb, county.countyName);
    upsertIndex(full, fullKey, entry);
    upsertIndex(stripped, strippedKey, entry);
  }

  return { full, stripped };
}

async function resolveCbsaVersionId(): Promise<string | undefined> {
  const cbsaVersionId = getArgValue('--cbsaVersionId');
  const cbsaVersionLabel = getArgValue('--cbsaVersionLabel');

  if (cbsaVersionId) {
    const found = await prisma.datasetVersion.findUnique({
      where: { id: cbsaVersionId },
      select: { id: true },
    });
    return found?.id;
  }

  if (cbsaVersionLabel) {
    const found = await prisma.datasetVersion.findFirst({
      where: { datasetName: 'cbsa', versionLabel: cbsaVersionLabel },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    return found?.id;
  }

  const active = await prisma.datasetVersion.findFirst({
    where: { datasetName: 'cbsa', isActive: true },
    select: { id: true },
  });
  return active?.id;
}

async function main() {
  const csvPath = getArgValue('--csvPath');
  const csvUrl = getArgValue('--csvUrl');
  const label = getArgValue('--label');
  const cacheDir = getArgValue('--cacheDir') ?? path.join(ROOT_DIR, '.cache', 'ingest');

  const resolved = await resolveCsvPath({ csvPath, csvUrl, cacheDir });
  const versionLabel = label ?? path.basename(resolved.path);

  const cbsaVersionId = await resolveCbsaVersionId();
  if (!cbsaVersionId) {
    console.warn('No CBSA dataset version found; county FIPS mapping may be incomplete.');
  }
  const countyIndex = await loadCountyIndex(cbsaVersionId);

  const datasetVersion = await prisma.datasetVersion.create({
    data: {
      datasetName: 'city_county',
      versionLabel,
      isActive: false,
      metaJson: {
        source: resolved.path,
        url: resolved.url,
        cbsaVersionId: cbsaVersionId ?? null,
      },
    },
  });

  let rowCount = 0;
  let missingFipsCount = 0;
  let ambiguousFipsCount = 0;
  const batch: Array<any> = [];

  await parseCsvStream({
    stream: fs.createReadStream(resolved.path),
    onRow: async (row) => {
      const stateAb = (getField(row, ['state_code', 'state']) ?? '').trim().toUpperCase();
      const cityName = getField(row, ['city']) ?? '';
      const countyName = getField(row, ['county']) ?? '';

      if (!stateAb || !cityName || !countyName) {
        return;
      }

      const cityNameNorm = normalizeCityName(cityName);
      const fullKey = `${stateAb}:${normalizeCountyName(countyName)}`;
      const strippedKey = `${stateAb}:${normalizeCountyKey(countyName)}`;
      const mapped =
        countyIndex.full.get(fullKey) ?? countyIndex.stripped.get(strippedKey);

      if (mapped === null) {
        ambiguousFipsCount += 1;
      }

      const countyFips = mapped?.countyFips || undefined;
      if (!countyFips) {
        missingFipsCount += 1;
      }

      const resolvedCountyName = mapped?.countyName ?? countyName;

      batch.push({
        datasetVersionId: datasetVersion.id,
        stateAb,
        cityName,
        cityNameNorm,
        countyName: resolvedCountyName,
        countyNameNorm: normalizeCountyName(resolvedCountyName),
        countyFips,
      });
      rowCount += 1;

      if (batch.length >= BATCH_SIZE) {
        await prisma.geoCityCounty.createMany({
          data: batch.splice(0, batch.length),
          skipDuplicates: true,
        });
      }
    },
  });

  if (batch.length) {
    await prisma.geoCityCounty.createMany({
      data: batch.splice(0, batch.length),
      skipDuplicates: true,
    });
  }

  await prisma.datasetVersion.update({
    where: { id: datasetVersion.id },
    data: {
      metaJson: {
        source: resolved.path,
        url: resolved.url,
        cbsaVersionId: cbsaVersionId ?? null,
        rows: rowCount,
        missingCountyFips: missingFipsCount,
        ambiguousCountyFips: ambiguousFipsCount,
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
