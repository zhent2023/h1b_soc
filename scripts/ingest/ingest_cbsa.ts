import path from 'path';

import { PrismaClient } from '@prisma/client';

import { ensurePrismaEngineStartupLogs } from '../../src/db/prismaEnv';

import {
  ZipEntry,
  getField,
  inferDelimiter,
  openZip,
  parseCsvStream,
  resolveZipPath,
} from './utils';

ensurePrismaEngineStartupLogs();

const prisma = new PrismaClient();

const BATCH_SIZE = 2000;

const STATE_FIPS_TO_AB: Record<string, string> = {
  '01': 'AL',
  '02': 'AK',
  '04': 'AZ',
  '05': 'AR',
  '06': 'CA',
  '08': 'CO',
  '09': 'CT',
  '10': 'DE',
  '11': 'DC',
  '12': 'FL',
  '13': 'GA',
  '15': 'HI',
  '16': 'ID',
  '17': 'IL',
  '18': 'IN',
  '19': 'IA',
  '20': 'KS',
  '21': 'KY',
  '22': 'LA',
  '23': 'ME',
  '24': 'MD',
  '25': 'MA',
  '26': 'MI',
  '27': 'MN',
  '28': 'MS',
  '29': 'MO',
  '30': 'MT',
  '31': 'NE',
  '32': 'NV',
  '33': 'NH',
  '34': 'NJ',
  '35': 'NM',
  '36': 'NY',
  '37': 'NC',
  '38': 'ND',
  '39': 'OH',
  '40': 'OK',
  '41': 'OR',
  '42': 'PA',
  '44': 'RI',
  '45': 'SC',
  '46': 'SD',
  '47': 'TN',
  '48': 'TX',
  '49': 'UT',
  '50': 'VT',
  '51': 'VA',
  '53': 'WA',
  '54': 'WV',
  '55': 'WI',
  '56': 'WY',
};

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

