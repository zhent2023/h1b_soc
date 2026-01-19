export type StorageProviderId = 'vercel_blob' | 'local';

export type StorageUploadTarget = {
  provider: StorageProviderId;
  method: 'PUT' | 'POST';
  uploadUrl?: string;
  clientToken?: string;
  pathname?: string;
  headers?: Record<string, string>;
  maxBytes: number;
  storageUrl?: string | null;
};

export type StorageObjectInfo = {
  size: number;
  contentType?: string;
};

export interface StorageProvider {
  providerId: StorageProviderId;
  createUploadTarget(params: {
    userId: string;
    transcriptId: string;
    contentType: string;
    maxBytes: number;
  }): Promise<StorageUploadTarget>;
  readObject(storageUrl: string): Promise<Buffer>;
  deleteObject(storageUrl: string): Promise<void>;
  headObject(storageUrl: string): Promise<StorageObjectInfo | null>;
  writeObject?: (storageUrl: string, data: Buffer) => Promise<void>;
}
