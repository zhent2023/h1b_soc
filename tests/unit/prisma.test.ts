import { describe, expect, it, beforeEach, vi } from 'vitest';

vi.mock('@prisma/client', () => {
  return {
    PrismaClient: vi.fn().mockImplementation(() => ({ __prisma: true })),
  };
});

import { PrismaClient } from '@prisma/client';
import { getPrisma } from '../../src/db/prisma';

describe('getPrisma', () => {
  beforeEach(() => {
    (globalThis as { prisma?: unknown }).prisma = undefined;
    (PrismaClient as unknown as { mockClear: () => void }).mockClear();
  });

  it('returns a singleton prisma client', () => {
    const first = getPrisma();
    const second = getPrisma();

    expect(first).toBe(second);
    expect(PrismaClient).toHaveBeenCalledTimes(1);
  });
});
