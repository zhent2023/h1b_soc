import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const WAGE_YEAR = process.env.DEFAULT_WAGE_YEAR ?? '2025-2026';
const SOC_CODE = '15-1252';
const AREA_CODE = '35620';
const COUNTY_FIPS = '36047';
const STATE_AB = 'NY';
const COUNTY_NAME = 'Kings County';

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function buildLevels(l1Annual: number, l1Hourly: number) {
  return {
    l1Annual,
    l1Hourly,
    l2Annual: l1Annual + 10000,
    l2Hourly: l1Hourly + 5,
    l3Annual: l1Annual + 20000,
    l3Hourly: l1Hourly + 10,
    l4Annual: l1Annual + 30000,
    l4Hourly: l1Hourly + 15,
  };
}

async function createDatasetVersion(datasetName: string, versionLabel: string) {
  return prisma.datasetVersion.create({
    data: {
      datasetName,
      versionLabel,
      isActive: false,
    },
  });
}

async function seedOflc(versionId: string, label: string, wageAnnual: number) {
  await prisma.oflcArea.createMany({
    data: [
      {
        datasetVersionId: versionId,
        areaCode: AREA_CODE,
        areaName: `Test Area ${label}`,
        stateAb: STATE_AB,
      },
    ],
  });

  await prisma.oflcAreaCounty.createMany({
    data: [
      {
        datasetVersionId: versionId,
        areaCode: AREA_CODE,
        countyFips: COUNTY_FIPS,
        stateAb: STATE_AB,
        countyTownName: COUNTY_NAME,
        countyTownNameNorm: normalize(COUNTY_NAME),
        matchKind: 'county',
      },
    ],
  });

  await prisma.socTitle.createMany({
    data: [
      {
        datasetVersionId: versionId,
        socCode: SOC_CODE,
        title: 'Software Developers',
      },
    ],
  });

  await prisma.wageRate.createMany({
    data: [
      {
        datasetVersionId: versionId,
        wageYear: WAGE_YEAR,
        isAcwia: false,
        areaCode: AREA_CODE,
        socCode: SOC_CODE,
        ...buildLevels(wageAnnual, Math.round(wageAnnual / 2080)),
        hasDataQualityIssue: false,
      },
    ],
  });
}

async function seedOnet(versionId: string, label: string, dutyText: string) {
  await prisma.socTitle.createMany({
    data: [
      {
        datasetVersionId: versionId,
        socCode: SOC_CODE,
        title: 'Software Developers',
      },
    ],
  });

  await prisma.onetSocMap.createMany({
    data: [
      {
        datasetVersionId: versionId,
        onetCode: `${SOC_CODE}.00`,
        socCode: SOC_CODE,
      },
    ],
  });

  await prisma.onetDuty.createMany({
    data: [
      {
        datasetVersionId: versionId,
        onetCode: `${SOC_CODE}.00`,
        dutyText: dutyText,
        dutyTextNorm: normalize(dutyText),
      },
    ],
  });
}

async function seedCbsa(versionId: string, label: string) {
  await prisma.geoCounty.createMany({
    data: [
      {
        datasetVersionId: versionId,
        countyFips: COUNTY_FIPS,
        stateAb: STATE_AB,
        countyName: COUNTY_NAME,
        countyNameNorm: normalize(COUNTY_NAME),
      },
    ],
  });

  await prisma.geoCbsa.createMany({
    data: [
      {
        datasetVersionId: versionId,
        cbsaCode: AREA_CODE,
        cbsaName: `Test CBSA ${label}`,
        isMetropolitan: true,
      },
    ],
  });

  await prisma.geoCountyToCbsa.createMany({
    data: [
      {
        datasetVersionId: versionId,
        countyFips: COUNTY_FIPS,
        cbsaCode: AREA_CODE,
      },
    ],
  });
}

async function main() {
  for (const datasetName of ['oflc', 'onet', 'cbsa']) {
    await prisma.datasetVersion.updateMany({
      where: { datasetName, isActive: true },
      data: { isActive: false },
    });
  }

  const oflcA = await createDatasetVersion('oflc', 'test_a');
  const oflcB = await createDatasetVersion('oflc', 'test_b');
  const onetA = await createDatasetVersion('onet', 'test_a');
  const onetB = await createDatasetVersion('onet', 'test_b');
  const cbsaA = await createDatasetVersion('cbsa', 'test_a');
  const cbsaB = await createDatasetVersion('cbsa', 'test_b');

  await seedOflc(oflcA.id, 'A', 80000);
  await seedOflc(oflcB.id, 'B', 90000);
  await seedOnet(onetA.id, 'A', 'Duty A - maintain test systems.');
  await seedOnet(onetB.id, 'B', 'Duty B - maintain test systems.');
  await seedCbsa(cbsaA.id, 'A');
  await seedCbsa(cbsaB.id, 'B');

  await prisma.$transaction(async (tx) => {
    await tx.datasetVersion.updateMany({
      where: { datasetName: 'oflc', isActive: true },
      data: { isActive: false },
    });
    await tx.datasetVersion.update({
      where: { id: oflcA.id },
      data: { isActive: true },
    });
  });
  await prisma.$transaction(async (tx) => {
    await tx.datasetVersion.updateMany({
      where: { datasetName: 'onet', isActive: true },
      data: { isActive: false },
    });
    await tx.datasetVersion.update({
      where: { id: onetA.id },
      data: { isActive: true },
    });
  });
  await prisma.$transaction(async (tx) => {
    await tx.datasetVersion.updateMany({
      where: { datasetName: 'cbsa', isActive: true },
      data: { isActive: false },
    });
    await tx.datasetVersion.update({
      where: { id: cbsaA.id },
      data: { isActive: true },
    });
  });

  console.log('Installed test_a/test_b dataset versions.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
