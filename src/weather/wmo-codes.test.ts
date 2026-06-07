import { describe, expect, it } from 'vitest';
import { wmoToCondition } from './wmo-codes';

describe('wmoToCondition', () => {
  it.each([
    [0, 'Clear sky', 'clear'],
    [1, 'Mainly clear', 'mostly-clear'],
    [2, 'Partly cloudy', 'partly-cloudy'],
    [3, 'Overcast', 'cloudy'],
    [45, 'Fog', 'fog'],
    [48, 'Fog', 'fog'],
    [51, 'Drizzle', 'drizzle'],
    [55, 'Drizzle', 'drizzle'],
    [56, 'Freezing drizzle', 'freezing-rain'],
    [61, 'Rain', 'rain'],
    [65, 'Rain', 'rain'],
    [66, 'Freezing rain', 'freezing-rain'],
    [71, 'Snow', 'snow'],
    [77, 'Snow grains', 'snow'],
    [80, 'Rain showers', 'rain'],
    [85, 'Snow showers', 'snow-showers'],
    [95, 'Thunderstorm', 'thunderstorm'],
    [96, 'Thunderstorm with hail', 'thunderstorm'],
    [99, 'Thunderstorm with hail', 'thunderstorm'],
  ])('maps code %i → "%s" / %s', (code, description, iconKey) => {
    const condition = wmoToCondition(code);
    expect(condition.code).toBe(code);
    expect(condition.description).toBe(description);
    expect(condition.iconKey).toBe(iconKey);
  });

  it('falls back to Unknown for out-of-range codes', () => {
    const condition = wmoToCondition(999);
    expect(condition.code).toBe(999);
    expect(condition.description).toBe('Unknown');
    expect(condition.iconKey).toBe('unknown');
  });

  it('echoes the input code in the result', () => {
    expect(wmoToCondition(0).code).toBe(0);
    expect(wmoToCondition(95).code).toBe(95);
  });
});
