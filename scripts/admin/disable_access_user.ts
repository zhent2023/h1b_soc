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
    console.error('Usage: pnpm admin:disable-access-user -- --email someone@example.com');
    process.exitCode = 1;
    return;
  }

  const email = emailRaw.trim().toLowerCase();
  const prisma = new PrismaClient();

  try {
    const existing = await prisma.accessUser.findUnique({ where: { email } });
    if (!existing) {
      console.error(`No access user found for ${email}`);
      process.exitCode = 1;
      return;
    }

    await prisma.accessUser.update({
      where: { email },
      data: { isActive: false },
    });
  } finally {
    await prisma.$disconnect();
  }

  console.log(`Disabled access user ${email}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
