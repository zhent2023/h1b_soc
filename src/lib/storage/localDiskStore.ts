import fs from 'fs/promises';
import path from 'path';

import type { StorageProvider, StorageUploadTarget, StorageObjectInfo } from './types';

function resolveBaseDir(): string {
  const raw = process.env.LOCAL_STORAGE_DIR ?? './.local/transcripts';
  return path.resolve(process.cwd(), raw);
}

function buildFilePath(params: { userId: string; transcriptId: string }) {
  return path.join(resolveBaseDir(), params.userId, `${params.transcriptId}.pdf`);
}

async function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
}

export function createLocalDiskStore(): StorageProvider {
  return {
    providerId: 'local',
    async createUploadTarget(params): Promise<StorageUploadTarget> {
      const storageUrl = buildFilePath(params);
      await ensureDir(storageUrl);
      return {
        provider: 'local',
        method: 'PUT',
        uploadUrl: `/api/v1/transcripts/${params.transcriptId}/upload`,
        headers: { 'Content-Type': params.contentType },
        maxBytes: params.maxBytes,
        storageUrl,
      };
    },
    async readObject(storageUrl: string): Promise<Buffer> {
      return fs.readFile(storageUrl);
    },
    async deleteObject(storageUrl: string): Promise<void> {
      try {
        await fs.unlink(storageUrl);
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err.code !== 'ENOENT') {
          throw error;
        }
      }
    },
    async headObject(storageUrl: string): Promise<StorageObjectInfo | null> {
      try {
        const stats = await fs.stat(storageUrl);
        return { size: stats.size, contentType: 'application/pdf' };
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err.code === 'ENOENT') {
          return null;
        }
        throw error;
      }
    },
    async writeObject(storageUrl: string, data: Buffer): Promise<void> {
      await ensureDir(storageUrl);
      await fs.writeFile(storageUrl, data);
    },
  };
}
