import { PrismaClient } from '@prisma/client';

import { ensurePrismaEngineStartupLogs } from '../../src/db/prismaEnv';

ensurePrismaEngineStartupLogs();

function getArgValue(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1]) {
    return process.argv[idx + 1];
  }
  const prefix = `${flag}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  if (found) {
    return found.slice(prefix.length);
  }
  return null;
}

async function main() {
  const emailRaw = getArgValue('--email');
  if (!emailRaw) {
    console.error('Usage: pnpm admin:disable-user -- --email someone@example.com');
    process.exitCode = 1;
    return;
  }

  const email = emailRaw.trim().toLowerCase();
  const prisma = new PrismaClient();

  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (!existing) {
      console.error(`No user found for ${email}`);
      process.exitCode = 1;
      return;
    }

    await prisma.user.update({
      where: { email },
      data: { isActive: false },
    });

    await prisma.session.deleteMany({
      where: { userId: existing.id },
    });
  } finally {
    await prisma.$disconnect();
  }

  console.log(`Disabled user ${email}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
