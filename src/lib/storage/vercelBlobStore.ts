import { del, head } from '@vercel/blob';
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';

import type { StorageProvider, StorageUploadTarget, StorageObjectInfo } from './types';

function assertToken(): string {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error('Missing BLOB_READ_WRITE_TOKEN for Vercel Blob uploads.');
  }
  return token;
}

function buildPathname(params: { userId: string; transcriptId: string }) {
  return `transcripts/${params.userId}/${params.transcriptId}.pdf`;
}

export function createVercelBlobStore(): StorageProvider {
  return {
    providerId: 'vercel_blob',
    async createUploadTarget(params): Promise<StorageUploadTarget> {
      const token = assertToken();
      const pathname = buildPathname(params);
      const clientToken = await generateClientTokenFromReadWriteToken({
        token,
        pathname,
        allowedContentTypes: [params.contentType],
        maximumSizeInBytes: params.maxBytes,
        addRandomSuffix: true,
      });

      return {
        provider: 'vercel_blob',
        method: 'PUT',
        clientToken,
        pathname,
        maxBytes: params.maxBytes,
      };
    },
    async readObject(storageUrl: string): Promise<Buffer> {
      const res = await fetch(storageUrl);
      if (!res.ok) {
        throw new Error(`Failed to fetch blob: ${res.status}`);
      }
      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer);
    },
    async deleteObject(storageUrl: string): Promise<void> {
      await del(storageUrl);
    },
    async headObject(storageUrl: string): Promise<StorageObjectInfo | null> {
      const meta = await head(storageUrl);
      return { size: meta.size, contentType: meta.contentType };
    },
  };
}
