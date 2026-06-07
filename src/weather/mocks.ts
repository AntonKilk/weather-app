// Mock Open-Meteo forecast objects, one per default location.
//
// Shape mirrors the real /v1/forecast response exactly so that swapping
// `pickForecastFor` for the real client (STORY-004) requires no UI changes.
// Numbers are realistic (early June, Nordic latitudes) and weather codes
// vary across mocks so every icon path can be demoed.

import type { OpenMeteoForecast } from './types';

// 24 hourly slots, starting from a base hour.
function makeHourlyTimes(baseIso: string): ReadonlyArray<string> {
  // Avoid Date math drift: use simple ISO-string templating around the base hour.
  const base = new Date(baseIso);
  const out: string[] = [];
  for (let i = 0; i < 24; i += 1) {
    const t = new Date(base.getTime() + i * 60 * 60 * 1000);
    // Format as `YYYY-MM-DDTHH:MM` (Open-Meteo's hourly timestamp form).
    const yyyy = t.getFullYear();
    const mm = String(t.getMonth() + 1).padStart(2, '0');
    const dd = String(t.getDate()).padStart(2, '0');
    const hh = String(t.getHours()).padStart(2, '0');
    out.push(`${yyyy}-${mm}-${dd}T${hh}:00`);
  }
  return out;
}

function makeDailyTimes(baseIso: string): ReadonlyArray<string> {
  const base = new Date(baseIso);
  const out: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(base.getTime() + i * 24 * 60 * 60 * 1000);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    out.push(`${yyyy}-${mm}-${dd}`);
  }
  return out;
}

const HOURLY_TEMPLATE = {
  units: {
    time: 'iso8601',
    temperature_2m: '°C',
    precipitation: 'mm',
    precipitation_probability: '%',
    weather_code: 'wmo code',
  },
} as const;

const DAILY_TEMPLATE = {
  units: {
    time: 'iso8601',
    weather_code: 'wmo code',
    temperature_2m_max: '°C',
    temperature_2m_min: '°C',
    precipitation_sum: 'mm',
  },
} as const;

const CURRENT_UNITS = {
  time: 'iso8601',
  interval: 'seconds',
  temperature_2m: '°C',
  relative_humidity_2m: '%',
  precipitation: 'mm',
  weather_code: 'wmo code',
  wind_speed_10m: 'm/s',
} as const;

interface MockSeed {
  readonly latitude: number;
  readonly longitude: number;
  readonly timezone: string;
  readonly elevation: number;
  readonly currentTemp: number;
  readonly humidity: number;
  readonly weatherCode: number;
  readonly wind: number;
  readonly hourlyTemps: ReadonlyArray<number>;
  readonly hourlyPrecip: ReadonlyArray<number>;
  readonly hourlyPrecipProb: ReadonlyArray<number>;
  readonly hourlyCodes: ReadonlyArray<number>;
  readonly dailyCodes: ReadonlyArray<number>;
  readonly dailyMax: ReadonlyArray<number>;
  readonly dailyMin: ReadonlyArray<number>;
  readonly dailyPrecipSum: ReadonlyArray<number>;
}

const BASE_TIME = '2026-06-07T14:00';
const BASE_DAY = '2026-06-07';

function build(seed: MockSeed): OpenMeteoForecast {
  return {
    latitude: seed.latitude,
    longitude: seed.longitude,
    generationtime_ms: 0.5,
    utc_offset_seconds: 10800,
    timezone: seed.timezone,
    timezone_abbreviation: 'EEST',
    elevation: seed.elevation,
    current_units: CURRENT_UNITS,
    current: {
      time: BASE_TIME,
      interval: 900,
      temperature_2m: seed.currentTemp,
      relative_humidity_2m: seed.humidity,
      precipitation: 0,
      weather_code: seed.weatherCode,
      wind_speed_10m: seed.wind,
    },
    hourly_units: HOURLY_TEMPLATE.units,
    hourly: {
      time: makeHourlyTimes(BASE_TIME),
      temperature_2m: seed.hourlyTemps,
      precipitation: seed.hourlyPrecip,
      precipitation_probability: seed.hourlyPrecipProb,
      weather_code: seed.hourlyCodes,
    },
    daily_units: DAILY_TEMPLATE.units,
    daily: {
      time: makeDailyTimes(BASE_DAY),
      weather_code: seed.dailyCodes,
      temperature_2m_max: seed.dailyMax,
      temperature_2m_min: seed.dailyMin,
      precipitation_sum: seed.dailyPrecipSum,
    },
  };
}

// Helper to fill a 24-length numeric array from a small pattern.
function fill24(pattern: ReadonlyArray<number>): ReadonlyArray<number> {
  const out: number[] = [];
  for (let i = 0; i < 24; i += 1) {
    const v = pattern[i % pattern.length];
    out.push(v ?? 0);
  }
  return out;
}

