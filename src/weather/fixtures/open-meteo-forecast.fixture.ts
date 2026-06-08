import type { ForecastResponse } from '../types';

// Recorded-shape sample of an Open-Meteo /v1/forecast response.
//
// Sandbox-blocked check (CLAUDE.md → defer-and-record): the live `curl` to
// api.open-meteo.com from this sandbox returns "Host not in allowlist". This
// fixture mirrors the shape that the PRD spike (2026-06-07) recorded for the
// same endpoint + params, populated with neutral-zone (Berlin demo coords:
// 52.52, 13.41 — Open-Meteo's own docs example) so no real personal
// coordinates are committed.
//
// The `satisfies ForecastResponse` annotation makes any drift between this
// fixture and `src/weather/types.ts` a compile-time error — that is the real
// guarantee, not the realism of the numbers.

export const SAMPLE_FORECAST = {
  latitude: 52.52,
  longitude: 13.41,
  timezone: 'Europe/Berlin',
  current: {
    time: '2026-06-07T13:00',
    temperature_2m: 19.4,
    relative_humidity_2m: 58,
    weather_code: 3,
    wind_speed_10m: 4.2,
  },
  hourly: {
    time: [
      '2026-06-07T00:00', '2026-06-07T01:00', '2026-06-07T02:00', '2026-06-07T03:00',
      '2026-06-07T04:00', '2026-06-07T05:00', '2026-06-07T06:00', '2026-06-07T07:00',
      '2026-06-07T08:00', '2026-06-07T09:00', '2026-06-07T10:00', '2026-06-07T11:00',
      '2026-06-07T12:00', '2026-06-07T13:00', '2026-06-07T14:00', '2026-06-07T15:00',
      '2026-06-07T16:00', '2026-06-07T17:00', '2026-06-07T18:00', '2026-06-07T19:00',
      '2026-06-07T20:00', '2026-06-07T21:00', '2026-06-07T22:00', '2026-06-07T23:00',
    ],
    temperature_2m: [
      12.1, 11.6, 11.2, 10.9, 10.7, 10.6, 11.4, 12.8,
      14.5, 16.2, 17.7, 18.7, 19.2, 19.4, 19.3, 18.9,
      18.0, 16.8, 15.5, 14.4, 13.6, 13.0, 12.6, 12.3,
    ],
    precipitation: [
      0, 0, 0, 0, 0, 0, 0, 0,
      0, 0.1, 0.2, 0.4, 0.3, 0, 0, 0,
      0, 0, 0.1, 0, 0, 0, 0, 0,
    ],
    precipitation_probability: [
      5, 5, 5, 5, 5, 5, 10, 15,
      20, 35, 55, 70, 60, 35, 20, 15,
      10, 10, 25, 15, 10, 5, 5, 5,
    ],
    weather_code: [
      3, 3, 3, 3, 3, 3, 3, 3,
      3, 61, 61, 61, 61, 3, 3, 3,
      3, 3, 51, 3, 3, 3, 3, 3,
    ],
  },
  daily: {
    time: [
      '2026-06-07', '2026-06-08', '2026-06-09', '2026-06-10',
      '2026-06-11', '2026-06-12', '2026-06-13',
    ],
    weather_code: [3, 61, 3, 2, 0, 1, 61],
    temperature_2m_max: [19.4, 17.2, 20.1, 22.5, 24.0, 23.1, 18.6],
    temperature_2m_min: [10.6, 12.4, 11.8, 13.2, 14.1, 14.6, 13.0],
    precipitation_sum: [1.1, 5.3, 0, 0, 0, 0, 3.8],
  },
} satisfies ForecastResponse;

// JSON round-trip strips the TypeScript type so parser tests get a true
// `unknown`-shaped input (mirrors what `await response.json()` actually
// produces at the network boundary).
export const SAMPLE_RAW_JSON: unknown = JSON.parse(JSON.stringify(SAMPLE_FORECAST));
