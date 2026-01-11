import fs from 'fs/promises';
import path from 'path';
import { spawnSync } from 'child_process';

async function writeCsv(filePath: string, content: string) {
  await fs.writeFile(filePath, content, 'utf8');
}

function zipDir(dir: string, outPath: string) {
  const result = spawnSync('zip', ['-r', outPath, '.'], {
    cwd: dir,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error('Failed to create fixture zip (zip command missing?).');
  }
}

async function main() {
  const outDir = process.argv.includes('--outDir')
    ? process.argv[process.argv.indexOf('--outDir') + 1]
    : path.join(process.cwd(), '.cache', 'ingest-fixtures');

  await fs.mkdir(outDir, { recursive: true });

  const oflcDir = path.join(outDir, 'oflc');
  const onetDir = path.join(outDir, 'onet');
  const countyDir = path.join(outDir, 'county');
  await fs.mkdir(oflcDir, { recursive: true });
  await fs.mkdir(onetDir, { recursive: true });
  await fs.mkdir(countyDir, { recursive: true });

  await writeCsv(
    path.join(oflcDir, 'geo.csv'),
    [
      'area_code,area_name,state,county_name',
      '35620,Fixture Area NY,NY,Kings County',
    ].join('\n'),
  );

  await writeCsv(
    path.join(oflcDir, 'wage.csv'),
    [
      'area_code,soc_code,wage_year,is_acwia,l1_annual,l1_hourly,l2_annual,l2_hourly,l3_annual,l3_hourly,l4_annual,l4_hourly',
      '35620,15-1252,2025-2026,false,80000,40,90000,45,100000,50,110000,55',
    ].join('\n'),
  );

  await writeCsv(
    path.join(oflcDir, 'soc.csv'),
    ['soc_code,soc_title', '15-1252,Software Developers'].join('\n'),
  );

  await writeCsv(
    path.join(oflcDir, 'crosswalk.csv'),
    ['soc_code,onet_code', '15-1252,15-1252.00'].join('\n'),
  );

  await writeCsv(
    path.join(onetDir, 'duty.csv'),
    ['onet_soc_code,task', '15-1252.00,Fixture duty text.'].join('\n'),
  );

  await writeCsv(
    path.join(onetDir, 'soc_crosswalk.csv'),
    ['onet_soc_code,soc_code,soc_title', '15-1252.00,15-1252,Software Developers'].join('\n'),
  );

  await writeCsv(
    path.join(countyDir, 'cbsa_county.csv'),
    [
      'cbsa_code,cbsa_name,cbsa_type,county_fips,county_name,state_ab',
      '35620,Fixture CBSA,Metro,36047,Kings County,NY',
    ].join('\n'),
  );

  await writeCsv(
    path.join(countyDir, 'counties.csv'),
    ['county_fips,county_name,state_ab', '36047,Kings County,NY'].join('\n'),
  );

  await writeCsv(
    path.join(countyDir, 'cbsa.csv'),
    ['cbsa_code,cbsa_name,cbsa_type', '35620,Fixture CBSA,Metro'].join('\n'),
  );

  const oflcZip = path.join(outDir, 'oflc_fixture.zip');
  const onetZip = path.join(outDir, 'onet_fixture.zip');
  const countyZip = path.join(outDir, 'county_fixture.zip');

  zipDir(oflcDir, oflcZip);
  zipDir(onetDir, onetZip);
  zipDir(countyDir, countyZip);

  console.log(`FIXTURE oflc=${oflcZip}`);
  console.log(`FIXTURE onet=${onetZip}`);
  console.log(`FIXTURE county=${countyZip}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
