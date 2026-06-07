// On-device forecast cache.
//
// Layer rule (CLAUDE.md › Architecture): this file is part of the storage
// layer. It may depend on `weather/` (domain types) and on a `KeyValueStore`
// from `./types`; it must NOT depend on `ui/` or on the global DOM.
//
// What it does:
//   - Keys forecasts by their coordinates (rounded to 4 decimal places — about
//     ~11 m precision, far below any practical slot drift).
//   - Persists a `CacheEntry<ForecastResponse>` as JSON.
//   - Validates the JSON shape at read time using the same defensive checks
//     used at the Open-Meteo client boundary (`open-meteo-client.ts`). The
//     storage layer treats anything in the KV store as untrusted input — a
//     stale build, a manual tamper in DevTools, or a future schema change
//     must NOT crash the app.
//   - Never throws across its boundary.

import type { Coordinates, ForecastResponse } from '../weather/types';
import type {
  CacheEntry,
  CacheReadError,
  CacheReadResult,
  KeyValueStore,
} from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CACHE_KEY_PREFIX = 'forecast:v1:';

/**
 * Bumped when the persisted `CacheEntry` shape changes incompatibly. A
 * mismatch is treated as `missing` by callers — the next online fetch refills
 * the cache, so an upgrade is invisible to the user.
 */
export const CACHE_VERSION = 1;

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export interface ForecastCache {
  /** Read the latest cached forecast for `coords`, or a typed error. */
  readonly read: (coords: Coordinates) => CacheReadResult<ForecastResponse>;
  /** Persist a successful fetch. `now` is `Date.now()`-style ms; injected for tests. */
  readonly write: (coords: Coordinates, value: ForecastResponse, now: number) => void;
  /** Remove the entry for `coords`. Best-effort. */
  readonly clear: (coords: Coordinates) => void;
  /** The key used for a given coordinate — exported for tests/diagnostics. */
  readonly keyFor: (coords: Coordinates) => string;
}

export function createForecastCache(store: KeyValueStore): ForecastCache {
  function keyFor(coords: Coordinates): string {
    return `${CACHE_KEY_PREFIX}${coords.lat.toFixed(4)},${coords.lon.toFixed(4)}`;
  }

  return {
    keyFor,

    read(coords) {
      const key = keyFor(coords);
      const raw = store.getItem(key);
      if (raw === null) {
        return fail('missing', `no cache entry for ${key}`);
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (err: unknown) {
        const detail = err instanceof Error ? err.message : String(err);
        return fail('malformed-json', `cache JSON parse failed: ${detail}`);
      }
      return narrowEntry(parsed);
    },

    write(coords, value, now) {
      const entry: CacheEntry<ForecastResponse> = {
        value,
        fetchedAt: now,
        version: CACHE_VERSION,
      };
      const key = keyFor(coords);
      let serialized: string;
      try {
        serialized = JSON.stringify(entry);
      } catch (err: unknown) {
        // Forecasts are POJOs; a stringify failure means something deeply
        // wrong upstream. Swallow + log per CLAUDE.md.
        // eslint-disable-next-line no-console
        console.error(`[cache] serialize failed for ${key}: ${describe(err)}`);
        return;
      }
      store.setItem(key, serialized);
      // eslint-disable-next-line no-console
      console.info(`[cache] write ${key} (fetchedAt=${now})`);
    },

    clear(coords) {
      store.removeItem(keyFor(coords));
    },
  };
}

// ---------------------------------------------------------------------------
// Boundary validation
// ---------------------------------------------------------------------------

function narrowEntry(value: unknown): CacheReadResult<ForecastResponse> {
  if (!isPlainObject(value)) {
    return entryFail('invalid-shape', 'cache entry is not a JSON object');
  }
  const version = value['version'];
  if (typeof version !== 'number' || !Number.isFinite(version)) {
    return entryFail('invalid-shape', 'cache entry missing `version`');
  }
  if (version !== CACHE_VERSION) {
    return entryFail('version-mismatch', `cache version ${version} != ${CACHE_VERSION}`);
  }
  const fetchedAt = value['fetchedAt'];
  if (typeof fetchedAt !== 'number' || !Number.isFinite(fetchedAt)) {
    return entryFail('invalid-shape', 'cache entry missing `fetchedAt`');
  }
  const inner = value['value'];
  const narrowed = narrowForecast(inner);
  if (!narrowed.ok) {
    // Forward the structured error verbatim.
    return { ok: false, error: narrowed.error };
  }
  const entry: CacheEntry<ForecastResponse> = {
    value: narrowed.data,
    fetchedAt,
    version,
  };
  return { ok: true, entry };
}

type NarrowOk = { readonly ok: true; readonly data: ForecastResponse };
type NarrowErr = { readonly ok: false; readonly error: CacheReadError };
type NarrowResult = NarrowOk | NarrowErr;

function narrowForecast(value: unknown): NarrowResult {
  if (!isPlainObject(value)) {
    return narrowFail('invalid-shape', 'cache `value` is not a JSON object');
  }
  if (!isFiniteNumberProp(value, 'latitude')) return narrowFail('invalid-shape', 'missing latitude');
  if (!isFiniteNumberProp(value, 'longitude')) return narrowFail('invalid-shape', 'missing longitude');
  if (!isStringProp(value, 'timezone')) return narrowFail('invalid-shape', 'missing timezone');

  if (!isPlainObject(value['current'])) return narrowFail('invalid-shape', 'missing current block');
  const current = value['current'];
  for (const k of [
    'temperature_2m',
    'relative_humidity_2m',
    'precipitation',
    'weather_code',
    'wind_speed_10m',
  ] as const) {
    if (!isFiniteNumberProp(current, k)) {
      return narrowFail('invalid-shape', `current.${k} missing`);
    }
  }

  if (!isPlainObject(value['hourly'])) return narrowFail('invalid-shape', 'missing hourly block');
  const hourly = value['hourly'];
  if (!isStringArrayProp(hourly, 'time')) return narrowFail('invalid-shape', 'hourly.time must be string[]');
  for (const k of ['temperature_2m', 'precipitation', 'precipitation_probability', 'weather_code'] as const) {
    if (!isNumberArrayProp(hourly, k)) {
      return narrowFail('invalid-shape', `hourly.${k} must be number[]`);
    }
  }

  if (!isPlainObject(value['daily'])) return narrowFail('invalid-shape', 'missing daily block');
  const daily = value['daily'];
  if (!isStringArrayProp(daily, 'time')) return narrowFail('invalid-shape', 'daily.time must be string[]');
  for (const k of ['temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'weather_code'] as const) {
    if (!isNumberArrayProp(daily, k)) {
      return narrowFail('invalid-shape', `daily.${k} must be number[]`);
    }
  }

  return { ok: true, data: value as unknown as ForecastResponse };
}

function narrowFail(kind: CacheReadError['kind'], message: string): NarrowErr {
  return { ok: false, error: { kind, message } };
}

// ---------------------------------------------------------------------------
// Local type guards (mirror `src/weather/open-meteo-client.ts:379-400`)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

function fail<T>(kind: CacheReadError['kind'], message: string): CacheReadResult<T> {
  return { ok: false, error: { kind, message } };
}

function entryFail(
  kind: CacheReadError['kind'],
  message: string,
): CacheReadResult<ForecastResponse> {
  return fail<ForecastResponse>(kind, message);
}

function describe(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}
