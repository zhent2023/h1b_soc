import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createLocalDiskStore: vi.fn(() => ({ providerId: 'local' })),
  createVercelBlobStore: vi.fn(() => ({ providerId: 'vercel_blob' })),
}));

vi.mock('../../../src/lib/storage/localDiskStore', () => ({
  createLocalDiskStore: mocks.createLocalDiskStore,
}));

vi.mock('../../../src/lib/storage/vercelBlobStore', () => ({
  createVercelBlobStore: mocks.createVercelBlobStore,
}));

import { createStorageProviderFromEnv } from '../../../src/lib/storage';

describe('createStorageProviderFromEnv', () => {
  it('returns local provider when STORAGE_PROVIDER=local', () => {
    process.env.STORAGE_PROVIDER = 'local';
    const provider = createStorageProviderFromEnv();
    expect(provider.providerId).toBe('local');
  });

  it('defaults to vercel blob provider', () => {
    delete process.env.STORAGE_PROVIDER;
    const provider = createStorageProviderFromEnv();
    expect(provider.providerId).toBe('vercel_blob');
  });
});
