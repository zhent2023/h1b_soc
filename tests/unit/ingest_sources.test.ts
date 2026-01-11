import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

import { parseOflcDownloadPage } from '../../scripts/ingest/sources/oflc';
import { parseOnetDbPage } from '../../scripts/ingest/sources/onet';
import { parseCountyGazetteerPage } from '../../scripts/ingest/sources/county_gazetteer';

const fixturesDir = path.join(__dirname, '..', 'fixtures', 'ingest');

describe('ingest source parsers', () => {
  it('parses OFLC wage zip link for a given wage year', () => {
    const html = fs.readFileSync(path.join(fixturesDir, 'oflc_download.html'), 'utf8');
    const url = parseOflcDownloadPage(html, '2025-2026', 'https://example.com/');
    expect(url).toContain('2025-2026');
    expect(url).toContain('.zip');
  });

  it('parses O*NET db text zip link and version label', () => {
    const html = fs.readFileSync(path.join(fixturesDir, 'onet_download.html'), 'utf8');
    const resolved = parseOnetDbPage(html, 'https://www.onetcenter.org/database.html');
    expect(resolved).not.toBeNull();
    expect(resolved?.versionLabel).toBe('30.1');
    expect(resolved?.url).toContain('db_30_1_text.zip');
  });

  it('parses latest county gazetteer zip link', () => {
    const html = fs.readFileSync(
      path.join(fixturesDir, 'county_gazetteer.html'),
      'utf8',
    );
    const resolved = parseCountyGazetteerPage(html, 'https://www.census.gov/');
    expect(resolved).not.toBeNull();
    expect(resolved?.label).toBe('2023');
    expect(resolved?.url).toContain('2023_Gaz_counties_national.zip');
  });
});