function pickEntry(entries: ZipEntry[], patterns: RegExp[], explicit?: string) {
  if (explicit) {
    return entries.find((entry) => entry.path.endsWith(explicit));
  }
  return entries.find((entry) => patterns.some((pattern) => pattern.test(entry.path)));
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeDigits(raw?: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  return digits;
}

function normalizeCountyFips(raw?: string | null): string | null {
  const digits = normalizeDigits(raw);
  if (!digits) return null;
  return digits.padStart(5, '0');
}

function deriveCountyFips(row: Record<string, string>): string | null {
  const direct = normalizeCountyFips(
    getField(row, [
      'county_fips',
      'fips',
      'fipscounty',
      'county_code',
      'countyfips',
      'geoid',
      'geoid_fq',
      'geoidfq',
    ]),
  );
  if (direct) return direct;
  const statePart = normalizeDigits(getField(row, ['state_fips', 'statefips', 'stfips']));
  const countyPart = normalizeDigits(
    getField(row, ['county_fips', 'countyfips', 'county', 'geoid']),
  );
  if (statePart && countyPart) {
    const state = statePart.padStart(2, '0').slice(-2);
    const county = countyPart.padStart(3, '0').slice(-3);
    return `${state}${county}`;
  }
  return null;
}

function deriveStateAb(row: Record<string, string>, countyFips?: string | null): string {
  const direct =
    getField(row, ['state_ab', 'state', 'state_code', 'st', 'usps']) ??
    getField(row, ['stateabbr']);
  if (direct && direct.trim().length === 2) {
    return direct.trim().toUpperCase();
  }
  if (countyFips && countyFips.length >= 2) {
    return STATE_FIPS_TO_AB[countyFips.slice(0, 2)] ?? 'NA';
  }
  return 'NA';
}

function parseCbsaType(value?: string | null): boolean {
  if (!value) return true;
  const normalized = value.toLowerCase();
  if (normalized.includes('micro')) return false;
  if (normalized.includes('metro')) return true;
  return true;
}

async function main() {
  const zipPath = getArgValue('--zipPath');
  const zipUrl = getArgValue('--zipUrl');
  const label = getArgValue('--label');
  const countyFile = getArgValue('--countyFile');
  const cbsaFile = getArgValue('--cbsaFile');
  const crosswalkFile = getArgValue('--crosswalkFile');

  const resolvedZipPath = await resolveZipPath({ zipPath, zipUrl });
  const zip = await openZip(resolvedZipPath);
  const entries = zip.files.filter((entry: ZipEntry) => !entry.path.endsWith('/'));

  const crosswalkEntry = pickEntry(
    entries,
    [/cbsa.*county/i, /county.*cbsa/i, /crosswalk/i],
    crosswalkFile,
  );
  const countyEntry = pickEntry(entries, [/count(y|ies)/i], countyFile);
  const cbsaEntry = pickEntry(entries, [/cbsa/i, /msa/i], cbsaFile);

  if (!crosswalkEntry && !countyEntry && !cbsaEntry) {
    throw new Error('No CBSA files detected in zip.');
  }

  const versionLabel = label ?? path.basename(resolvedZipPath);
  const datasetVersion = await prisma.datasetVersion.create({
    data: {
      datasetName: 'cbsa',
      versionLabel,
      isActive: false,
      metaJson: { source: resolvedZipPath },
    },
  });

  const countyBatch: Array<any> = [];
  const cbsaBatch: Array<any> = [];
  const linkBatch: Array<any> = [];
  const seenCounties = new Set<string>();
  const seenCbsa = new Set<string>();

  let countyCount = 0;
  let cbsaCount = 0;
  let linkCount = 0;

  const flushCounties = async () => {
    if (!countyBatch.length) return;
    await prisma.geoCounty.createMany({
      data: countyBatch.splice(0, countyBatch.length),
      skipDuplicates: true,
    });
  };

  const flushCbsas = async () => {
    if (!cbsaBatch.length) return;
    await prisma.geoCbsa.createMany({
      data: cbsaBatch.splice(0, cbsaBatch.length),
      skipDuplicates: true,
    });
  };

  const flushLinks = async () => {
    await flushCounties();
    await flushCbsas();
    if (!linkBatch.length) return;
    await prisma.geoCountyToCbsa.createMany({
      data: linkBatch.splice(0, linkBatch.length),
      skipDuplicates: true,
    });
  };

  const addCounty = (countyFips: string, stateAb: string, countyName: string) => {
    if (seenCounties.has(countyFips)) return;
    seenCounties.add(countyFips);
    countyBatch.push({
      datasetVersionId: datasetVersion.id,
      countyFips,
      stateAb,
      countyName,
      countyNameNorm: normalizeText(countyName),
    });
    countyCount += 1;
  };

  const addCbsa = (cbsaCode: string, cbsaName: string, isMetropolitan: boolean) => {
    if (seenCbsa.has(cbsaCode)) return;
    seenCbsa.add(cbsaCode);
    cbsaBatch.push({
      datasetVersionId: datasetVersion.id,
      cbsaCode,
      cbsaName,
      isMetropolitan,
    });
    cbsaCount += 1;
  };

  if (countyEntry) {
    await parseCsvStream({
      stream: countyEntry.stream(),
      delimiter: inferDelimiter(countyEntry.path),
      onRow: async (row) => {
        const countyFips = deriveCountyFips(row);
        if (!countyFips) return;
        const countyName =
          getField(row, ['county_name', 'county', 'name']) ?? `County ${countyFips}`;
        const stateAb = deriveStateAb(row, countyFips);
        addCounty(countyFips, stateAb, countyName);
        if (countyBatch.length >= BATCH_SIZE) {
          await flushCounties();
        }
      },
    });
    await flushCounties();
  }

  if (cbsaEntry) {
    await parseCsvStream({
      stream: cbsaEntry.stream(),
      delimiter: inferDelimiter(cbsaEntry.path),
      onRow: async (row) => {
        const cbsaCode =
          getField(row, ['cbsa_code', 'cbsa', 'cbsa_code_id', 'cbsaid']) ?? undefined;
        const cbsaName =
          getField(row, ['cbsa_name', 'cbsa_title', 'name', 'cbsa']) ??
          (cbsaCode ? `CBSA ${cbsaCode}` : undefined);
        if (!cbsaCode || !cbsaName) return;
        const cbsaType = getField(row, ['cbsa_type', 'metro_micro', 'metro']) ?? '';
        addCbsa(cbsaCode, cbsaName, parseCbsaType(cbsaType));
        if (cbsaBatch.length >= BATCH_SIZE) {
          await flushCbsas();
        }
      },
    });
    await flushCbsas();
  }

  if (crosswalkEntry) {
    await parseCsvStream({
      stream: crosswalkEntry.stream(),
      delimiter: inferDelimiter(crosswalkEntry.path),
      onRow: async (row) => {
        const countyFips = deriveCountyFips(row);
        const cbsaCode =
          getField(row, ['cbsa_code', 'cbsa', 'cbsa_code_id', 'cbsaid']) ?? undefined;
        if (!countyFips || !cbsaCode) {
          return;
        }
        const countyName =
          getField(row, ['county_name', 'county', 'name']) ?? `County ${countyFips}`;
        const stateAb = deriveStateAb(row, countyFips);
        addCounty(countyFips, stateAb, countyName);

        const cbsaName =
          getField(row, ['cbsa_name', 'cbsa_title', 'cbsa']) ??
          (cbsaCode ? `CBSA ${cbsaCode}` : undefined);
        if (cbsaName) {
          const cbsaType = getField(row, ['cbsa_type', 'metro_micro', 'metro']) ?? '';
          addCbsa(cbsaCode, cbsaName, parseCbsaType(cbsaType));
        }

        linkBatch.push({
          datasetVersionId: datasetVersion.id,
          countyFips,
          cbsaCode,
        });
        linkCount += 1;

        if (linkBatch.length >= BATCH_SIZE) {
          await flushLinks();
        }
      },
    });
    await flushLinks();
  }

  await flushLinks();

  await prisma.datasetVersion.update({
    where: { id: datasetVersion.id },
    data: {
      metaJson: {
        source: resolvedZipPath,
        counties: countyCount,
        cbsas: cbsaCount,
        links: linkCount,
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
