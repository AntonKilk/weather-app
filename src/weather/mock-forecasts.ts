import type { ForecastResponse, HourlyForecast, DailyForecast } from './types';

// Mock forecasts shaped exactly like Open-Meteo's real response (spike-verified
// 2026-06-07, see PRD). STORY-004 will swap these for live fetches without
// touching the UI layer. Keys match LocationSlot.id in mock-locations.ts.
// A spread of WMO codes (0 / 3 / 61 / 71) exercises the icon mapping visually.

function hours(start: string, temps: number[], code: number, precip = 0): HourlyForecast {
  const time: string[] = [];
  const base = new Date(start).getTime();
  for (let i = 0; i < 24; i++) {
    time.push(new Date(base + i * 3_600_000).toISOString());
  }
  return {
    time,
    temperature_2m: temps,
    precipitation: time.map(() => precip),
    precipitation_probability: time.map(() => (precip > 0 ? 60 : 5)),
    weather_code: time.map(() => code),
  };
}

function days(start: string, maxs: number[], mins: number[], code: number, precip = 0): DailyForecast {
  const time: string[] = [];
  const base = new Date(start).getTime();
  for (let i = 0; i < 7; i++) {
    time.push(new Date(base + i * 86_400_000).toISOString().slice(0, 10));
  }
  return {
    time,
    weather_code: time.map(() => code),
    temperature_2m_max: maxs,
    temperature_2m_min: mins,
    precipitation_sum: time.map(() => precip),
  };
}

const wave24 = (peak: number, trough: number): number[] => {
  const mid = (peak + trough) / 2;
  const amp = (peak - trough) / 2;
  const out: number[] = [];
  for (let i = 0; i < 24; i++) {
    // Coldest ~5am, warmest ~3pm — sinusoidal approximation.
    const phase = ((i - 5) / 24) * 2 * Math.PI;
    out.push(Number((mid - amp * Math.cos(phase)).toFixed(1)));
  }
  return out;
};

const START_HOUR = '2026-06-07T00:00:00Z';
const START_DAY = '2026-06-07';

export const MOCK_FORECASTS: Record<string, ForecastResponse> = {
  'mock-1': {
    latitude: 0,
    longitude: 0,
    timezone: 'Europe/Helsinki',
    current: {
      time: '2026-06-07T13:00:00Z',
      temperature_2m: 19,
      relative_humidity_2m: 59,
      weather_code: 0,
      wind_speed_10m: 4,
    },
    hourly: hours(START_HOUR, wave24(21, 12), 0),
    daily: days(START_DAY, [21, 24, 18, 21, 19, 21, 17], [9, 13, 13, 11, 12, 10, 11], 0),
  },
  'mock-2': {
    latitude: 0,
    longitude: 0,
    timezone: 'Europe/Helsinki',
    current: {
      time: '2026-06-07T13:00:00Z',
      temperature_2m: 16,
      relative_humidity_2m: 72,
      weather_code: 3,
      wind_speed_10m: 6.2,
    },
    hourly: hours(START_HOUR, wave24(18, 11), 3),
    daily: days(START_DAY, [18, 17, 19, 16, 15, 17, 18], [10, 11, 12, 9, 8, 10, 11], 3),
  },
  'mock-3': {
    latitude: 0,
    longitude: 0,
    timezone: 'Europe/Helsinki',
    current: {
      time: '2026-06-07T13:00:00Z',
      temperature_2m: 12,
      relative_humidity_2m: 88,
      weather_code: 61,
      wind_speed_10m: 8.5,
    },
    hourly: hours(START_HOUR, wave24(14, 9), 61, 0.6),
    daily: days(START_DAY, [14, 13, 15, 12, 14, 13, 12], [8, 9, 10, 7, 8, 8, 7], 61, 4.2),
  },
  'mock-4': {
    latitude: 0,
    longitude: 0,
    timezone: 'Europe/Helsinki',
    current: {
      time: '2026-06-07T13:00:00Z',
      temperature_2m: -2,
      relative_humidity_2m: 81,
      weather_code: 71,
      wind_speed_10m: 3.1,
    },
    hourly: hours(START_HOUR, wave24(1, -5), 71, 0.3),
    daily: days(START_DAY, [1, 0, -1, 2, 0, -2, 1], [-5, -6, -8, -3, -5, -7, -4], 71, 2.1),
  },
};
