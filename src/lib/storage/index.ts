import { createLocalDiskStore } from './localDiskStore';
import { createVercelBlobStore } from './vercelBlobStore';
import type { StorageProvider } from './types';

export function createStorageProviderFromEnv(): StorageProvider {
  const providerName = (process.env.STORAGE_PROVIDER ?? 'vercel_blob').trim();
  if (providerName === 'local') {
    return createLocalDiskStore();
  }
  return createVercelBlobStore();
}
