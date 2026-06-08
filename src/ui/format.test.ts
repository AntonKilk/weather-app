import { describe, expect, it } from 'vitest';
import {
  formatHourLabel,
  formatHumidity,
  formatTemperature,
  formatWeekdayShort,
  formatWind,
} from './format';

describe('formatTemperature', () => {
  it('rounds to nearest integer with a degree sign', () => {
    expect(formatTemperature(19)).toBe('19°');
    expect(formatTemperature(19.4)).toBe('19°');
    expect(formatTemperature(19.5)).toBe('20°');
  });

  it('handles zero and negatives', () => {
    expect(formatTemperature(0)).toBe('0°');
    expect(formatTemperature(-3.4)).toBe('-3°');
    // Math.round(-3.5) === -3 in JS (rounds toward +∞ on .5), which is acceptable
    // for a weather display — what matters is consistent integer output.
    expect(formatTemperature(-3.5)).toBe('-3°');
  });
});

describe('formatHumidity', () => {
  it('rounds and appends %', () => {
    expect(formatHumidity(59)).toBe('59%');
    expect(formatHumidity(59.4)).toBe('59%');
    expect(formatHumidity(59.5)).toBe('60%');
    expect(formatHumidity(0)).toBe('0%');
  });
});

describe('formatWind', () => {
  it('drops trailing .0 on integers', () => {
    expect(formatWind(4)).toBe('4 m/s');
    expect(formatWind(4.0)).toBe('4 m/s');
  });

  it('keeps one decimal otherwise', () => {
    expect(formatWind(4.5)).toBe('4.5 m/s');
    expect(formatWind(4.55)).toBe('4.6 m/s');
    expect(formatWind(0.1)).toBe('0.1 m/s');
  });

  it('handles zero', () => {
    expect(formatWind(0)).toBe('0 m/s');
  });
});

describe('formatHourLabel', () => {
  it('returns a HH:00 string for an ISO input', () => {
    // Local-time ISO (no Z) — interpreted in the host timezone deterministically.
    expect(formatHourLabel('2026-06-07T14:00:00')).toBe('14:00');
    expect(formatHourLabel('2026-06-07T07:30:00')).toBe('07:00');
    expect(formatHourLabel('2026-06-07T00:00:00')).toBe('00:00');
  });

  it('zero-pads single-digit hours', () => {
    expect(formatHourLabel('2026-06-07T09:00:00')).toMatch(/^09:00$/);
  });

  it('produces a HH:00 shape for any valid ISO including Z', () => {
    // Hour value depends on host TZ when Z is supplied — assert the shape only.
    expect(formatHourLabel('2026-06-07T14:00:00Z')).toMatch(/^\d{2}:00$/);
  });

  it('returns empty string for invalid input', () => {
    expect(formatHourLabel('not-a-date')).toBe('');
  });
});

describe('formatWeekdayShort', () => {
  it('returns "Today" when iso matches todayIso (same calendar date)', () => {
    expect(formatWeekdayShort('2026-06-07', '2026-06-07')).toBe('Today');
    expect(formatWeekdayShort('2026-06-07T00:00:00', '2026-06-07')).toBe('Today');
  });

  it('returns a 3-letter English weekday otherwise', () => {
    expect(formatWeekdayShort('2026-06-08', '2026-06-07')).toMatch(
      /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/,
    );
  });

  it('returns a weekday when no todayIso is given', () => {
    expect(formatWeekdayShort('2026-06-08')).toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/);
  });

  it('returns empty string for invalid input', () => {
    expect(formatWeekdayShort('not-a-date', '2026-06-07')).toBe('');
  });
});
