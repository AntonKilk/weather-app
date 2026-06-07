// Open-Meteo `/v1/forecast` response shape + client result types.
//
// Source: PRD spike 2026-06-07 (.agents/PRDs/offline-weather-pwa.prd.md).
// Endpoint used:
//   https://api.open-meteo.com/v1/forecast
//     ?latitude=…&longitude=…
//     &current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m
//     &hourly=temperature_2m,precipitation,precipitation_probability,weather_code
//     &daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum
//     &timezone=auto
//     &wind_speed_unit=ms
//
// Layer rule (CLAUDE.md › Architecture): this file is the source of truth for
// weather-domain types. Higher layers (ui/, storage/, locations/, main.ts) may
// import from here. This file must NOT import from any of those layers and must
// NOT know about fetch, IndexedDB, or the DOM.
//
// Naming history: STORY-002 (UI skeleton) introduced the `OpenMeteo*` prefix
// for the response shape; STORY-004 (real fetch client) introduced shorter
// names (`CurrentBlock`, `HourlyBlock`, `ForecastResponse`). Both sets are
// kept here as aliases so that the UI built against `OpenMeteoForecast` and
// the client returning `ForecastResponse` coexist without churn.

// ---------------------------------------------------------------------------
// Coordinates (client input)
// ---------------------------------------------------------------------------

/** Geographic coordinates used to address a single forecast slot. */
export interface Coordinates {
  readonly lat: number;
  readonly lon: number;
}

// ---------------------------------------------------------------------------
// Open-Meteo response blocks
// ---------------------------------------------------------------------------

/** Snapshot of the current-conditions block returned by Open-Meteo. */
export interface CurrentBlock {
  readonly time: string;
  readonly interval: number;
  readonly temperature_2m: number;
  readonly relative_humidity_2m: number;
  readonly precipitation: number;
  readonly weather_code: number;
  readonly wind_speed_10m: number;
}

/** Units for the `current` block (informational; numbers above are already in those units). */
export interface CurrentUnits {
  readonly time: string;
  readonly interval: string;
  readonly temperature_2m: string;
  readonly relative_humidity_2m: string;
  readonly precipitation: string;
  readonly weather_code: string;
  readonly wind_speed_10m: string;
}

/**
 * Hourly forecast block. All arrays have the same length and are aligned by
 * index with `hourly.time`. Open-Meteo returns ISO-8601 strings in the
 * timezone implied by the request (we use `timezone=auto`).
 */
export interface HourlyBlock {
  readonly time: readonly string[];
  readonly temperature_2m: readonly number[];
  readonly precipitation: readonly number[];
  readonly precipitation_probability: readonly number[];
  readonly weather_code: readonly number[];
}

export interface HourlyUnits {
  readonly time: string;
  readonly temperature_2m: string;
  readonly precipitation: string;
  readonly precipitation_probability: string;
  readonly weather_code: string;
}

/** Daily forecast block (7 days when called with `forecast_days=7`). */
export interface DailyBlock {
  readonly time: readonly string[];
  readonly temperature_2m_max: readonly number[];
  readonly temperature_2m_min: readonly number[];
  readonly precipitation_sum: readonly number[];
  readonly weather_code: readonly number[];
}

export interface DailyUnits {
  readonly time: string;
  readonly temperature_2m_max: string;
  readonly temperature_2m_min: string;
  readonly precipitation_sum: string;
  readonly weather_code: string;
}

/**
 * Full Open-Meteo forecast response — narrowed to the fields we actually use.
 *
 * The `*_units` blocks are optional in the type because Open-Meteo always
 * returns them, but our boundary validation does not require them.
 */
export interface ForecastResponse {
  readonly latitude: number;
  readonly longitude: number;
  readonly timezone: string;
  readonly timezone_abbreviation?: string;
  readonly utc_offset_seconds?: number;
  readonly elevation?: number;
  readonly generationtime_ms?: number;
  readonly current: CurrentBlock;
  readonly current_units?: CurrentUnits;
  readonly hourly: HourlyBlock;
  readonly hourly_units?: HourlyUnits;
  readonly daily: DailyBlock;
  readonly daily_units?: DailyUnits;
}

// ---------------------------------------------------------------------------
// Backward-compatible aliases (STORY-002 naming)
// ---------------------------------------------------------------------------
//
// The UI built against these names in STORY-002. Re-exporting under both
// names lets the UI and the client coexist without rewriting either file.

export type OpenMeteoCurrent = CurrentBlock;
export type OpenMeteoCurrentUnits = CurrentUnits;
export type OpenMeteoHourly = HourlyBlock;
export type OpenMeteoHourlyUnits = HourlyUnits;
export type OpenMeteoDaily = DailyBlock;
export type OpenMeteoDailyUnits = DailyUnits;
export type OpenMeteoForecast = ForecastResponse;

// ---------------------------------------------------------------------------
// Typed result / error union (used by the open-meteo client)
// ---------------------------------------------------------------------------

/**
 * Discriminated error union returned by the Open-Meteo client.
 *
 * - `timeout`: the per-attempt 10 s AbortSignal.timeout fired (retries exhausted).
 * - `network`: fetch threw a non-timeout error (offline, DNS, caller abort, ...).
 * - `http`:    server returned a non-2xx status. `retried` is true for 5xx after
 *              backoff was exhausted, false for 4xx (never retried).
 * - `parse`:   the response body could not be decoded or did not match the
 *              expected shape at the API boundary.
 *
 * The client never throws across its boundary — callers branch on `ok`.
 */
export type ForecastError =
  | { readonly kind: 'timeout' }
  | { readonly kind: 'network'; readonly message: string }
  | { readonly kind: 'http'; readonly status: number; readonly retried: boolean }
  | { readonly kind: 'parse'; readonly message: string };

/** Generic typed result used by the client. */
export type Result<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: ForecastError };

export type ForecastResult = Result<ForecastResponse>;
