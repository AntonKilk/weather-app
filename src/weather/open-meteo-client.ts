import type { ForecastResponse, CurrentWeather, HourlyForecast, DailyForecast } from './types';

// Typed client for Open-Meteo's /v1/forecast endpoint. Single export point of
// network failure: every error path returns a typed `FetchResult`, never
// throws — so callers can `Promise.all` over 6 slots and one slot's failure
// cannot poison the others (CLAUDE.md › Fault Tolerance, STORY-004 AC5).

export type FetchError =
  | { kind: 'network'; message: string }
  | { kind: 'timeout'; message: string }
  | { kind: 'server'; status: number; message: string }
  | { kind: 'client'; status: number; message: string }
  | { kind: 'parse'; message: string };

export type FetchResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: FetchError };

export interface ClientDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  retryDelaysMs?: readonly number[];
}

export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_RETRY_DELAYS_MS = [2_000, 4_000, 8_000] as const;
export const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

const FORECAST_PARAMS = {
  current: 'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m',
  hourly: 'temperature_2m,precipitation,precipitation_probability,weather_code',
  daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum',
  timezone: 'auto',
  wind_speed_unit: 'ms',
  forecast_days: '7',
} as const;

export function buildForecastUrl(lat: number, lon: number): string {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    ...FORECAST_PARAMS,
  });
  return `${OPEN_METEO_FORECAST_URL}?${params.toString()}`;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchForecast(
  lat: number,
  lon: number,
  deps: ClientDeps = {},
): Promise<FetchResult<ForecastResponse>> {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return { ok: false, error: { kind: 'parse', message: `invalid latitude: ${lat}` } };
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    return { ok: false, error: { kind: 'parse', message: `invalid longitude: ${lon}` } };
  }

  const fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const sleep = deps.sleep ?? defaultSleep;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryDelaysMs = deps.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const url = buildForecastUrl(lat, lon);

  let lastError: FetchError = { kind: 'network', message: 'no attempts made' };
  const totalAttempts = 1 + retryDelaysMs.length;

  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    const result = await attemptOnce(fetchImpl, url, timeoutMs);
    if (result.ok) return result;
    lastError = result.error;
    if (!isRetriable(result.error)) return result;
    if (attempt < retryDelaysMs.length) {
      const delay = retryDelaysMs[attempt];
      if (delay !== undefined) await sleep(delay);
    }
  }
  console.warn(
    `[open-meteo] all ${totalAttempts} attempts failed for lat=${lat}, lon=${lon}`,
    lastError,
  );
  return { ok: false, error: lastError };
}

async function attemptOnce(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
): Promise<FetchResult<ForecastResponse>> {
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
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
    return parseForecast(json);
  } catch (err) {
    return { ok: false, error: classifyThrown(err) };
  }
}

function classifyThrown(err: unknown): FetchError {
  if (err instanceof DOMException && err.name === 'TimeoutError') {
    return { kind: 'timeout', message: 'request timed out' };
  }
  if (err instanceof DOMException && err.name === 'AbortError') {
    return { kind: 'timeout', message: 'request aborted' };
  }
  if (err instanceof Error) {
    return { kind: 'network', message: err.message };
  }
  return { kind: 'network', message: 'unknown network error' };
}

function isRetriable(error: FetchError): boolean {
  return error.kind === 'network' || error.kind === 'timeout' || error.kind === 'server';
}

// --- Boundary parser ---------------------------------------------------------
// Narrows `unknown` → `ForecastResponse`. Everything past this point is
// trusted domain code (CLAUDE.md › Types).

export function parseForecast(raw: unknown): FetchResult<ForecastResponse> {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: { kind: 'parse', message: 'response is not an object' } };
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.latitude !== 'number' || typeof r.longitude !== 'number') {
    return { ok: false, error: { kind: 'parse', message: 'missing or invalid latitude/longitude' } };
  }
  if (typeof r.timezone !== 'string') {
    return { ok: false, error: { kind: 'parse', message: 'missing or invalid timezone' } };
  }
  const current = parseCurrent(r.current);
  if (!current.ok) return current;
  const hourly = parseHourly(r.hourly);
  if (!hourly.ok) return hourly;
  const daily = parseDaily(r.daily);
  if (!daily.ok) return daily;
  return {
    ok: true,
    data: {
      latitude: r.latitude,
      longitude: r.longitude,
      timezone: r.timezone,
      current: current.data,
      hourly: hourly.data,
      daily: daily.data,
    },
  };
}

