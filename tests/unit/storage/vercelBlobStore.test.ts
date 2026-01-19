import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  del: vi.fn(),
  head: vi.fn(),
  generateClientTokenFromReadWriteToken: vi.fn(),
}));

vi.mock('@vercel/blob', () => ({
  del: mocks.del,
  head: mocks.head,
}));

vi.mock('@vercel/blob/client', () => ({
  generateClientTokenFromReadWriteToken: mocks.generateClientTokenFromReadWriteToken,
}));

import { createVercelBlobStore } from '../../../src/lib/storage/vercelBlobStore';

describe('vercelBlobStore', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mocks.del.mockReset();
    mocks.head.mockReset();
    mocks.generateClientTokenFromReadWriteToken.mockReset();
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    globalThis.fetch = originalFetch;
  });

  it('throws without BLOB_READ_WRITE_TOKEN', async () => {
    const store = createVercelBlobStore();
    await expect(
      store.createUploadTarget({
        userId: 'user-1',
        transcriptId: 'transcript-1',
        contentType: 'application/pdf',
        maxBytes: 100,
      }),
    ).rejects.toThrow('Missing BLOB_READ_WRITE_TOKEN');
  });

  it('creates upload targets and reads blobs', async () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'token';
    mocks.generateClientTokenFromReadWriteToken.mockResolvedValue('client-token');
    mocks.head.mockResolvedValue({ size: 10, contentType: 'application/pdf' });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });

    const store = createVercelBlobStore();
    const target = await store.createUploadTarget({
      userId: 'user-1',
      transcriptId: 'transcript-1',
      contentType: 'application/pdf',
      maxBytes: 100,
    });

    expect(target.provider).toBe('vercel_blob');
    expect(target.clientToken).toBe('client-token');
    expect(target.pathname).toContain('transcripts/user-1/transcript-1.pdf');

    const head = await store.headObject('https://example.com/file.pdf');
    expect(head?.size).toBe(10);

    const buffer = await store.readObject('https://example.com/file.pdf');
    expect(buffer.length).toBe(3);

    await store.deleteObject('https://example.com/file.pdf');
    expect(mocks.del).toHaveBeenCalledTimes(1);
  });
});
