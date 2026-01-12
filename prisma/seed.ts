import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const DEFAULT_WAGE_YEAR = process.env.DEFAULT_WAGE_YEAR ?? '2025-2026';
const DEFAULT_IS_ACWIA = (process.env.DEFAULT_IS_ACWIA ?? 'false') === 'true';

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildWageLevels(l1Annual: number, l1Hourly: number | null) {
  const level2Annual = l1Annual + 15000;
  const level3Annual = l1Annual + 30000;
  const level4Annual = l1Annual + 45000;
  const baseHourly = l1Hourly ?? roundToCents(l1Annual / 2080);

  return {
    l2Annual: level2Annual,
    l2Hourly: roundToCents(baseHourly + 8),
    l3Annual: level3Annual,
    l3Hourly: roundToCents(baseHourly + 16),
    l4Annual: level4Annual,
    l4Hourly: roundToCents(baseHourly + 24),
  };
}

async function upsertDatasetVersion(datasetName: string) {
  const existing = await prisma.datasetVersion.findFirst({
    where: { datasetName, isActive: true },
  });

  if (existing) {
    return prisma.datasetVersion.update({
      where: { id: existing.id },
      data: { versionLabel: 'fixtures', isActive: true },
    });
  }

  return prisma.datasetVersion.create({
    data: { datasetName, versionLabel: 'fixtures', isActive: true },
  });
}