function parseCurrent(raw: unknown): FetchResult<CurrentWeather> {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: { kind: 'parse', message: 'missing current block' } };
  }
  const c = raw as Record<string, unknown>;
  if (typeof c.time !== 'string') {
    return { ok: false, error: { kind: 'parse', message: 'current.time is not a string' } };
  }
  if (typeof c.temperature_2m !== 'number') {
    return { ok: false, error: { kind: 'parse', message: 'current.temperature_2m is not a number' } };
  }
  if (typeof c.relative_humidity_2m !== 'number') {
    return { ok: false, error: { kind: 'parse', message: 'current.relative_humidity_2m is not a number' } };
  }
  if (typeof c.weather_code !== 'number') {
    return { ok: false, error: { kind: 'parse', message: 'current.weather_code is not a number' } };
  }
  if (typeof c.wind_speed_10m !== 'number') {
    return { ok: false, error: { kind: 'parse', message: 'current.wind_speed_10m is not a number' } };
  }
  return {
    ok: true,
    data: {
      time: c.time,
      temperature_2m: c.temperature_2m,
      relative_humidity_2m: c.relative_humidity_2m,
      weather_code: c.weather_code,
      wind_speed_10m: c.wind_speed_10m,
    },
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'number');
}

function parseHourly(raw: unknown): FetchResult<HourlyForecast> {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: { kind: 'parse', message: 'missing hourly block' } };
  }
  const h = raw as Record<string, unknown>;
  if (!isStringArray(h.time)) {
    return { ok: false, error: { kind: 'parse', message: 'hourly.time is not a string[]' } };
  }
  if (!isNumberArray(h.temperature_2m)) {
    return { ok: false, error: { kind: 'parse', message: 'hourly.temperature_2m is not a number[]' } };
  }
  if (!isNumberArray(h.precipitation)) {
    return { ok: false, error: { kind: 'parse', message: 'hourly.precipitation is not a number[]' } };
  }
  if (!isNumberArray(h.precipitation_probability)) {
    return {
      ok: false,
      error: { kind: 'parse', message: 'hourly.precipitation_probability is not a number[]' },
    };
  }
  if (!isNumberArray(h.weather_code)) {
    return { ok: false, error: { kind: 'parse', message: 'hourly.weather_code is not a number[]' } };
  }
  const n = h.time.length;
  if (
    h.temperature_2m.length !== n ||
    h.precipitation.length !== n ||
    h.precipitation_probability.length !== n ||
    h.weather_code.length !== n
  ) {
    return { ok: false, error: { kind: 'parse', message: 'hourly arrays have mismatched lengths' } };
  }
  return {
    ok: true,
    data: {
      time: h.time,
      temperature_2m: h.temperature_2m,
      precipitation: h.precipitation,
      precipitation_probability: h.precipitation_probability,
      weather_code: h.weather_code,
    },
  };
}

function parseDaily(raw: unknown): FetchResult<DailyForecast> {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: { kind: 'parse', message: 'missing daily block' } };
  }
  const d = raw as Record<string, unknown>;
  if (!isStringArray(d.time)) {
    return { ok: false, error: { kind: 'parse', message: 'daily.time is not a string[]' } };
  }
  if (!isNumberArray(d.weather_code)) {
    return { ok: false, error: { kind: 'parse', message: 'daily.weather_code is not a number[]' } };
  }
  if (!isNumberArray(d.temperature_2m_max)) {
    return { ok: false, error: { kind: 'parse', message: 'daily.temperature_2m_max is not a number[]' } };
  }
  if (!isNumberArray(d.temperature_2m_min)) {
    return { ok: false, error: { kind: 'parse', message: 'daily.temperature_2m_min is not a number[]' } };
  }
  if (!isNumberArray(d.precipitation_sum)) {
    return { ok: false, error: { kind: 'parse', message: 'daily.precipitation_sum is not a number[]' } };
  }
  const n = d.time.length;
  if (
    d.weather_code.length !== n ||
    d.temperature_2m_max.length !== n ||
    d.temperature_2m_min.length !== n ||
    d.precipitation_sum.length !== n
  ) {
    return { ok: false, error: { kind: 'parse', message: 'daily arrays have mismatched lengths' } };
  }
  return {
    ok: true,
    data: {
      time: d.time,
      weather_code: d.weather_code,
      temperature_2m_max: d.temperature_2m_max,
      temperature_2m_min: d.temperature_2m_min,
      precipitation_sum: d.precipitation_sum,
    },
  };
}
