import type { WeatherCondition, WeatherIconKey } from './types';

export function wmoToCondition(code: number): WeatherCondition {
  const { description, iconKey } = lookup(code);
  return { code, description, iconKey };
}

function lookup(code: number): { description: string; iconKey: WeatherIconKey } {
  switch (code) {
    case 0:
      return { description: 'Clear sky', iconKey: 'clear' };
    case 1:
      return { description: 'Mainly clear', iconKey: 'mostly-clear' };
    case 2:
      return { description: 'Partly cloudy', iconKey: 'partly-cloudy' };
    case 3:
      return { description: 'Overcast', iconKey: 'cloudy' };
    case 45:
    case 48:
      return { description: 'Fog', iconKey: 'fog' };
    case 51:
    case 53:
    case 55:
      return { description: 'Drizzle', iconKey: 'drizzle' };
    case 56:
    case 57:
      return { description: 'Freezing drizzle', iconKey: 'freezing-rain' };
    case 61:
    case 63:
    case 65:
      return { description: 'Rain', iconKey: 'rain' };
    case 66:
    case 67:
      return { description: 'Freezing rain', iconKey: 'freezing-rain' };
    case 71:
    case 73:
    case 75:
      return { description: 'Snow', iconKey: 'snow' };
    case 77:
      return { description: 'Snow grains', iconKey: 'snow' };
    case 80:
    case 81:
    case 82:
      return { description: 'Rain showers', iconKey: 'rain' };
    case 85:
    case 86:
      return { description: 'Snow showers', iconKey: 'snow-showers' };
    case 95:
      return { description: 'Thunderstorm', iconKey: 'thunderstorm' };
    case 96:
    case 99:
      return { description: 'Thunderstorm with hail', iconKey: 'thunderstorm' };
    default:
      return { description: 'Unknown', iconKey: 'unknown' };
  }
}
