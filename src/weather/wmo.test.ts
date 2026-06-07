import { describe, expect, it } from 'vitest';
import { describeWeatherCode } from './wmo';

describe('describeWeatherCode', () => {
  it('maps clear sky (0)', () => {
    const s = describeWeatherCode(0);
    expect(s.group).toBe('clear');
    expect(s.icon).toBe('sun');
    expect(s.label).toBe('Clear sky');
  });

  it('maps partly cloudy (1 and 2)', () => {
    expect(describeWeatherCode(1).group).toBe('partly');
    expect(describeWeatherCode(2).group).toBe('partly');
    expect(describeWeatherCode(2).icon).toBe('sun-behind-cloud');
  });

  it('maps overcast (3) to cloud', () => {
    expect(describeWeatherCode(3).icon).toBe('cloud');
  });

  it('maps fog (45, 48)', () => {
    expect(describeWeatherCode(45).group).toBe('fog');
    expect(describeWeatherCode(48).icon).toBe('fog');
  });

  it('maps drizzle and freezing drizzle distinctly', () => {
    expect(describeWeatherCode(53).group).toBe('drizzle');
    expect(describeWeatherCode(56).group).toBe('freezing-drizzle');
    expect(describeWeatherCode(56).icon).toBe('drizzle-freezing');
  });

  it('maps rain (61/63/65) and freezing rain (66/67)', () => {
    expect(describeWeatherCode(63).group).toBe('rain');
    expect(describeWeatherCode(67).group).toBe('freezing-rain');
  });

  it('maps rain showers (80–82)', () => {
    expect(describeWeatherCode(81).group).toBe('rain-showers');
    expect(describeWeatherCode(81).icon).toBe('rain-showers');
  });

  it('maps snow and snow showers', () => {
    expect(describeWeatherCode(73).group).toBe('snow');
    expect(describeWeatherCode(85).group).toBe('snow-showers');
  });

  it('maps thunderstorm and thunderstorm with hail', () => {
    expect(describeWeatherCode(95).group).toBe('thunderstorm');
    expect(describeWeatherCode(96).group).toBe('thunderstorm-hail');
    expect(describeWeatherCode(99).icon).toBe('thunderstorm-hail');
  });

  it('falls back to "unknown" for unmapped integer codes', () => {
    const s = describeWeatherCode(123);
    expect(s.group).toBe('unknown');
    expect(s.label).toBe('Unknown');
    // Unknown still resolves to a benign default icon so the UI does not crash.
    expect(s.icon).toBe('cloud');
  });

  it('treats non-integer or NaN inputs as unknown', () => {
    expect(describeWeatherCode(Number.NaN).group).toBe('unknown');
    expect(describeWeatherCode(1.5).group).toBe('unknown');
  });
});
