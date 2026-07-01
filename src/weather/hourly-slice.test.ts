import { describe, expect, it } from 'vitest';
import { sliceHourlyForDay } from './hourly-slice';
import type { HourlyForecast } from './types';

const TWO_DAYS: HourlyForecast = {
  time: [
    '2026-06-07T22:00',
    '2026-06-07T23:00',
    '2026-06-08T00:00',
    '2026-06-08T01:00',
    '2026-06-08T02:00',
  ],
  temperature_2m: [10, 11, 12, 13, 14],
  precipitation: [0, 0.1, 0.2, 0, 0.5],
  precipitation_probability: [5, 10, 20, 30, 60],
  weather_code: [0, 1, 2, 3, 61],
};

describe('sliceHourlyForDay', () => {
  it('keeps only the entries of the requested calendar day, arrays aligned', () => {
    const sliced = sliceHourlyForDay(TWO_DAYS, '2026-06-08');
    expect(sliced.time).toEqual(['2026-06-08T00:00', '2026-06-08T01:00', '2026-06-08T02:00']);
    expect(sliced.temperature_2m).toEqual([12, 13, 14]);
    expect(sliced.precipitation).toEqual([0.2, 0, 0.5]);
    expect(sliced.precipitation_probability).toEqual([20, 30, 60]);
    expect(sliced.weather_code).toEqual([2, 3, 61]);
  });

  it('accepts a full ISO timestamp as the day selector', () => {
    const sliced = sliceHourlyForDay(TWO_DAYS, '2026-06-07T13:00:00');
    expect(sliced.time).toEqual(['2026-06-07T22:00', '2026-06-07T23:00']);
    expect(sliced.temperature_2m).toEqual([10, 11]);
  });

  it('returns empty arrays when the day is not present', () => {
    const sliced = sliceHourlyForDay(TWO_DAYS, '2026-06-09');
    expect(sliced.time).toEqual([]);
    expect(sliced.temperature_2m).toEqual([]);
    expect(sliced.precipitation).toEqual([]);
    expect(sliced.precipitation_probability).toEqual([]);
    expect(sliced.weather_code).toEqual([]);
  });

  it('skips entries whose parallel arrays are missing a value', () => {
    const ragged: HourlyForecast = {
      time: ['2026-06-08T00:00', '2026-06-08T01:00'],
      temperature_2m: [12],
      precipitation: [0, 0],
      precipitation_probability: [10, 10],
      weather_code: [0, 0],
    };
    const sliced = sliceHourlyForDay(ragged, '2026-06-08');
    expect(sliced.time).toEqual(['2026-06-08T00:00']);
    expect(sliced.temperature_2m).toEqual([12]);
  });
});
