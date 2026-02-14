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
    console.error('Usage: pnpm admin:add-user -- --email someone@example.com --password TempPass123!');
    process.exitCode = 1;
    return;
  }

  const email = emailRaw.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(passwordRaw, 12);

  const prisma = new PrismaClient();
  try {
    await prisma.user.upsert({
      where: { email },
      update: { passwordHash, isActive: true },
      create: { email, passwordHash, isActive: true },
    });
  } finally {
    await prisma.$disconnect();
  }

  console.log(`User updated: ${email}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
