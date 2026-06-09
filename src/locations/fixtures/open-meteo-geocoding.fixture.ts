import type { GeocodingPlace } from '../types';

// Recorded-shape sample of an Open-Meteo /v1/search (geocoding) response.
//
// Sandbox-blocked check (CLAUDE.md → defer-and-record): the live `curl` to
// geocoding-api.open-meteo.com from this sandbox returns "Host not in
// allowlist". This fixture mirrors the shape that the PRD spike (2026-06-07)
// recorded for the same endpoint, populated with Helsinki (the city Open-Meteo
// itself uses as a public docs example). The four CLAUDE.md private cities
// MUST NOT appear here.
//
// The `JSON.parse(JSON.stringify(...))` round-trip strips TS types so the
// raw constants present as true `unknown` to the parser tests — matching the
// shape that `fetch(...).json()` returns at runtime.

export const SAMPLE_HITS_RAW: unknown = JSON.parse(
  JSON.stringify({
    results: [
      {
        id: 658225,
        name: 'Helsinki',
        latitude: 60.16952,
        longitude: 24.93545,
        elevation: 28.0,
        feature_code: 'PPLC',
        country_code: 'FI',
        timezone: 'Europe/Helsinki',
        population: 558457,
        country_id: 660013,
        country: 'Finland',
        admin1: 'Uusimaa',
      },
      {
        id: 4990729,
        name: 'Helsinki',
        latitude: 46.16689,
        longitude: -87.30872,
        elevation: 264.0,
        feature_code: 'PPL',
        country_code: 'US',
        timezone: 'America/Detroit',
        country_id: 6252001,
        country: 'United States',
        admin1: 'Michigan',
        admin2: 'Houghton County',
      },
    ],
    generationtime_ms: 0.81,
  }),
);

export const SAMPLE_HITS_PARSED: GeocodingPlace[] = [
  {
    name: 'Helsinki',
    latitude: 60.16952,
    longitude: 24.93545,
    country: 'Finland',
    admin1: 'Uusimaa',
  },
  {
    name: 'Helsinki',
    latitude: 46.16689,
    longitude: -87.30872,
    country: 'United States',
    admin1: 'Michigan',
  },
] satisfies GeocodingPlace[];

// No-results shape: the API returns `generationtime_ms` only (no `results`
// key). The parser MUST treat this as `{ ok: true, data: [] }`, not a parse
// error (issue #8 AC3).
export const SAMPLE_NO_RESULTS_RAW: unknown = JSON.parse(
  JSON.stringify({ generationtime_ms: 0.42 }),
);
