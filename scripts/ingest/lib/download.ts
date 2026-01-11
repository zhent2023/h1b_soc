import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { ReadableStream as WebReadableStream } from 'stream/web';
import { pipeline } from 'stream/promises';
import { createHash } from 'crypto';

export async function downloadToCache(url: string, cacheDir: string): Promise<{
  path: string;
  hit: boolean;
}> {
  await fs.promises.mkdir(cacheDir, { recursive: true });
  const parsed = new URL(url);
  const ext = path.extname(parsed.pathname) || '.zip';
  const hash = createHash('sha256').update(url).digest('hex').slice(0, 16);
  const filename = `${hash}${ext}`;
  const dest = path.join(cacheDir, filename);

  if (fs.existsSync(dest)) {
    console.log(`DOWNLOAD status=hit url=${url} path=${dest}`);
    return { path: dest, hit: true };
  }

  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`DOWNLOAD_FAILED status=${res.status} url=${url}`);
  }

  const bodyStream = Readable.fromWeb(res.body as unknown as WebReadableStream);
  await pipeline(bodyStream, fs.createWriteStream(dest));
  console.log(`DOWNLOAD status=download url=${url} path=${dest}`);
  return { path: dest, hit: false };
}
