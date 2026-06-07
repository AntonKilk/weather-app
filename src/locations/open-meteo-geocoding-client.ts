// Open-Meteo Geocoding client.
//
// Single typed entrypoint: `searchLocations(query, opts?)`.
//
// Contract (CLAUDE.md › Error handling + Fault Tolerance + story #8 technical
// notes):
//   - Never throws across its boundary. Always resolves to a typed
//     { ok: true | false } Result.
//   - Every fetch has an explicit ~10 s timeout via AbortSignal.timeout.
//   - DOES NOT retry. The autocomplete contract is the opposite of the
//     forecast contract: stale geocoding requests are cancelled by the next
//     keystroke. Retries would race the user.
//   - 2-character minimum query length is enforced here (AC1) — short
//     queries return ok:true with empty results without hitting the network.
//   - Validates the response shape at this API boundary; everything past
//     `GeocodingResponse` is trusted.
//
// Endpoint shape was spike-verified 2026-06-07 (see PRD). Sandbox blocks
// outbound HTTP during implementation — re-verification with `curl` is
// owner-deferred per CLAUDE.md › Validate Before Implementing.
//
// Logging: console.{info,warn,error} at boundaries with the query as context
// (already user-supplied — no PII concern). The UI's status row is the
// user-facing health signal; logs are for the console.

import type {
  GeocodingError,
  GeocodingFetchResult,
  GeocodingResponse,
  GeocodingResult,
} from './types';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const GEOCODING_ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search';

const DEFAULT_TIMEOUT_MS = 10_000;

const DEFAULT_COUNT = 5;

const DEFAULT_LANGUAGE = 'en';

/** Minimum number of (trimmed) characters before we hit the network. AC1. */
const MIN_QUERY_LENGTH = 2;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SearchLocationsOptions {
  /** Caller's abort signal. Combined with the per-request timeout signal. */
  readonly signal?: AbortSignal;
  /** Override the default 10 s timeout. */
  readonly timeoutMs?: number;
  /** Override `globalThis.fetch` — for tests. */
  readonly fetchImpl?: typeof fetch;
  /** Override the default result count (1-100 per Open-Meteo). */
  readonly count?: number;
  /** Override the result language (ISO code). */
  readonly language?: string;
}

/**
 * Search for locations matching the user's query.
 *
 * Returns a typed Result. The function never throws to its caller.
 */
export async function searchLocations(
  query: string,
  opts: SearchLocationsOptions = {},
): Promise<GeocodingFetchResult> {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) {
    // AC1: ≥2 characters. Short queries are NOT an error — they're "no input
    // yet". Returning ok with an empty list lets the controller treat this
    // exactly like a zero-result response (clear suggestions, no fetch).
    return { ok: true, data: { results: [] } };
  }

  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const count = opts.count ?? DEFAULT_COUNT;
  const language = opts.language ?? DEFAULT_LANGUAGE;

  const url = buildGeocodingUrl(trimmed, count, language);
  const ctx = `[geocoding] q="${trimmed}"`;

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combinedSignal = combineSignals(opts.signal, timeoutSignal);

  let response: Response;
  try {
    // eslint-disable-next-line no-console
    console.info(`${ctx} fetch start`);
    response = await fetchImpl(url, { signal: combinedSignal });
  } catch (err: unknown) {
    const classification = classifyFetchError(err, timeoutSignal, opts.signal);

    switch (classification.kind) {
      case 'caller-abort': {
        // eslint-disable-next-line no-console
        console.warn(`${ctx} aborted by caller`);
        return { ok: false, error: { kind: 'aborted' } };
      }
      case 'timeout': {
        // eslint-disable-next-line no-console
        console.warn(`${ctx} timed out after ${timeoutMs}ms`);
        return { ok: false, error: { kind: 'timeout' } };
      }
      case 'network': {
        // eslint-disable-next-line no-console
        console.warn(`${ctx} network error: ${classification.message}`);
        return {
          ok: false,
          error: { kind: 'network', message: classification.message },
        };
      }
    }
  }

  if (!response.ok) {
    // No retries — every non-2xx is final.
    const status = response.status;
    // eslint-disable-next-line no-console
    console.error(`${ctx} HTTP ${status}`);
    const httpError: GeocodingError = {
      kind: 'http',
      status,
      retried: false,
    };
    return { ok: false, error: httpError };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'failed to read response body';
    // eslint-disable-next-line no-console
    console.error(`${ctx} parse error: ${message}`);
    return { ok: false, error: { kind: 'parse', message } };
  }

  const narrowed = narrowGeocodingResponse(payload);
  if (!narrowed.ok) {
    // eslint-disable-next-line no-console
    console.error(`${ctx} response shape rejected: ${narrowed.error.message}`);
    return narrowed;
  }
  // eslint-disable-next-line no-console
  console.info(`${ctx} success — ${narrowed.data.results.length} result(s)`);
  return { ok: true, data: narrowed.data };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildGeocodingUrl(query: string, count: number, language: string): string {
  const params = new URLSearchParams({
    name: query,
    count: String(count),
    language,
    format: 'json',
  });
  return `${GEOCODING_ENDPOINT}?${params.toString()}`;
}

