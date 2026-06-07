import { describe, expect, it } from 'vitest';
import { formatHumidity, formatTemperature, formatWind } from './format';

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
