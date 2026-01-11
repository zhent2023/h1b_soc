import { PrismaClient } from '@prisma/client';

import type { AcceptanceContext } from './types';
import { runCommand } from './utils';

export const name = 'A data ingest';

export async function run(ctx: AcceptanceContext): Promise<void> {
  const baseArgs: string[] = ['pnpm ingest:all', '--', '--wageYear', ctx.wageYear, '--activate'];

  let oflcZip = process.env.OFLC_ZIP_PATH;
  let onetZip = process.env.ONET_ZIP_PATH;
  let countyZip = process.env.COUNTY_ZIP_PATH;
  const cacheDir = process.env.INGEST_CACHE_DIR;
  const useFixtures = process.env.USE_INGEST_FIXTURES === 'true';

  const buildArgs = () => {
    const args = [...baseArgs];
    if (oflcZip) {
      args.push('--oflcZipPath', oflcZip);
    }
    if (onetZip) {
      args.push('--onetZipPath', onetZip);
    }
    if (countyZip) {
      args.push('--countyZipPath', countyZip);
    }
    if (cacheDir) {
      args.push('--cacheDir', cacheDir);
    }
    return args;
  };

  const buildFixtures = async () => {
    const { stdout } = await runCommand(
      'pnpm exec tsx scripts/testdata/build_ingest_fixtures.ts',
      { tee: true },
    );
    const fixtureRegex = /^FIXTURE\s+(oflc|onet|county)=(.+)$/gm;
    let match: RegExpExecArray | null = null;
    while ((match = fixtureRegex.exec(stdout)) !== null) {
      if (match[1] === 'oflc') oflcZip = match[2];
      if (match[1] === 'onet') onetZip = match[2];
      if (match[1] === 'county') countyZip = match[2];
    }
    if (!oflcZip || !onetZip || !countyZip) {
      throw new Error('Failed to resolve fixture zip paths.');
    }
  };

  let stdout = '';
  const runIngest = async () => {
    const command = buildArgs().join(' ');
    const result = await runCommand(command, { tee: true });
    stdout = result.stdout;
  };

  if (useFixtures) {
    await buildFixtures();
    await runIngest();
  } else {
    try {
      await runIngest();
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      const hintByDataset = [
        { key: 'OFLC', hint: '--oflcZipPath' },
        { key: 'O*NET', hint: '--onetZipPath' },
        { key: 'Census', hint: '--countyZipPath' },
        { key: 'gazetteer', hint: '--countyZipPath' },
      ];
      const matchedHints = hintByDataset
        .filter((entry) => errorText.includes(entry.key))
        .map((entry) => entry.hint);
      const hasHint =
        matchedHints.some((hint) => errorText.includes(hint)) ||
        ['--oflcZipPath', '--onetZipPath', '--countyZipPath'].some((hint) =>
          errorText.includes(hint),
        );

      if (!hasHint) {
        throw new Error('Download failure did not provide offline zipPath hint.');
      }

      if (oflcZip || onetZip || countyZip) {
        throw error;
      }

      await buildFixtures();
      await runIngest();
    }
  }

  const segmentRegex = /^INGEST\s+(oflc|onet|county)\s+(start|done)\b/gm;
  const segments: Record<string, { start: boolean; done: boolean }> = {
    oflc: { start: false, done: false },
    onet: { start: false, done: false },
    county: { start: false, done: false },
  };

  let segMatch: RegExpExecArray | null = null;
  while ((segMatch = segmentRegex.exec(stdout)) !== null) {
    const name = segMatch[1];
    const phase = segMatch[2] as 'start' | 'done';
    segments[name][phase] = true;
  }

  Object.entries(segments).forEach(([key, value]) => {
    if (!value.start || !value.done) {
      throw new Error(`Missing ingest segment logs for ${key}.`);
    }
  });

  const summaryRegex =
    /^SUMMARY\s+(oflc|onet|county)\s+versionId=([^\s]+)\s+label=([^\s]+)\s+active=(true|false)$/gm;
  const summaries: Record<string, { id: string; label: string; active: boolean }> = {};

  let match: RegExpExecArray | null = null;
  while ((match = summaryRegex.exec(stdout)) !== null) {
    summaries[match[1]] = {
      id: match[2],
      label: match[3],
      active: match[4] === 'true',
    };
  }

  ['oflc', 'onet', 'county'].forEach((key) => {
    if (!summaries[key]) {
      throw new Error(`Missing SUMMARY line for ${key}.`);
    }
    if (!summaries[key].active) {
      throw new Error(`Expected ${key} to be active after ingest.`);
    }
  });


  const prisma = new PrismaClient();
  try {
    const active = await prisma.datasetVersion.findMany({
      where: { isActive: true },
      select: { datasetName: true, versionLabel: true },
    });

    const byName = Object.fromEntries(
      active.map((entry) => [entry.datasetName, entry.versionLabel]),
    );

    if (!byName.oflc || !byName.onet || !byName.cbsa) {
      throw new Error('Active dataset versions missing after ingest.');
    }
  } finally {
    await prisma.$disconnect();
  }
}
