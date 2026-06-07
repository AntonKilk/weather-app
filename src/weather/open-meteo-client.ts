// Open-Meteo forecast client.
//
// Single typed entrypoint: `fetchForecast(coords, opts?)`.
//
// Contract (CLAUDE.md › Error handling + Fault Tolerance):
//   - Never throws across its boundary. Always resolves to a typed
//     { ok: true | false } Result.
//   - Every fetch has an explicit ~10 s timeout via AbortSignal.timeout.
//   - Retries transient failures (network errors, 5xx) with exponential
//     backoff 2 s → 4 s → 8 s, max 3 ATTEMPTS total. 4xx is never retried.
//   - Validates the response shape at this API boundary; everything past
//     `ForecastResponse` is trusted.
//   - Per-slot isolation is the caller's job (Promise.allSettled). This module
//     only guarantees that one call's failure is contained in its Result.
//
// Logging: console.{info,warn,error} at boundaries with the (lat, lon)
// context — no PII. The "last updated" stamp in the UI is the user-facing
// health signal; logs are for the console.

import type { Coordinates, ForecastError, ForecastResponse, ForecastResult } from './types';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const FORECAST_ENDPOINT = 'https://api.open-meteo.com/v1/forecast';

const DEFAULT_TIMEOUT_MS = 10_000;

const MAX_ATTEMPTS = 3;

/**
 * Backoff schedule (delay BEFORE attempting the next try). Indexed by
 * "completed attempts" — i.e. WAIT_MS[0] is the wait after attempt 1 fails,
 * WAIT_MS[1] is the wait after attempt 2 fails, etc.
 *
 * Story #4 specifies "2s → 4s → 8s, max 3 attempts". With 3 attempts only
 * WAIT_MS[0] (2s) and WAIT_MS[1] (4s) are actually consumed; the 8s tier is
 * documented here because the requirement names it explicitly, but a 4th
 * attempt is not made.
 */
const WAIT_MS: readonly number[] = [2_000, 4_000, 8_000];

// Selected forecast fields — locked in by the PRD spike on 2026-06-07.
const CURRENT_FIELDS = [
  'temperature_2m',
  'relative_humidity_2m',
  'precipitation',
  'weather_code',
  'wind_speed_10m',
].join(',');

const HOURLY_FIELDS = [
  'temperature_2m',
  'precipitation',
  'precipitation_probability',
  'weather_code',
].join(',');

