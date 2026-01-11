import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { AccessError, requireAccess } from '../../src/lib/access';

describe('requireAccess', () => {
  it('rejects when invite mode and headers are missing', async () => {
    const previousMode = process.env.ACCESS_MODE;
    process.env.ACCESS_MODE = 'invite';

    const prisma = {
      accessUser: {
        findFirst: vi.fn(),
      },
    } as unknown as PrismaClient;

    const req = new Request('http://localhost');

    try {
      await expect(requireAccess(req, prisma)).rejects.toBeInstanceOf(AccessError);
    } finally {
      if (previousMode === undefined) {
        delete process.env.ACCESS_MODE;
      } else {
        process.env.ACCESS_MODE = previousMode;
      }
    }
  });
});
