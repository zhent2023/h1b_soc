import path from 'path';
import { spawn } from 'child_process';

import { PrismaClient } from '@prisma/client';

import { downloadToCache } from './lib/download';
import { resolveOflcWageZipUrl } from './sources/oflc';
import { resolveOnetDbTextZipUrl } from './sources/onet';
import { resolveCountyGazetteerZipUrl } from './sources/county_gazetteer';

const prisma = new PrismaClient();
const ROOT_DIR = path.resolve(__dirname, '../..');

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

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function parseOnetLabel(input: string): string | null {
  const match = input.match(/db[_-]?(\d+)[._](\d+)_text\.zip/i);
  if (!match) {
    return null;
  }
  return `${match[1]}.${match[2]}`;
}

function parseCountyLabel(input: string): string | null {
  const match = input.match(/(\d{4})_gaz_counties_national\.zip/i);
  if (!match) {
    return null;
  }
  return match[1];
}

async function runScript(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('pnpm', ['exec', 'tsx', ...args], {
      cwd: ROOT_DIR,
      env: process.env,
      stdio: 'inherit',
      shell: true,
    });
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed: ${args.join(' ')}`));
      }
    });
  });
}

async function activateDataset(datasetName: string, versionId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.datasetVersion.updateMany({
      where: { datasetName, isActive: true },
      data: { isActive: false },
    });
    await tx.datasetVersion.update({
      where: { id: versionId },
      data: { isActive: true },
    });
  });
}

async function getLatestVersion(datasetName: string) {
  const version = await prisma.datasetVersion.findFirst({
    where: { datasetName },
    orderBy: { createdAt: 'desc' },
  });
  if (!version) {
    throw new Error(`No dataset version found for ${datasetName}.`);
  }
  return version;
}

async function main() {
  const wageYear = getArgValue('--wageYear') ?? process.env.DEFAULT_WAGE_YEAR ?? '2025-2026';
  const activate = hasFlag('--activate');
  const cacheDir =
    getArgValue('--cacheDir') ?? path.join(ROOT_DIR, '.cache', 'ingest');

  const oflcZipPath = getArgValue('--oflcZipPath');
  const onetZipPath = getArgValue('--onetZipPath');
  const countyZipPath = getArgValue('--countyZipPath');

  let resolvedOflcZip = oflcZipPath;
  let oflcSource: 'download' | 'zip' = oflcZipPath ? 'zip' : 'download';
  let oflcUrl: string | null = null;
  if (!resolvedOflcZip) {
    oflcUrl = await resolveOflcWageZipUrl(wageYear);
    resolvedOflcZip = (await downloadToCache(oflcUrl, cacheDir)).path;
  }

  let resolvedOnetZip = onetZipPath;
  let onetLabel: string | null = null;
  let onetSource: 'download' | 'zip' = onetZipPath ? 'zip' : 'download';
  let onetUrl: string | null = null;
  if (!resolvedOnetZip) {
    const onetResolved = await resolveOnetDbTextZipUrl();
    onetUrl = onetResolved.url;
    resolvedOnetZip = (await downloadToCache(onetResolved.url, cacheDir)).path;
    onetLabel = onetResolved.versionLabel;
  } else {
    onetLabel = parseOnetLabel(path.basename(resolvedOnetZip));
  }

  let resolvedCountyZip = countyZipPath;
  let countyLabel: string | null = null;
  let countySource: 'download' | 'zip' = countyZipPath ? 'zip' : 'download';
  let countyUrl: string | null = null;
  if (!resolvedCountyZip) {
    const countyResolved = await resolveCountyGazetteerZipUrl();
    countyUrl = countyResolved.url;
    resolvedCountyZip = (await downloadToCache(countyResolved.url, cacheDir)).path;
    countyLabel = countyResolved.label;
  } else {
    countyLabel = parseCountyLabel(path.basename(resolvedCountyZip));
  }

  console.log(
    `INGEST oflc start source=${oflcSource} ${
      oflcSource === 'download' ? `url=${oflcUrl ?? 'unknown'}` : `path=${resolvedOflcZip}`
    }`,
  );
  await runScript([
    'scripts/ingest/ingest_oflc.ts',
    '--zipPath',
    resolvedOflcZip,
    '--label',
    wageYear,
  ]);
  const oflcVersion = await getLatestVersion('oflc');
  console.log(
    `INGEST oflc done versionId=${oflcVersion.id} label=${oflcVersion.versionLabel}`,
  );

  console.log(
    `INGEST onet start source=${onetSource} ${
      onetSource === 'download' ? `url=${onetUrl ?? 'unknown'}` : `path=${resolvedOnetZip}`
    }`,
  );
  await runScript([
    'scripts/ingest/ingest_onet.ts',
    '--zipPath',
    resolvedOnetZip,
    '--label',
    onetLabel ?? path.basename(resolvedOnetZip),
  ]);
  const onetVersion = await getLatestVersion('onet');
  console.log(
    `INGEST onet done versionId=${onetVersion.id} label=${onetVersion.versionLabel}`,
  );

  console.log(
    `INGEST county start source=${countySource} ${
      countySource === 'download' ? `url=${countyUrl ?? 'unknown'}` : `path=${resolvedCountyZip}`
    }`,
  );
  await runScript([
    'scripts/ingest/ingest_cbsa.ts',
    '--zipPath',
    resolvedCountyZip,
    '--label',
    countyLabel ?? path.basename(resolvedCountyZip),
  ]);
  const countyVersion = await getLatestVersion('cbsa');
  console.log(
    `INGEST county done versionId=${countyVersion.id} label=${countyVersion.versionLabel}`,
  );

  if (activate) {
    await activateDataset('oflc', oflcVersion.id);
    await activateDataset('onet', onetVersion.id);
    await activateDataset('cbsa', countyVersion.id);
  }

  const summary = async (datasetName: string, labelOverride?: string) => {
    const active = await prisma.datasetVersion.findFirst({
      where: { datasetName, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
    return {
      datasetName,
      versionId: active?.id ?? 'unknown',
      label: labelOverride ?? active?.versionLabel ?? 'unknown',
      active: Boolean(active),
    };
  };

  const oflcSummary = await summary('oflc');
  const onetSummary = await summary('onet');
  const countySummary = await summary('cbsa');

  console.log(
    `SUMMARY oflc versionId=${oflcSummary.versionId} label=${oflcSummary.label} active=${oflcSummary.active}`,
  );
  console.log(
    `SUMMARY onet versionId=${onetSummary.versionId} label=${onetSummary.label} active=${onetSummary.active}`,
  );
  console.log(
    `SUMMARY county versionId=${countySummary.versionId} label=${countySummary.label} active=${countySummary.active}`,
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
