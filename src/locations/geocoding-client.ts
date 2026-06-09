import type { GeocodingPlace } from './types';

// Typed client for Open-Meteo's /v1/search (geocoding) endpoint.
//
// Differs from `src/weather/open-meteo-client.ts` on purpose:
// - NO retries (per issue #8 Technical Notes: staleness is solved by
//   cancellation on next keystroke, not by retry).
// - Accepts an external `AbortSignal` so the caller can cancel an in-flight
//   request on each keystroke; the classifier distinguishes external aborts
//   from `AbortSignal.timeout` so the UI can silently discard the former.
// - Empty `results` (or a missing `results` key — what the API returns when
//   nothing matches) is a SUCCESS (`{ ok: true, data: [] }`), not a parse error.

export interface GeocodingDeps {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export type GeocodingError =
  | { kind: 'network'; message: string }
  | { kind: 'timeout'; message: string }
  | { kind: 'aborted'; message: string }
  | { kind: 'server'; status: number; message: string }
  | { kind: 'client'; status: number; message: string }
  | { kind: 'parse'; message: string };

export type GeocodingResult =
  | { ok: true; data: GeocodingPlace[] }
  | { ok: false; error: GeocodingError };

export const DEFAULT_GEOCODING_TIMEOUT_MS = 10_000;
export const DEFAULT_GEOCODING_COUNT = 5;
export const OPEN_METEO_GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
export const MIN_QUERY_LENGTH = 2;

export function buildGeocodingUrl(name: string, count: number = DEFAULT_GEOCODING_COUNT): string {
  const params = new URLSearchParams({
    name,
    count: String(count),
    language: 'en',
  });
  return `${OPEN_METEO_GEOCODING_URL}?${params.toString()}`;
}

export async function searchGeocoding(
  query: string,
  deps: GeocodingDeps = {},
): Promise<GeocodingResult> {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) {
    return { ok: true, data: [] };
  }

  const fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = deps.timeoutMs ?? DEFAULT_GEOCODING_TIMEOUT_MS;
  const externalSignal = deps.signal;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal =
    externalSignal !== undefined
      ? AbortSignal.any([externalSignal, timeoutSignal])
      : timeoutSignal;
  const url = buildGeocodingUrl(trimmed);

  try {
    const response = await fetchImpl(url, { signal });
    if (response.status >= 500 && response.status < 600) {
      return {
        ok: false,
        error: { kind: 'server', status: response.status, message: `HTTP ${response.status}` },
      };
    }
    if (response.status >= 400 && response.status < 500) {
      return {
        ok: false,
        error: { kind: 'client', status: response.status, message: `HTTP ${response.status}` },
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        error: { kind: 'server', status: response.status, message: `HTTP ${response.status}` },
      };
    }
    const json = (await response.json()) as unknown;
    return parseGeocoding(json);
  } catch (err) {
    return { ok: false, error: classifyThrown(err, externalSignal) };
  }
}

function classifyThrown(err: unknown, externalSignal: AbortSignal | undefined): GeocodingError {
  // External abort takes precedence — both abort sources surface as a
  // DOMException at the fetch boundary, but only the external case must be
  // silently dropped by the UI.
  if (externalSignal?.aborted === true) {
    return { kind: 'aborted', message: 'request cancelled' };
  }
  if (err instanceof DOMException && err.name === 'TimeoutError') {
    return { kind: 'timeout', message: 'request timed out' };
  }
  if (err instanceof DOMException && err.name === 'AbortError') {
    return { kind: 'aborted', message: 'request aborted' };
  }
  if (err instanceof Error) {
    return { kind: 'network', message: err.message };
  }
  return { kind: 'network', message: 'unknown network error' };
}

// --- Boundary parser --------------------------------------------------------
// Narrows `unknown` → `GeocodingPlace[]`. Everything past this point is
// trusted domain code (CLAUDE.md › Types).

export function parseGeocoding(raw: unknown): GeocodingResult {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: { kind: 'parse', message: 'response is not an object' } };
  }
  const r = raw as Record<string, unknown>;
  // The API omits `results` entirely when there are no hits — that is the
  // "no matches" contract, not a parse error.
  if (r.results === undefined) {
    return { ok: true, data: [] };
  }
  if (!Array.isArray(r.results)) {
    return { ok: false, error: { kind: 'parse', message: 'results is not an array' } };
  }
  const places: GeocodingPlace[] = [];
  for (let i = 0; i < r.results.length && places.length < DEFAULT_GEOCODING_COUNT; i++) {
    const parsed = parsePlace(r.results[i], i);
    if (!parsed.ok) return parsed;
    places.push(parsed.data);
  }
  return { ok: true, data: places };
}

function parsePlace(
  raw: unknown,
  index: number,
): { ok: true; data: GeocodingPlace } | { ok: false; error: GeocodingError } {
  if (typeof raw !== 'object' || raw === null) {
    return {
      ok: false,
      error: { kind: 'parse', message: `result ${index} is not an object` },
    };
  }
  const e = raw as Record<string, unknown>;
  if (typeof e.name !== 'string' || e.name.trim() === '') {
    return {
      ok: false,
      error: { kind: 'parse', message: `result ${index}: name is missing or empty` },
    };
  }
  if (
    typeof e.latitude !== 'number' ||
    !Number.isFinite(e.latitude) ||
    e.latitude < -90 ||
    e.latitude > 90
  ) {
    return {
      ok: false,
      error: { kind: 'parse', message: `result ${index}: latitude is missing or out of range` },
    };
  }
  if (
    typeof e.longitude !== 'number' ||
    !Number.isFinite(e.longitude) ||
    e.longitude < -180 ||
    e.longitude > 180
  ) {
    return {
      ok: false,
      error: { kind: 'parse', message: `result ${index}: longitude is missing or out of range` },
    };
  }
  const place: GeocodingPlace = {
    name: e.name.trim(),
    latitude: e.latitude,
    longitude: e.longitude,
  };
  if (typeof e.country === 'string' && e.country.trim() !== '') {
    place.country = e.country.trim();
  }
  if (typeof e.admin1 === 'string' && e.admin1.trim() !== '') {
    place.admin1 = e.admin1.trim();
  }
  return { ok: true, data: place };
}
