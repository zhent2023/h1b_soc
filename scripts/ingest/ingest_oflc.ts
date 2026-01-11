import path from 'path';

import { PrismaClient } from '@prisma/client';

import { validateWageIntegrity } from './validators/wageIntegrity';
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

function pickEntry(
  entries: ZipEntry[],
  patterns: RegExp[],
  explicit?: string,
  exclude?: RegExp[],
) {
  if (explicit) {
    return entries.find((entry) => entry.path.endsWith(explicit));
  }
  return entries.find((entry) => {
    if (exclude && exclude.some((pattern) => pattern.test(entry.path))) {
      return false;
    }
    return patterns.some((pattern) => pattern.test(entry.path));
  });
}

async function main() {
  const zipPath = getArgValue('--zipPath');
  const zipUrl = getArgValue('--zipUrl');
  const label = getArgValue('--label');
  const wageYearArg = getArgValue('--wageYear');
  const geoFile = getArgValue('--geoFile');
  const wageFile = getArgValue('--wageFile');
  const socFile = getArgValue('--socFile');
  const crosswalkFile = getArgValue('--crosswalkFile');

  const resolvedZipPath = await resolveZipPath({ zipPath, zipUrl });
  const zip = await openZip(resolvedZipPath);
  const entries = zip.files.filter((entry: ZipEntry) => !entry.path.endsWith('/'));
  const csvEntries = entries.filter((entry) => entry.path.toLowerCase().endsWith('.csv'));

  const geoEntry = pickEntry(csvEntries, [/geography/i, /geo/i, /area/i], geoFile);
  const socEntry = pickEntry(csvEntries, [/soc/i, /occ/i, /title/i], socFile, [
    /xwalk/i,
    /crosswalk/i,
    /mapping/i,
  ]);
  const crosswalkEntry = pickEntry(
    csvEntries,
    [/xwalk/i, /crosswalk/i, /mapping/i, /onet/i],
    crosswalkFile,
  );

  let wageEntries = csvEntries.filter(
    (entry) =>
      /alc_export\.csv$/i.test(entry.path) || /edc_export\.csv$/i.test(entry.path),
  );
  if (!wageEntries.length) {
    const fallback = pickEntry(csvEntries, [/wage/i, /oes/i, /pw/i], wageFile);
    wageEntries = fallback ? [fallback] : [];
  }

  if (!geoEntry || !wageEntries.length) {
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

  const wageYear = wageYearArg ?? label ?? 'unknown';

  const seenAreas = new Set<string>();
  const areaBatch: Array<{
    datasetVersionId: string;
    areaCode: string;
    areaName: string;
    stateAb?: string | null;
  }> = [];
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

  const flushAreas = async () => {
    if (!areaBatch.length) return;
    await prisma.oflcArea.createMany({
      data: areaBatch.splice(0, areaBatch.length),
      skipDuplicates: true,
    });
  };

  await parseCsvStream({
    stream: geoEntry.stream(),
    delimiter: inferDelimiter(geoEntry.path),
    onRow: async (row) => {
      const areaCode =
        getField(row, ['area_code', 'area']) ?? getField(row, ['areacode', 'areaid']);
      const areaName = getField(row, ['area_name', 'areaname', 'name']);
      const stateAb = getField(row, ['state', 'state_ab', 'stateab']);
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

      if (!seenAreas.has(areaCode)) {
        seenAreas.add(areaCode);
        areaBatch.push({
          datasetVersionId: datasetVersion.id,
          areaCode,
          areaName,
          stateAb: stateAb ?? null,
        });
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
        await flushAreas();
        await prisma.oflcAreaCounty.createMany({
          data: areaCountyBatch.splice(0, areaCountyBatch.length),
          skipDuplicates: true,
        });
      }
    },
  });

  await flushAreas();

  if (areaCountyBatch.length) {
    await prisma.oflcAreaCounty.createMany({
      data: areaCountyBatch.splice(0, areaCountyBatch.length),
      skipDuplicates: true,
    });
  }

  let socCount = 0;
  const seenSocCodes = new Set<string>();
  const missingSocBatch: Array<any> = [];

  const flushMissingSocs = async () => {
    if (!missingSocBatch.length) return;
    await prisma.socTitle.createMany({
      data: missingSocBatch.splice(0, missingSocBatch.length),
      skipDuplicates: true,
    });
  };

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
        if (!seenSocCodes.has(socCode)) {
          seenSocCodes.add(socCode);
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

  const toNumber = (raw?: string | null) => {
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  };

  const toInt = (value: number | null, fallback?: number | null) => {
    if (value !== null && Number.isFinite(value)) return Math.round(value);
    if (fallback !== undefined && fallback !== null && Number.isFinite(fallback)) {
      return Math.round(fallback);
    }
    return null;
  };

  for (const wageEntry of wageEntries) {
    const entryName = wageEntry.path.toLowerCase();
    const inferredIsAcwia = entryName.includes('edc_export')
      ? true
      : entryName.includes('alc_export')
        ? false
        : false;

    await parseCsvStream({
      stream: wageEntry.stream(),
      delimiter: inferDelimiter(wageEntry.path),
      onRow: async (row) => {
        const areaCode = getField(row, ['area_code', 'area']);
        const socCode = getField(row, ['soc_code', 'soc']);
        const rowWageYear = getField(row, ['wage_year', 'year']) ?? wageYear;
        const isAcwiaField = getField(row, ['is_acwia', 'acwia']);
        const isAcwia =
          isAcwiaField !== undefined
            ? isAcwiaField.toLowerCase() === 'true'
            : inferredIsAcwia;
        if (!areaCode || !socCode) {
          return;
        }
        if (!seenSocCodes.has(socCode)) {
          seenSocCodes.add(socCode);
          missingSocBatch.push({
            datasetVersionId: datasetVersion.id,
            socCode,
            title: `SOC ${socCode}`,
          });
          if (missingSocBatch.length >= BATCH_SIZE) {
            await flushMissingSocs();
          }
        }

        const l1AnnualRaw = getField(row, ['l1_annual', 'level1_annual', 'l1annual']);
        const l1HourlyRaw = getField(row, ['l1_hourly', 'level1_hourly', 'l1hourly']);
        const l1GenericRaw = getField(row, ['level1', 'lvl1', 'level_1']);
        const l2AnnualRaw = getField(row, ['l2_annual', 'level2_annual', 'l2annual']);
        const l2HourlyRaw = getField(row, ['l2_hourly', 'level2_hourly', 'l2hourly']);
        const l2GenericRaw = getField(row, ['level2', 'lvl2', 'level_2']);
        const l3AnnualRaw = getField(row, ['l3_annual', 'level3_annual', 'l3annual']);
        const l3HourlyRaw = getField(row, ['l3_hourly', 'level3_hourly', 'l3hourly']);
        const l3GenericRaw = getField(row, ['level3', 'lvl3', 'level_3']);
        const l4AnnualRaw = getField(row, ['l4_annual', 'level4_annual', 'l4annual']);
        const l4HourlyRaw = getField(row, ['l4_hourly', 'level4_hourly', 'l4hourly']);
        const l4GenericRaw = getField(row, ['level4', 'lvl4', 'level_4']);

        const l1AnnualNum = toNumber(l1AnnualRaw);
        const l1HourlyNum = toNumber(l1HourlyRaw ?? l1GenericRaw);
        const l2AnnualNum = toNumber(l2AnnualRaw);
        const l2HourlyNum = toNumber(l2HourlyRaw ?? l2GenericRaw);
        const l3AnnualNum = toNumber(l3AnnualRaw);
        const l3HourlyNum = toNumber(l3HourlyRaw ?? l3GenericRaw);
        const l4AnnualNum = toNumber(l4AnnualRaw);
        const l4HourlyNum = toNumber(l4HourlyRaw ?? l4GenericRaw);

        const l1Annual = toInt(
          l1AnnualNum,
          l1HourlyNum !== null ? l1HourlyNum * 2080 : null,
        );
        const l1Hourly = toInt(
          l1HourlyNum,
          l1AnnualNum !== null ? l1AnnualNum / 2080 : null,
        );
        if (l1Annual === null) {
          return;
        }

        const l2Annual = toInt(
          l2AnnualNum,
          l2HourlyNum !== null ? l2HourlyNum * 2080 : null,
        );
        const l2Hourly = toInt(
          l2HourlyNum,
          l2AnnualNum !== null ? l2AnnualNum / 2080 : null,
        );
        const l3Annual = toInt(
          l3AnnualNum,
          l3HourlyNum !== null ? l3HourlyNum * 2080 : null,
        );
        const l3Hourly = toInt(
          l3HourlyNum,
          l3AnnualNum !== null ? l3AnnualNum / 2080 : null,
        );
        const l4Annual = toInt(
          l4AnnualNum,
          l4HourlyNum !== null ? l4HourlyNum * 2080 : null,
        );
        const l4Hourly = toInt(
          l4HourlyNum,
          l4AnnualNum !== null ? l4AnnualNum / 2080 : null,
        );

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
          wageYear: rowWageYear,
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
          await flushMissingSocs();
          await prisma.wageRate.createMany({
            data: wageBatch.splice(0, wageBatch.length),
            skipDuplicates: true,
          });
        }
      },
    });
  }

  if (wageBatch.length) {
    await flushMissingSocs();
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
        const socCode = getField(row, ['soc_code', 'soc', 'oes_soccode', 'oes_soc']);
        const onetCode = getField(row, ['onet_code', 'onet', 'onet_soc', 'onetcode']);
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