const LAHTI: OpenMeteoForecast = build({
  latitude: 60.98,
  longitude: 25.66,
  timezone: 'Europe/Helsinki',
  elevation: 100,
  currentTemp: 19,
  humidity: 59,
  weatherCode: 1, // mainly clear
  wind: 4,
  hourlyTemps: fill24([19, 21, 21, 17, 12, 9, 13, 19]),
  hourlyPrecip: fill24([0, 0, 0, 0, 0, 0, 0, 0]),
  hourlyPrecipProb: fill24([0, 0, 0, 5, 5, 5, 0, 0]),
  hourlyCodes: fill24([1, 2, 2, 1, 0, 0, 1, 1]),
  dailyCodes: [1, 3, 61, 2, 80, 95, 2],
  dailyMax: [21, 24, 18, 21, 19, 21, 19],
  dailyMin: [9, 13, 13, 11, 12, 10, 11],
  dailyPrecipSum: [0, 0.5, 4.2, 0.1, 2.0, 8.0, 0.3],
});

const HELSINKI: OpenMeteoForecast = build({
  latitude: 60.17,
  longitude: 24.94,
  timezone: 'Europe/Helsinki',
  elevation: 25,
  currentTemp: 18,
  humidity: 64,
  weatherCode: 2, // partly cloudy
  wind: 5.5,
  hourlyTemps: fill24([18, 19, 19, 17, 13, 11, 14, 18]),
  hourlyPrecip: fill24([0, 0, 0, 0.1, 0.2, 0, 0, 0]),
  hourlyPrecipProb: fill24([10, 10, 15, 25, 25, 15, 5, 5]),
  hourlyCodes: fill24([2, 2, 2, 3, 3, 3, 2, 2]),
  dailyCodes: [2, 3, 61, 80, 1, 2, 2],
  dailyMax: [19, 22, 17, 18, 20, 21, 20],
  dailyMin: [11, 12, 13, 12, 10, 11, 12],
  dailyPrecipSum: [0, 0.2, 5.0, 1.5, 0, 0.1, 0.1],
});

const TALLINN: OpenMeteoForecast = build({
  latitude: 59.44,
  longitude: 24.75,
  timezone: 'Europe/Tallinn',
  elevation: 9,
  currentTemp: 17,
  humidity: 72,
  weatherCode: 61, // light rain
  wind: 6.5,
  hourlyTemps: fill24([17, 18, 17, 15, 12, 11, 13, 17]),
  hourlyPrecip: fill24([0.3, 0.4, 0.2, 0.1, 0, 0, 0.1, 0.2]),
  hourlyPrecipProb: fill24([60, 60, 50, 35, 20, 10, 25, 40]),
  hourlyCodes: fill24([61, 61, 3, 3, 2, 2, 2, 61]),
  dailyCodes: [61, 3, 61, 2, 2, 3, 80],
  dailyMax: [18, 21, 17, 19, 20, 19, 18],
  dailyMin: [11, 11, 12, 11, 12, 12, 11],
  dailyPrecipSum: [3.5, 0, 4.0, 0.2, 0.1, 0.5, 1.5],
});

const KASMU: OpenMeteoForecast = build({
  latitude: 59.6,
  longitude: 25.92,
  timezone: 'Europe/Tallinn',
  elevation: 4,
  currentTemp: 16,
  humidity: 78,
  weatherCode: 3, // overcast
  wind: 7.2,
  hourlyTemps: fill24([16, 17, 17, 15, 12, 10, 12, 16]),
  hourlyPrecip: fill24([0, 0, 0, 0, 0, 0, 0, 0.1]),
  hourlyPrecipProb: fill24([20, 25, 30, 25, 15, 10, 15, 20]),
  hourlyCodes: fill24([3, 3, 3, 3, 2, 2, 3, 3]),
  dailyCodes: [3, 2, 80, 3, 3, 2, 1],
  dailyMax: [17, 20, 16, 18, 19, 20, 19],
  dailyMin: [10, 11, 11, 10, 11, 11, 11],
  dailyPrecipSum: [0.1, 0, 2.0, 0.3, 0.1, 0, 0],
});

export const MOCK_FORECASTS: Readonly<Record<string, OpenMeteoForecast>> = {
  Lahti: LAHTI,
  Helsinki: HELSINKI,
  Tallinn: TALLINN,
  Käsmu: KASMU,
};

/**
 * Look up a mock forecast by location name. Falls back to a generic mock
 * (Lahti) if the name is unknown, so the UI never has to handle a missing
 * mock during the skeleton phase. Kept name-only to avoid pulling
 * `locations/` into the `weather/` domain layer (CLAUDE.md › Architecture).
 */
export function pickForecastForName(name: string): OpenMeteoForecast {
  const direct = MOCK_FORECASTS[name];
  if (direct !== undefined) return direct;
  // `noUncheckedIndexedAccess` means we need a guarded fallback rather than `[0]!`.
  const fallback = MOCK_FORECASTS['Lahti'];
  if (fallback === undefined) {
    // Should be unreachable — keys above are static. Defensive throw is fine here
    // because mocks are dev-time data; this would only fire if someone deletes Lahti.
    throw new Error('No mock forecasts available');
  }
  return fallback;
}
