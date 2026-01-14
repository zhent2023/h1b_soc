import path from 'path';

const DEFAULT_CITY_COUNTY_URL =
  process.env.CITY_COUNTY_CSV_URL ??
  'https://raw.githubusercontent.com/kelvins/US-Cities-Database/master/csv/us_cities.csv';

export function resolveCityCountyCsvUrl(): { url: string; label: string } {
  const url = DEFAULT_CITY_COUNTY_URL;
  const label = path.basename(new URL(url).pathname);
  return { url, label };
}
