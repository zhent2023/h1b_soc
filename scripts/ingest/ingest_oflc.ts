import path from 'path';

import { PrismaClient } from '@prisma/client';

import { validateWageIntegrity } from './validators/wageIntegrity';
import { getField, inferDelimiter, openZip, parseCsvStream, resolveZipPath } from './utils';

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

function pickEntry(
  entries: { path: string }[],
  patterns: RegExp[],
  explicit?: string,
) {
  if (explicit) {
    return entries.find((entry) => entry.path.endsWith(explicit));
  }
  return entries.find((entry) => patterns.some((pattern) => pattern.test(entry.path)));
}

async function main() {
  const zipPath = getArgValue('--zipPath');
  const zipUrl = getArgValue('--zipUrl');
  const label = getArgValue('--label');
  const geoFile = getArgValue('--geoFile');
  const wageFile = getArgValue('--wageFile');
  const socFile = getArgValue('--socFile');
  const crosswalkFile = getArgValue('--crosswalkFile');

  const resolvedZipPath = await resolveZipPath({ zipPath, zipUrl });
  const zip = await openZip(resolvedZipPath);
  const entries = zip.files.filter((entry) => !entry.path.endsWith('/'));

  const geoEntry = pickEntry(entries, [/geo/i, /area/i, /geography/i], geoFile);
  const wageEntry = pickEntry(entries, [/wage/i, /oes/i, /pw/i], wageFile);
  const socEntry = pickEntry(entries, [/soc/i, /title/i], socFile);
  const crosswalkEntry = pickEntry(entries, [/onet/i, /crosswalk/i, /mapping/i], crosswalkFile);

  if (!geoEntry || !wageEntry) {
    throw new Error('Required geography or wage file not found in zip.');
  }

  const versionLabel = label ?? path.basename(resolvedZipPath);
  const datasetVersion = await prisma.datasetVersion.create({
    data: {
      datasetName: 'oflc',
      versionLabel,
      isActive: false,
      metaJson: { source: resolvedZipPath },
    },
  });

  const cbsaActive = await prisma.datasetVersion.findFirst({
    where: { datasetName: 'cbsa', isActive: true },
    select: { id: true },
  });

  const countyIndex: Record<string, string> = {};
  if (cbsaActive) {
    const counties = await prisma.geoCounty.findMany({
      where: { datasetVersionId: cbsaActive.id },
      select: { stateAb: true, countyNameNorm: true, countyFips: true },
    });
    for (const county of counties) {
      countyIndex[`${county.stateAb}:${county.countyNameNorm}`] = county.countyFips;
    }
  }

  const areas: Map<string, { areaCode: string; areaName: string; stateAb?: string | null }> =
    new Map();
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
      const areaName = getField(row, ['area_name', 'areaname', 'name']);
      const stateAb = getField(row, ['state', 'state_ab', 'stateab']);
      const countyName =
        getField(row, ['county_name', 'county']) ?? getField(row, ['county_name_text']);
      const townName = getField(row, ['town', 'city', 'place', 'place_name']);
      const matchKind = townName ? 'town' : 'county';
      const countyTownName = townName ?? countyName ?? areaName ?? 'Unknown';
      const countyTownNameNorm = normalizeText(countyTownName);
      const countyFips =
        getField(row, ['county_fips', 'fips', 'countycode']) ??
        (stateAb && countyName
          ? countyIndex[`${stateAb}:${normalizeText(countyName)}`]
          : undefined) ??
        '00000';

      if (!areaCode || !areaName) {
        return;
      }

      if (!areas.has(areaCode)) {
        areas.set(areaCode, { areaCode, areaName, stateAb: stateAb ?? null });
        areaCount += 1;
      }

      if (!stateAb) {
        return;
      }

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

      if (areaCountyBatch.length >= BATCH_SIZE) {
        await prisma.oflcAreaCounty.createMany({
          data: areaCountyBatch.splice(0, areaCountyBatch.length),
          skipDuplicates: true,
        });
      }
    },
  });

  await prisma.oflcArea.createMany({
    data: Array.from(areas.values()).map((area) => ({
      datasetVersionId: datasetVersion.id,
      areaCode: area.areaCode,
      areaName: area.areaName,
      stateAb: area.stateAb,
    })),
    skipDuplicates: true,
  });

  if (areaCountyBatch.length) {
    await prisma.oflcAreaCounty.createMany({
      data: areaCountyBatch.splice(0, areaCountyBatch.length),
      skipDuplicates: true,
    });
  }

  let socCount = 0;
  if (socEntry) {
    const socBatch: Array<any> = [];
    await parseCsvStream({
      stream: socEntry.stream(),
      delimiter: inferDelimiter(socEntry.path),
      onRow: async (row) => {
        const socCode = getField(row, ['soc_code', 'soc']);
        const title = getField(row, ['soc_title', 'title', 'occupation_title']);
        if (!socCode || !title) {
          return;
        }
        socBatch.push({
          datasetVersionId: datasetVersion.id,
          socCode,
          title,
        });
        socCount += 1;
        if (socBatch.length >= BATCH_SIZE) {
          await prisma.socTitle.createMany({
            data: socBatch.splice(0, socBatch.length),
            skipDuplicates: true,
          });
        }
      },
    });
    if (socBatch.length) {
      await prisma.socTitle.createMany({
        data: socBatch.splice(0, socBatch.length),
        skipDuplicates: true,
      });
    }
  }

  let wageCount = 0;
  const wageBatch: Array<any> = [];

  await parseCsvStream({
    stream: wageEntry.stream(),
    delimiter: inferDelimiter(wageEntry.path),
    onRow: async (row) => {
      const areaCode = getField(row, ['area_code', 'area']);
      const socCode = getField(row, ['soc_code', 'soc']);
      const wageYear = getField(row, ['wage_year', 'year']) ?? 'unknown';
      const isAcwia =
        (getField(row, ['is_acwia', 'acwia']) ?? '').toLowerCase() === 'true';
      if (!areaCode || !socCode) {
        return;
      }

      const l1Annual = Number(getField(row, ['l1_annual', 'level1_annual', 'l1annual']) ?? '0');
      const l1HourlyRaw = getField(row, ['l1_hourly', 'level1_hourly', 'l1hourly']);
      const l2AnnualRaw = getField(row, ['l2_annual', 'level2_annual', 'l2annual']);
      const l2HourlyRaw = getField(row, ['l2_hourly', 'level2_hourly', 'l2hourly']);
      const l3AnnualRaw = getField(row, ['l3_annual', 'level3_annual', 'l3annual']);
      const l3HourlyRaw = getField(row, ['l3_hourly', 'level3_hourly', 'l3hourly']);
      const l4AnnualRaw = getField(row, ['l4_annual', 'level4_annual', 'l4annual']);
      const l4HourlyRaw = getField(row, ['l4_hourly', 'level4_hourly', 'l4hourly']);

      const l1Hourly = l1HourlyRaw ? Number(l1HourlyRaw) : null;
      const l2Annual = l2AnnualRaw ? Number(l2AnnualRaw) : null;
      const l2Hourly = l2HourlyRaw ? Number(l2HourlyRaw) : null;
      const l3Annual = l3AnnualRaw ? Number(l3AnnualRaw) : null;
      const l3Hourly = l3HourlyRaw ? Number(l3HourlyRaw) : null;
      const l4Annual = l4AnnualRaw ? Number(l4AnnualRaw) : null;
      const l4Hourly = l4HourlyRaw ? Number(l4HourlyRaw) : null;

      const integrity = validateWageIntegrity({
        l1Annual,
        l2Annual,
        l3Annual,
        l4Annual,
        l1Hourly,
        l2Hourly,
        l3Hourly,
        l4Hourly,
      });

      wageBatch.push({
        datasetVersionId: datasetVersion.id,
        wageYear,
        isAcwia,
        areaCode,
        socCode,
        l1Annual,
        l1Hourly,
        l2Annual,
        l2Hourly,
        l3Annual,
        l3Hourly,
        l4Annual,
        l4Hourly,
        hasDataQualityIssue: integrity.hasIssue,
        dataQualityNotes: integrity.hasIssue ? { issues: integrity.notes } : null,
      });

      wageCount += 1;
      if (wageBatch.length >= BATCH_SIZE) {
        await prisma.wageRate.createMany({
          data: wageBatch.splice(0, wageBatch.length),
          skipDuplicates: true,
        });
      }
    },
  });

  if (wageBatch.length) {
    await prisma.wageRate.createMany({
      data: wageBatch.splice(0, wageBatch.length),
      skipDuplicates: true,
    });
  }

  let crosswalkCount = 0;
  if (crosswalkEntry) {
    const mapBatch: Array<any> = [];
    await parseCsvStream({
      stream: crosswalkEntry.stream(),
      delimiter: inferDelimiter(crosswalkEntry.path),
      onRow: async (row) => {
        const socCode = getField(row, ['soc_code', 'soc']);
        const onetCode = getField(row, ['onet_code', 'onet', 'onet_soc']);
        if (!socCode || !onetCode) {
          return;
        }
        mapBatch.push({
          datasetVersionId: datasetVersion.id,
          socCode,
          onetCode,
        });
        crosswalkCount += 1;
        if (mapBatch.length >= BATCH_SIZE) {
          await prisma.onetSocMap.createMany({
            data: mapBatch.splice(0, mapBatch.length),
            skipDuplicates: true,
          });
        }
      },
    });
    if (mapBatch.length) {
      await prisma.onetSocMap.createMany({
        data: mapBatch.splice(0, mapBatch.length),
        skipDuplicates: true,
      });
    }
  }

  await prisma.datasetVersion.update({
    where: { id: datasetVersion.id },
    data: {
      metaJson: {
        source: resolvedZipPath,
        areas: areaCount,
        areaCounties: countyCount,
        wages: wageCount,
        socTitles: socCount,
        crosswalks: crosswalkCount,
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
