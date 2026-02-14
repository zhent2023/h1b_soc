import bcrypt from 'bcryptjs';
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
  const passwordRaw = getArgValue('--password');

  if (!emailRaw || !passwordRaw) {
    console.error(
      'Usage: pnpm admin:reset-password -- --email someone@example.com --password NewPass456!',
    );
    process.exitCode = 1;
    return;
  }

  const email = emailRaw.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(passwordRaw, 12);

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
      data: { passwordHash },
    });
  } finally {
    await prisma.$disconnect();
  }

  console.log(`Password updated for ${email}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