const DAILY_FIELDS = [
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_sum',
  'weather_code',
].join(',');

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface FetchForecastOptions {
  /** Caller's abort signal. Combined with the per-attempt timeout signal. */
  readonly signal?: AbortSignal;
  /** Override the default 10 s per-attempt timeout. */
  readonly timeoutMs?: number;
  /** Override `globalThis.fetch` — for tests. */
  readonly fetchImpl?: typeof fetch;
  /** Override the backoff sleep — for tests using fake timers. */
  readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * Fetch a 7-day forecast for a single location.
 *
 * Returns a typed Result. The function never throws to its caller.
 */
export async function fetchForecast(
  coords: Coordinates,
  opts: FetchForecastOptions = {},
): Promise<ForecastResult> {
  const validationError = validateCoordinates(coords);
  if (validationError !== null) {
    return { ok: false, error: validationError };
  }

  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const sleep = opts.sleep ?? defaultSleep;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const url = buildForecastUrl(coords);
  const ctx = `[open-meteo] lat=${coords.lat} lon=${coords.lon}`;

  let lastTransientError: ForecastError | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    // Per-attempt timeout signal. AbortSignal.any combines it with the
    // caller's signal so external cancellation also works.
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const combinedSignal = combineSignals(opts.signal, timeoutSignal);

    let response: Response;
    try {
      // eslint-disable-next-line no-console
      console.info(`${ctx} attempt=${attempt}/${MAX_ATTEMPTS} fetch start`);
      response = await fetchImpl(url, { signal: combinedSignal });
    } catch (err: unknown) {
      const classification = classifyFetchError(err, timeoutSignal, opts.signal);

      if (classification.kind === 'caller-abort') {
        // Caller cancelled — surface as a typed network error and stop.
        // eslint-disable-next-line no-console
        console.warn(`${ctx} aborted by caller`);
        return {
          ok: false,
          error: { kind: 'network', message: 'aborted by caller' },
        };
      }

      // Retryable: timeout or transient network failure.
      lastTransientError =
        classification.kind === 'timeout'
          ? { kind: 'timeout' }
          : { kind: 'network', message: classification.message };

      // eslint-disable-next-line no-console
      console.warn(
        `${ctx} attempt=${attempt} failed (${lastTransientError.kind}): ${
          classification.kind === 'network' ? classification.message : 'timeout'
        }`,
      );

      if (await waitBeforeNextAttempt(attempt, sleep)) {
        continue;
      }
      // eslint-disable-next-line no-console
      console.error(`${ctx} giving up after ${attempt} attempts: ${lastTransientError.kind}`);
      return { ok: false, error: lastTransientError };
    }

    if (!response.ok) {
      const status = response.status;
      if (status >= 400 && status < 500) {
        // 4xx — never retry.
        // eslint-disable-next-line no-console
        console.error(`${ctx} non-retryable HTTP ${status}`);
        return {
          ok: false,
          error: { kind: 'http', status, retried: false },
        };
      }

      // 5xx (or any other non-2xx) — retryable.
      lastTransientError = { kind: 'http', status, retried: true };
      // eslint-disable-next-line no-console
      console.warn(`${ctx} attempt=${attempt} HTTP ${status} (retryable)`);
      if (await waitBeforeNextAttempt(attempt, sleep)) {
        continue;
      }
      // eslint-disable-next-line no-console
      console.error(`${ctx} giving up after ${attempt} attempts: HTTP ${status}`);
      return { ok: false, error: lastTransientError };
    }

    // 2xx — parse + narrow.
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'failed to read response body';
      // eslint-disable-next-line no-console
      console.error(`${ctx} parse error: ${message}`);
      return { ok: false, error: { kind: 'parse', message } };
    }

    const narrowed = narrowForecastResponse(payload);
    if (!narrowed.ok) {
      // eslint-disable-next-line no-console
      console.error(`${ctx} response shape rejected: ${narrowed.error.message}`);
      return narrowed;
    }
    // eslint-disable-next-line no-console
    console.info(`${ctx} attempt=${attempt} success`);
    return { ok: true, data: narrowed.data };
  }

  // Loop exited without returning — defensive. Should be unreachable because
  // every branch above either returns or `continue`s to the next attempt.
  return {
    ok: false,
    error: lastTransientError ?? { kind: 'network', message: 'no attempts made' },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildForecastUrl(coords: Coordinates): string {
  const params = new URLSearchParams({
    latitude: String(coords.lat),
    longitude: String(coords.lon),
    current: CURRENT_FIELDS,
    hourly: HOURLY_FIELDS,
    daily: DAILY_FIELDS,
    timezone: 'auto',
    wind_speed_unit: 'ms',
    forecast_days: '7',
  });
  return `${FORECAST_ENDPOINT}?${params.toString()}`;
}

function validateCoordinates(coords: Coordinates): ForecastError | null {
  if (!Number.isFinite(coords.lat) || !Number.isFinite(coords.lon)) {
    return { kind: 'parse', message: 'invalid coordinates: lat/lon must be finite numbers' };
  }
  if (coords.lat < -90 || coords.lat > 90) {
    return { kind: 'parse', message: `invalid coordinates: lat ${coords.lat} out of range` };
  }
  if (coords.lon < -180 || coords.lon > 180) {
    return { kind: 'parse', message: `invalid coordinates: lon ${coords.lon} out of range` };
  }
  return null;
}

function combineSignals(
  caller: AbortSignal | undefined,
  timeout: AbortSignal,
): AbortSignal {
  if (caller === undefined) {
    return timeout;
  }
  // AbortSignal.any is available on Node ≥ 20.3 and modern browsers (including
  // mobile Safari). Project runtime is Node 22 (see package.json devDeps).
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
  // The timeout fired for THIS attempt.
  if (timeoutSignal.aborted) {
    const reason = timeoutSignal.reason;
    if (reason instanceof DOMException && reason.name === 'TimeoutError') {
      return { kind: 'timeout' };
    }
    return { kind: 'timeout' };
  }

  // The caller cancelled the whole call.
  if (callerSignal?.aborted === true) {
    return { kind: 'caller-abort' };
  }

  if (err instanceof DOMException && err.name === 'AbortError') {
    // Aborted but neither signal reports it — treat as caller abort (safer:
    // do not retry forever on an opaque abort).
    return { kind: 'caller-abort' };
  }

  const message = err instanceof Error ? err.message : String(err);
  return { kind: 'network', message };
}

async function waitBeforeNextAttempt(
  completedAttempt: number,
  sleep: (ms: number) => Promise<void>,
): Promise<boolean> {
  if (completedAttempt >= MAX_ATTEMPTS) {
    return false;
  }
  const delay = WAIT_MS[completedAttempt - 1] ?? WAIT_MS[WAIT_MS.length - 1];
  // `delay` is `number | undefined` after `noUncheckedIndexedAccess`; fall back
  // to the last tier defensively.
  await sleep(delay ?? 0);
  return true;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

// ---------------------------------------------------------------------------
// Boundary validation
// ---------------------------------------------------------------------------

type ParseFailure = Extract<ForecastError, { kind: 'parse' }>;

type NarrowResult =
  | { readonly ok: true; readonly data: ForecastResponse }
  | { readonly ok: false; readonly error: ParseFailure };

function narrowForecastResponse(value: unknown): NarrowResult {
  if (!isPlainObject(value)) {
    return parseError('response is not a JSON object');
  }
  if (!isFiniteNumberProp(value, 'latitude')) return parseError('missing `latitude`');
  if (!isFiniteNumberProp(value, 'longitude')) return parseError('missing `longitude`');
  if (!isStringProp(value, 'timezone')) return parseError('missing `timezone`');

  if (!isPlainObject(value.current)) return parseError('missing `current` block');
  const current = value.current;
  if (!isFiniteNumberProp(current, 'temperature_2m')) {
    return parseError('current.temperature_2m missing');
  }
  if (!isFiniteNumberProp(current, 'relative_humidity_2m')) {
    return parseError('current.relative_humidity_2m missing');
  }
  if (!isFiniteNumberProp(current, 'precipitation')) {
    return parseError('current.precipitation missing');
  }
  if (!isFiniteNumberProp(current, 'weather_code')) {
    return parseError('current.weather_code missing');
  }
  if (!isFiniteNumberProp(current, 'wind_speed_10m')) {
    return parseError('current.wind_speed_10m missing');
  }

  if (!isPlainObject(value.hourly)) return parseError('missing `hourly` block');
  const hourly = value.hourly;
  if (!isStringArrayProp(hourly, 'time')) return parseError('hourly.time must be string[]');
  if (!isNumberArrayProp(hourly, 'temperature_2m')) {
    return parseError('hourly.temperature_2m must be number[]');
  }
  if (!isNumberArrayProp(hourly, 'precipitation')) {
    return parseError('hourly.precipitation must be number[]');
  }
  if (!isNumberArrayProp(hourly, 'precipitation_probability')) {
    return parseError('hourly.precipitation_probability must be number[]');
  }
  if (!isNumberArrayProp(hourly, 'weather_code')) {
    return parseError('hourly.weather_code must be number[]');
  }

  if (!isPlainObject(value.daily)) return parseError('missing `daily` block');
  const daily = value.daily;
  if (!isStringArrayProp(daily, 'time')) return parseError('daily.time must be string[]');
  if (!isNumberArrayProp(daily, 'temperature_2m_max')) {
    return parseError('daily.temperature_2m_max must be number[]');
  }
  if (!isNumberArrayProp(daily, 'temperature_2m_min')) {
    return parseError('daily.temperature_2m_min must be number[]');
  }
  if (!isNumberArrayProp(daily, 'precipitation_sum')) {
    return parseError('daily.precipitation_sum must be number[]');
  }
  if (!isNumberArrayProp(daily, 'weather_code')) {
    return parseError('daily.weather_code must be number[]');
  }

  // All required fields verified; trust the cast past this boundary. The
  // *_units blocks are optional informational and are passed through if
  // present.
  return { ok: true, data: value as unknown as ForecastResponse };
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

function isStringArrayProp(obj: Record<string, unknown>, key: string): boolean {
  const v = obj[key];
  return Array.isArray(v) && v.every((item) => typeof item === 'string');
}

function isNumberArrayProp(obj: Record<string, unknown>, key: string): boolean {
  const v = obj[key];
  return Array.isArray(v) && v.every((item) => typeof item === 'number' && Number.isFinite(item));
}

// Exported for tests only — not part of the public surface.
export const __internals = {
  buildForecastUrl,
  narrowForecastResponse,
  WAIT_MS,
  MAX_ATTEMPTS,
  DEFAULT_TIMEOUT_MS,
};
