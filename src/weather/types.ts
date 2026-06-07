// Open-Meteo `/v1/forecast` response shape.
//
// Source: PRD spike 2026-06-07 (.agents/PRDs/offline-weather-pwa.prd.md).
// Endpoint used:
//   https://api.open-meteo.com/v1/forecast
//     ?latitude=…&longitude=…
//     &current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m
//     &hourly=temperature_2m,precipitation,precipitation_probability,weather_code
//     &daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum
//     &timezone=auto
//     &wind_speed_unit=ms
//
// STORY-004 (real fetch client) consumes these same types. Keep the shape minimal
// and faithful to the API — if Open-Meteo adds fields we don't need, do NOT add
// them here just because they exist; widen the type only when a feature requires it.

export interface OpenMeteoCurrentUnits {
  readonly time: string;
  readonly interval: string;
  readonly temperature_2m: string;
  readonly relative_humidity_2m: string;
  readonly weather_code: string;
  readonly wind_speed_10m: string;
}

export interface OpenMeteoCurrent {
  readonly time: string;
  readonly interval: number;
  readonly temperature_2m: number;
  readonly relative_humidity_2m: number;
  readonly weather_code: number;
  readonly wind_speed_10m: number;
}

export interface OpenMeteoHourlyUnits {
  readonly time: string;
  readonly temperature_2m: string;
  readonly precipitation: string;
  readonly precipitation_probability: string;
  readonly weather_code: string;
}

export interface OpenMeteoHourly {
  readonly time: ReadonlyArray<string>;
  readonly temperature_2m: ReadonlyArray<number>;
  readonly precipitation: ReadonlyArray<number>;
  readonly precipitation_probability: ReadonlyArray<number>;
  readonly weather_code: ReadonlyArray<number>;
}

export interface OpenMeteoDailyUnits {
  readonly time: string;
  readonly weather_code: string;
  readonly temperature_2m_max: string;
  readonly temperature_2m_min: string;
  readonly precipitation_sum: string;
}

export interface OpenMeteoDaily {
  readonly time: ReadonlyArray<string>;
  readonly weather_code: ReadonlyArray<number>;
  readonly temperature_2m_max: ReadonlyArray<number>;
  readonly temperature_2m_min: ReadonlyArray<number>;
  readonly precipitation_sum: ReadonlyArray<number>;
}

export interface OpenMeteoForecast {
  readonly latitude: number;
  readonly longitude: number;
  readonly generationtime_ms: number;
  readonly utc_offset_seconds: number;
  readonly timezone: string;
  readonly timezone_abbreviation: string;
  readonly elevation: number;
  readonly current_units: OpenMeteoCurrentUnits;
  readonly current: OpenMeteoCurrent;
  readonly hourly_units: OpenMeteoHourlyUnits;
  readonly hourly: OpenMeteoHourly;
  readonly daily_units: OpenMeteoDailyUnits;
  readonly daily: OpenMeteoDaily;
}
