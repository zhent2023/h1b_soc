import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';

import unzipper from 'unzipper';
import { parse } from 'csv-parse';

export async function resolveZipPath(params: { zipPath?: string; zipUrl?: string }) {
  const { zipPath, zipUrl } = params;
  if (zipPath) {
    return zipPath;
  }
  if (!zipUrl) {
    throw new Error('Provide either --zipPath or --zipUrl.');
  }

  const res = await fetch(zipUrl);
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download zip: ${res.status}`);
  }

  const filename = path.join(
    '/tmp',
    `ingest_${Date.now()}_${Math.random().toString(36).slice(2)}.zip`,
  );
  await pipeline(res.body, fs.createWriteStream(filename));
  return filename;
}

export async function openZip(zipPath: string) {
  return unzipper.Open.file(zipPath);
}

export function normalizeKey(key: string) {
  return key.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function getField(record: Record<string, string>, keys: string[]): string | undefined {
  const keyMap = Object.fromEntries(
    Object.keys(record).map((key) => [normalizeKey(key), record[key]]),
  );
  for (const candidate of keys) {
    const normalized = normalizeKey(candidate);
    const value = keyMap[normalized];
    if (value !== undefined && value !== '') {
      return value.trim();
    }
  }
  return undefined;
}

export async function parseCsvStream(params: {
  stream: NodeJS.ReadableStream;
  onRow: (row: Record<string, string>) => Promise<void> | void;
  delimiter?: string;
}) {
  const parser = parse({
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    delimiter: params.delimiter ?? ',',
    trim: true,
  });

  params.stream.pipe(parser);
  for await (const record of parser) {
    await params.onRow(record as Record<string, string>);
  }
}

export function inferDelimiter(name: string) {
  if (name.toLowerCase().endsWith('.tsv')) {
    return '\t';
  }
  return ',';
}
