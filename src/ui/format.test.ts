import { describe, expect, it } from 'vitest';
import { formatHumidity, formatTemperature, formatTime, formatWind } from './format';

describe('formatTemperature', () => {
  it('rounds and appends the degree sign without a space', () => {
    expect(formatTemperature(19)).toBe('19°');
    expect(formatTemperature(19.4)).toBe('19°');
    expect(formatTemperature(19.6)).toBe('20°');
    expect(formatTemperature(-3.2)).toBe('-3°');
  });

  it('returns a sentinel for non-finite input', () => {
    expect(formatTemperature(Number.NaN)).toBe('--°');
    expect(formatTemperature(Number.POSITIVE_INFINITY)).toBe('--°');
  });
});

describe('formatHumidity', () => {
  it('rounds and clamps to 0..100', () => {
    expect(formatHumidity(59)).toBe('59%');
    expect(formatHumidity(59.6)).toBe('60%');
    expect(formatHumidity(-5)).toBe('0%');
    expect(formatHumidity(120)).toBe('100%');
  });

  it('returns a sentinel for non-finite input', () => {
    expect(formatHumidity(Number.NaN)).toBe('--%');
  });
});

describe('formatWind', () => {
  it('uses one decimal below 10 m/s, integer at or above', () => {
    expect(formatWind(4)).toBe('4 m/s');
    expect(formatWind(4.5)).toBe('4.5 m/s');
    expect(formatWind(9.94)).toBe('9.9 m/s');
    expect(formatWind(10)).toBe('10 m/s');
    expect(formatWind(12.4)).toBe('12 m/s');
  });

  it('returns a sentinel for negative or non-finite input', () => {
    expect(formatWind(-1)).toBe('-- m/s');
    expect(formatWind(Number.NaN)).toBe('-- m/s');
  });
});

describe('formatTime', () => {
  it('extracts HH:MM from an Open-Meteo timestamp', () => {
    expect(formatTime('2026-06-07T14:00')).toBe('14:00');
    expect(formatTime('2026-06-07T09:30')).toBe('09:30');
  });

  it('returns "--:--" on bad input', () => {
    expect(formatTime('not-a-date')).toBe('--:--');
    expect(formatTime('')).toBe('--:--');
  });
});