async function main() {
  const [oflcVersion, onetVersion, cbsaVersion] = await Promise.all([
    upsertDatasetVersion('oflc'),
    upsertDatasetVersion('onet'),
    upsertDatasetVersion('cbsa'),
  ]);

  const accessEmail = 'demo@example.com';
  const accessKey = 'demo-key';
  const keyHash = await bcrypt.hash(accessKey, 10);
  const demoPassword = 'demo-password';
  const passwordHash = await bcrypt.hash(demoPassword, 10);

  await prisma.accessUser.upsert({
    where: { email: accessEmail },
    update: { keyHash, isActive: true },
    create: { email: accessEmail, keyHash, isActive: true },
  });

  await prisma.user.upsert({
    where: { email: accessEmail },
    update: { passwordHash, isActive: true },
    create: { email: accessEmail, passwordHash, isActive: true },
  });

  const areaFixtures = [
    { areaCode: '14460', areaName: 'Boston-Cambridge-Newton, MA-NH', stateAb: 'MA' },
    { areaCode: '35620', areaName: 'New York-Newark-Jersey City, NY-NJ-PA', stateAb: 'NY' },
    { areaCode: '12420', areaName: 'Austin-Round Rock, TX', stateAb: 'TX' },
    { areaCode: '31080', areaName: 'Los Angeles-Long Beach-Anaheim, CA', stateAb: 'CA' },
    { areaCode: '16980', areaName: 'Chicago-Naperville-Elgin, IL-IN-WI', stateAb: 'IL' },
    { areaCode: '47900', areaName: 'Washington-Arlington-Alexandria, DC-VA-MD-WV', stateAb: 'DC' },
    { areaCode: '41860', areaName: 'San Francisco-Oakland-Berkeley, CA', stateAb: 'CA' },
    { areaCode: '38300', areaName: 'Pittsburgh, PA', stateAb: 'PA' },
    { areaCode: '19100', areaName: 'Dallas-Fort Worth-Arlington, TX', stateAb: 'TX' },
    { areaCode: '33100', areaName: 'Miami-Fort Lauderdale-West Palm Beach, FL', stateAb: 'FL' },
    { areaCode: '12060', areaName: 'Atlanta-Sandy Springs-Alpharetta, GA', stateAb: 'GA' },
    { areaCode: '38900', areaName: 'Portland-Vancouver-Hillsboro, OR-WA', stateAb: 'OR' }
  ];

  for (const area of areaFixtures) {
    await prisma.oflcArea.upsert({
      where: {
        datasetVersionId_areaCode: {
          datasetVersionId: oflcVersion.id,
          areaCode: area.areaCode,
        },
      },
      update: { areaName: area.areaName, stateAb: area.stateAb },
      create: {
        datasetVersionId: oflcVersion.id,
        areaCode: area.areaCode,
        areaName: area.areaName,
        stateAb: area.stateAb,
      },
    });
  }

  const areaCountyFixtures = [
    {
      areaCode: '14460',
      countyFips: '25017',
      stateAb: 'MA',
      countyTownName: 'Middlesex County',
      matchKind: 'county',
    },
    {
      areaCode: '14460',
      countyFips: '25017',
      stateAb: 'MA',
      countyTownName: 'Littleton',
      matchKind: 'town',
    },
    {
      areaCode: '35620',
      countyFips: '36047',
      stateAb: 'NY',
      countyTownName: 'Kings County',
      matchKind: 'county',
    },
    {
      areaCode: '12420',
      countyFips: '48453',
      stateAb: 'TX',
      countyTownName: 'Travis County',
      matchKind: 'county',
    },
    {
      areaCode: '31080',
      countyFips: '06037',
      stateAb: 'CA',
      countyTownName: 'Los Angeles County',
      matchKind: 'county',
    },
  ];

  await prisma.oflcAreaCounty.deleteMany({
    where: {
      datasetVersionId: oflcVersion.id,
      areaCode: { in: areaCountyFixtures.map((entry) => entry.areaCode) },
    },
  });

  await prisma.oflcAreaCounty.createMany({
    data: areaCountyFixtures.map((entry) => ({
      datasetVersionId: oflcVersion.id,
      areaCode: entry.areaCode,
      countyFips: entry.countyFips,
      stateAb: entry.stateAb,
      countyTownName: entry.countyTownName,
      countyTownNameNorm: normalize(entry.countyTownName),
      matchKind: entry.matchKind,
    })),
  });

  const socFixtures = [
    { socCode: '15-1252', title: 'Software Developers' },
    { socCode: '13-1161', title: 'Market Research Analysts' },
    { socCode: '27-1021', title: 'Commercial and Industrial Designers' },
    { socCode: '27-2012', title: 'Producers and Directors' },
    { socCode: '17-2071', title: 'Electrical Engineers' },
    { socCode: '13-1081', title: 'Logisticians' },
  ];

  const socCreates = socFixtures.flatMap((soc) => [
    {
      datasetVersionId: oflcVersion.id,
      socCode: soc.socCode,
      title: soc.title,
    },
    {
      datasetVersionId: onetVersion.id,
      socCode: soc.socCode,
      title: soc.title,
    },
  ]);

  await prisma.socTitle.createMany({
    data: socCreates,
    skipDuplicates: true,
  });

  const wageRates = areaFixtures.map((area, index) => {
    const l1Annual = 70000 + index * 4500;
    const l1Hourly = roundToCents(l1Annual / 2080);
    return {
      datasetVersionId: oflcVersion.id,
      wageYear: DEFAULT_WAGE_YEAR,
      isAcwia: DEFAULT_IS_ACWIA,
      areaCode: area.areaCode,
      socCode: '15-1252',
      l1Annual,
      l1Hourly,
      ...buildWageLevels(l1Annual, l1Hourly),
      hasDataQualityIssue: false,
    };
  });

  const targetAreaCodes = ['14460', '35620', '12420', '31080'];
  const extraSocWages = socFixtures
    .filter((soc) => soc.socCode !== '15-1252')
    .flatMap((soc, socIndex) =>
      targetAreaCodes.flatMap((areaCode, areaIndex) => {
        if (soc.socCode === '13-1161' && areaCode === '14460') {
          return [];
        }
        const l1Annual = 60000 + socIndex * 4000 + areaIndex * 1500;
        const l1Hourly = roundToCents(l1Annual / 2080);
        return [
          {
            datasetVersionId: oflcVersion.id,
            wageYear: DEFAULT_WAGE_YEAR,
            isAcwia: DEFAULT_IS_ACWIA,
            areaCode,
            socCode: soc.socCode,
            l1Annual,
            l1Hourly,
            ...buildWageLevels(l1Annual, l1Hourly),
            hasDataQualityIssue: false,
          },
        ];
      }),
    );

  for (const wage of [...wageRates, ...extraSocWages]) {
    await prisma.wageRate.upsert({
      where: {
        datasetVersionId_wageYear_isAcwia_areaCode_socCode: {
          datasetVersionId: wage.datasetVersionId,
          wageYear: wage.wageYear,
          isAcwia: wage.isAcwia,
          areaCode: wage.areaCode,
          socCode: wage.socCode,
        },
      },
      update: {
        l1Annual: wage.l1Annual,
        l1Hourly: wage.l1Hourly,
        l2Annual: wage.l2Annual,
        l2Hourly: wage.l2Hourly,
        l3Annual: wage.l3Annual,
        l3Hourly: wage.l3Hourly,
        l4Annual: wage.l4Annual,
        l4Hourly: wage.l4Hourly,
        hasDataQualityIssue: wage.hasDataQualityIssue,
      },
      create: wage,
    });
  }

  await prisma.wageRate.upsert({
    where: {
      datasetVersionId_wageYear_isAcwia_areaCode_socCode: {
        datasetVersionId: oflcVersion.id,
        wageYear: DEFAULT_WAGE_YEAR,
        isAcwia: DEFAULT_IS_ACWIA,
        areaCode: '14460',
        socCode: '13-1161',
      },
    },
    update: {
      l1Annual: 52000,
      l1Hourly: roundToCents(52000 / 2080),
      ...buildWageLevels(52000, roundToCents(52000 / 2080)),
      hasDataQualityIssue: true,
      dataQualityNotes: { issues: ['Fixture data quality flag for testing.'] },
    },
    create: {
      datasetVersionId: oflcVersion.id,
      wageYear: DEFAULT_WAGE_YEAR,
      isAcwia: DEFAULT_IS_ACWIA,
      areaCode: '14460',
      socCode: '13-1161',
      l1Annual: 52000,
      l1Hourly: roundToCents(52000 / 2080),
      ...buildWageLevels(52000, roundToCents(52000 / 2080)),
      hasDataQualityIssue: true,
      dataQualityNotes: { issues: ['Fixture data quality flag for testing.'] },
    },
  });

  const onetCodes = ['15-1252.00', '15-1252.01'];

  await prisma.onetSocMap.createMany({
    data: onetCodes.map((onetCode) => ({
      datasetVersionId: onetVersion.id,
      onetCode,
      socCode: '15-1252',
    })),
    skipDuplicates: true,
  });

  const additionalOnetMappings = socFixtures
    .filter((soc) => soc.socCode !== '15-1252')
    .map((soc) => ({
      datasetVersionId: onetVersion.id,
      onetCode: `${soc.socCode}.00`,
      socCode: soc.socCode,
    }));

  await prisma.onetSocMap.createMany({
    data: additionalOnetMappings,
    skipDuplicates: true,
  });

  const dutyFixtures = [
    {
      onetCode: '15-1252.00',
      dutyText: 'Design, develop, and maintain software applications.',
    },
    {
      onetCode: '15-1252.00',
      dutyText: 'Collaborate with product teams to define requirements.',
    },
    {
      onetCode: '15-1252.01',
      dutyText: 'Optimize code for performance and scalability.',
    },
    {
      onetCode: '15-1252.01',
      dutyText: 'Participate in code reviews and mentor peers.',
    },
    {
      onetCode: '13-1161.00',
      dutyText: 'Analyze market conditions and report findings to stakeholders.',
    },
    {
      onetCode: '27-1021.00',
      dutyText: 'Develop design concepts and refine product specifications.',
    },
    {
      onetCode: '27-2012.00',
      dutyText: 'Coordinate production schedules and oversee creative direction.',
    },
    {
      onetCode: '17-2071.00',
      dutyText: 'Design electrical systems and review technical drawings.',
    },
    {
      onetCode: '13-1081.00',
      dutyText: 'Plan and manage logistics operations across supply chains.',
    },
  ];

  await prisma.onetDuty.deleteMany({
    where: {
      datasetVersionId: onetVersion.id,
      onetCode: { in: [...onetCodes, ...additionalOnetMappings.map((entry) => entry.onetCode)] },
    },
  });

  await prisma.onetDuty.createMany({
    data: dutyFixtures.map((duty, index) => ({
      datasetVersionId: onetVersion.id,
      onetCode: duty.onetCode,
      dutyText: duty.dutyText,
      dutyTextNorm: normalize(duty.dutyText),
      sortOrder: index + 1,
    })),
  });

  await prisma.datasetVersion.update({
    where: { id: cbsaVersion.id },
    data: { versionLabel: 'fixtures' },
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
