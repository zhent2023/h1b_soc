import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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

async function main() {
  const latestLabelArg = getArgValue('--latestLabel');
  const url = getArgValue('--url');
  const patternRaw = getArgValue('--pattern');

  const active = await prisma.datasetVersion.findFirst({
    where: { datasetName: 'oflc', isActive: true },
    select: { versionLabel: true },
  });

  if (!active) {
    throw new Error('No active OFLC dataset version found.');
  }

  let latestLabel = latestLabelArg;

  if (!latestLabel && url) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Failed to fetch ${url}: ${res.status}`);
      }
      const text = await res.text();
      const pattern = patternRaw
        ? new RegExp(patternRaw, 'i')
        : /([0-9]{4}-[0-9]{4})/;
      const match = text.match(pattern);
      if (match) {
        latestLabel = match[1] ?? match[0];
      }
    } catch (error) {
      console.error('Unable to reach upstream source.');
      console.error(
        'Run this script with --latestLabel after checking the OFLC release page manually.',
      );
      throw error;
    }
  }

  if (!latestLabel) {
    console.log('Active OFLC versionLabel:', active.versionLabel);
    console.log(
      'Provide --latestLabel or --url/--pattern after checking the OFLC release page manually.',
    );
    return;
  }

  const isFresh = latestLabel === active.versionLabel;
  console.log('Active OFLC versionLabel:', active.versionLabel);
  console.log('Latest upstream label:', latestLabel);
  console.log(isFresh ? 'Status: up-to-date' : 'Status: stale');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