function combineSignals(
  caller: AbortSignal | undefined,
  timeout: AbortSignal,
): AbortSignal {
  if (caller === undefined) {
    return timeout;
  }
  // AbortSignal.any is available on Node ≥ 20.3 and modern browsers
  // (including mobile Safari). Project runtime is Node 22.
  return AbortSignal.any([caller, timeout]);
}

type FetchErrorClassification =
  | { readonly kind: 'timeout' }
  | { readonly kind: 'caller-abort' }
  | { readonly kind: 'network'; readonly message: string };

function classifyFetchError(
  err: unknown,
  timeoutSignal: AbortSignal,
  callerSignal: AbortSignal | undefined,
): FetchErrorClassification {
  // The timeout fired.
  if (timeoutSignal.aborted) {
    return { kind: 'timeout' };
  }

  // The caller cancelled.
  if (callerSignal?.aborted === true) {
    return { kind: 'caller-abort' };
  }

  if (err instanceof DOMException && err.name === 'AbortError') {
    // Aborted but neither signal reports it — treat as caller abort
    // (safer than treating as a transient network failure).
    return { kind: 'caller-abort' };
  }

  const message = err instanceof Error ? err.message : String(err);
  return { kind: 'network', message };
}

// ---------------------------------------------------------------------------
// Boundary validation
// ---------------------------------------------------------------------------

type ParseFailure = Extract<GeocodingError, { kind: 'parse' }>;

type NarrowResult =
  | { readonly ok: true; readonly data: GeocodingResponse }
  | { readonly ok: false; readonly error: ParseFailure };

function narrowGeocodingResponse(value: unknown): NarrowResult {
  if (!isPlainObject(value)) {
    return parseError('response is not a JSON object');
  }

  // Empty match case — Open-Meteo omits the `results` key entirely. This is
  // success with zero results, not an error.
  if (!('results' in value) || value.results === undefined) {
    return { ok: true, data: { results: [] } };
  }

  const rawResults = value.results;
  if (!Array.isArray(rawResults)) {
    return parseError('`results` must be an array');
  }

  const narrowed: GeocodingResult[] = [];
  for (let i = 0; i < rawResults.length; i += 1) {
    const row = rawResults[i];
    if (!isPlainObject(row)) {
      return parseError(`results[${i}] is not an object`);
    }
    if (!isStringProp(row, 'name')) {
      return parseError(`results[${i}].name must be a string`);
    }
    if (!isFiniteNumberProp(row, 'latitude')) {
      return parseError(`results[${i}].latitude must be a finite number`);
    }
    if (!isFiniteNumberProp(row, 'longitude')) {
      return parseError(`results[${i}].longitude must be a finite number`);
    }
    narrowed.push(toGeocodingResult(row));
  }

  return { ok: true, data: { results: narrowed } };
}

function toGeocodingResult(row: Record<string, unknown>): GeocodingResult {
  // Required fields (validated above).
  const out: {
    -readonly [K in keyof GeocodingResult]: GeocodingResult[K];
  } = {
    name: row.name as string,
    latitude: row.latitude as number,
    longitude: row.longitude as number,
  };

  // Optional fields — copy only if the right type so we never widen the API
  // surface with nonsense values.
  if (typeof row.id === 'number' && Number.isFinite(row.id)) out.id = row.id;
  if (typeof row.country === 'string') out.country = row.country;
  if (typeof row.country_code === 'string') out.country_code = row.country_code;
  if (typeof row.admin1 === 'string') out.admin1 = row.admin1;
  if (typeof row.admin2 === 'string') out.admin2 = row.admin2;
  if (typeof row.population === 'number' && Number.isFinite(row.population)) {
    out.population = row.population;
  }
  if (typeof row.feature_code === 'string') out.feature_code = row.feature_code;
  if (typeof row.timezone === 'string') out.timezone = row.timezone;
  if (typeof row.elevation === 'number' && Number.isFinite(row.elevation)) {
    out.elevation = row.elevation;
  }

  return out;
}

function parseError(message: string): NarrowResult {
  return { ok: false, error: { kind: 'parse', message } };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumberProp(obj: Record<string, unknown>, key: string): boolean {
  const v = obj[key];
  return typeof v === 'number' && Number.isFinite(v);
}

function isStringProp(obj: Record<string, unknown>, key: string): boolean {
  return typeof obj[key] === 'string';
}

// Exported for tests only — not part of the public surface.
export const __internals = {
  buildGeocodingUrl,
  narrowGeocodingResponse,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_COUNT,
  DEFAULT_LANGUAGE,
  MIN_QUERY_LENGTH,
  GEOCODING_ENDPOINT,
};
