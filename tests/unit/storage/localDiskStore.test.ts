import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createLocalDiskStore } from '../../../src/lib/storage/localDiskStore';

describe('localDiskStore', () => {
  let tempDir = '';
  let storePath = '';

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'h1b-soc-'));
    process.env.LOCAL_STORAGE_DIR = tempDir;
  });

  afterEach(async () => {
    delete process.env.LOCAL_STORAGE_DIR;
    if (storePath) {
      await fs.rm(tempDir, { recursive: true, force: true });
      storePath = '';
    }
  });

  it('writes, reads, and deletes transcript files', async () => {
    const store = createLocalDiskStore();
    const target = await store.createUploadTarget({
      userId: 'user-1',
      transcriptId: 'transcript-1',
      contentType: 'application/pdf',
      maxBytes: 1024,
    });

    storePath = target.storageUrl ?? '';
    const payload = Buffer.from('pdf-data');
    await store.writeObject(storePath, payload);

    const head = await store.headObject(storePath);
    expect(head?.size).toBe(payload.length);

    const read = await store.readObject(storePath);
    expect(read.toString()).toBe('pdf-data');

    await store.deleteObject(storePath);
    const missing = await store.headObject(storePath);
    expect(missing).toBeNull();
  });

  it('ignores delete when file is missing', async () => {
    const store = createLocalDiskStore();
    const target = await store.createUploadTarget({
      userId: 'user-2',
      transcriptId: 'transcript-2',
      contentType: 'application/pdf',
      maxBytes: 1024,
    });
    storePath = target.storageUrl ?? '';
    await expect(store.deleteObject(storePath)).resolves.toBeUndefined();
  });
});
