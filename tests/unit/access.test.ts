import bcrypt from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { AccessError, requireAccess } from '../../src/lib/access';

describe('requireAccess', () => {
  it('allows public mode without credentials', async () => {
    const previousMode = process.env.ACCESS_MODE;
    process.env.ACCESS_MODE = 'public';

    const prisma = {
      session: { findFirst: vi.fn() },
      accessUser: { findFirst: vi.fn() },
    } as unknown as PrismaClient;

    const req = new Request('http://localhost');

    try {
      const context = await requireAccess(req, prisma);
      expect(context.email).toBe('public');
      expect(context.source).toBe('public');
    } finally {
      if (previousMode === undefined) {
        delete process.env.ACCESS_MODE;
      } else {
        process.env.ACCESS_MODE = previousMode;
      }
    }
  });

  it('accepts a valid session cookie', async () => {
    const previousMode = process.env.ACCESS_MODE;
    process.env.ACCESS_MODE = 'invite';

    const sessionFindFirst = vi.fn().mockResolvedValue({
      user: { email: 'session@example.com', isActive: true },
    });
    const accessUserFindFirst = vi.fn();

    const prisma = {
      session: { findFirst: sessionFindFirst },
      accessUser: { findFirst: accessUserFindFirst },
    } as unknown as PrismaClient;

    const req = new Request('http://localhost', {
      headers: { cookie: 'h1b_session=token123' },
    });

    try {
      const context = await requireAccess(req, prisma);
      expect(context.email).toBe('session@example.com');
      expect(context.source).toBe('session');
      expect(accessUserFindFirst).not.toHaveBeenCalled();
    } finally {
      if (previousMode === undefined) {
        delete process.env.ACCESS_MODE;
      } else {
        process.env.ACCESS_MODE = previousMode;
      }
    }
  });

  it('falls back to access headers when no session', async () => {
    const previousMode = process.env.ACCESS_MODE;
    process.env.ACCESS_MODE = 'invite';

    const keyHash = await bcrypt.hash('demo-key', 4);

    const prisma = {
      session: { findFirst: vi.fn().mockResolvedValue(null) },
      accessUser: {
        findFirst: vi.fn().mockResolvedValue({ email: 'demo@example.com', keyHash }),
      },
    } as unknown as PrismaClient;

    const req = new Request('http://localhost', {
      headers: {
        'x-access-email': 'demo@example.com',
        'x-access-key': 'demo-key',
      },
    });

    try {
      const context = await requireAccess(req, prisma);
      expect(context.email).toBe('demo@example.com');
      expect(context.source).toBe('api_key');
    } finally {
      if (previousMode === undefined) {
        delete process.env.ACCESS_MODE;
      } else {
        process.env.ACCESS_MODE = previousMode;
      }
    }
  });

  it('rejects when invite mode and headers are missing', async () => {
    const previousMode = process.env.ACCESS_MODE;
    process.env.ACCESS_MODE = 'invite';

    const prisma = {
      session: { findFirst: vi.fn().mockResolvedValue(null) },
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

  it('rejects when access user is missing', async () => {
    const previousMode = process.env.ACCESS_MODE;
    process.env.ACCESS_MODE = 'invite';

    const prisma = {
      session: { findFirst: vi.fn().mockResolvedValue(null) },
      accessUser: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient;

    const req = new Request('http://localhost', {
      headers: {
        'x-access-email': 'missing@example.com',
        'x-access-key': 'demo-key',
      },
    });

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

  it('rejects when access key does not match', async () => {
    const previousMode = process.env.ACCESS_MODE;
    process.env.ACCESS_MODE = 'invite';

    const keyHash = await bcrypt.hash('correct-key', 4);
    const prisma = {
      session: { findFirst: vi.fn().mockResolvedValue(null) },
      accessUser: { findFirst: vi.fn().mockResolvedValue({ email: 'demo@example.com', keyHash }) },
    } as unknown as PrismaClient;

    const req = new Request('http://localhost', {
      headers: {
        'x-access-email': 'demo@example.com',
        'x-access-key': 'wrong-key',
      },
    });

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
