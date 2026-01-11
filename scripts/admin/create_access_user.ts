import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

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
    console.error('Usage: pnpm admin:add-access-user -- --email someone@example.com');
    process.exitCode = 1;
    return;
  }

  const email = emailRaw.trim().toLowerCase();
  const accessKey = crypto.randomBytes(24).toString('base64url');
  const keyHash = await bcrypt.hash(accessKey, 10);

  const prisma = new PrismaClient();
  try {
    await prisma.accessUser.upsert({
      where: { email },
      update: { keyHash, isActive: true },
      create: { email, keyHash, isActive: true },
    });
  } finally {
    await prisma.$disconnect();
  }

  console.log(`Access key for ${email}: ${accessKey}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
