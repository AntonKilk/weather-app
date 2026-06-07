// WMO 4677 weather-code → icon + human label.
//
// Subset used by Open-Meteo. Mapping documented in PRD spike (2026-06-07) and
// the table in the plan. Pure function, no I/O — safe to call anywhere.

export type WeatherIconName =
  | 'sun'
  | 'sun-behind-cloud'
  | 'cloud'
  | 'fog'
  | 'drizzle'
  | 'drizzle-freezing'
  | 'rain'
  | 'rain-freezing'
  | 'rain-showers'
  | 'snow'
  | 'snow-showers'
  | 'thunderstorm'
  | 'thunderstorm-hail';

export type WeatherGroup =
  | 'clear'
  | 'partly'
  | 'overcast'
  | 'fog'
  | 'drizzle'
  | 'freezing-drizzle'
  | 'rain'
  | 'freezing-rain'
  | 'rain-showers'
  | 'snow'
  | 'snow-showers'
  | 'thunderstorm'
  | 'thunderstorm-hail'
  | 'unknown';

export interface WeatherSummary {
  readonly group: WeatherGroup;
  readonly label: string;
  readonly icon: WeatherIconName;
}

const TABLE: Readonly<Record<number, WeatherSummary>> = {
  0: { group: 'clear', label: 'Clear sky', icon: 'sun' },
  1: { group: 'partly', label: 'Mainly clear', icon: 'sun-behind-cloud' },
  2: { group: 'partly', label: 'Partly cloudy', icon: 'sun-behind-cloud' },
  3: { group: 'overcast', label: 'Overcast', icon: 'cloud' },
  45: { group: 'fog', label: 'Fog', icon: 'fog' },
  48: { group: 'fog', label: 'Depositing rime fog', icon: 'fog' },
  51: { group: 'drizzle', label: 'Light drizzle', icon: 'drizzle' },
  53: { group: 'drizzle', label: 'Moderate drizzle', icon: 'drizzle' },
  55: { group: 'drizzle', label: 'Dense drizzle', icon: 'drizzle' },
  56: { group: 'freezing-drizzle', label: 'Light freezing drizzle', icon: 'drizzle-freezing' },
  57: { group: 'freezing-drizzle', label: 'Dense freezing drizzle', icon: 'drizzle-freezing' },
  61: { group: 'rain', label: 'Slight rain', icon: 'rain' },
  63: { group: 'rain', label: 'Moderate rain', icon: 'rain' },
  65: { group: 'rain', label: 'Heavy rain', icon: 'rain' },
  66: { group: 'freezing-rain', label: 'Light freezing rain', icon: 'rain-freezing' },
  67: { group: 'freezing-rain', label: 'Heavy freezing rain', icon: 'rain-freezing' },
  71: { group: 'snow', label: 'Slight snow', icon: 'snow' },
  73: { group: 'snow', label: 'Moderate snow', icon: 'snow' },
  75: { group: 'snow', label: 'Heavy snow', icon: 'snow' },
  77: { group: 'snow', label: 'Snow grains', icon: 'snow' },
  80: { group: 'rain-showers', label: 'Slight rain showers', icon: 'rain-showers' },
  81: { group: 'rain-showers', label: 'Moderate rain showers', icon: 'rain-showers' },
  82: { group: 'rain-showers', label: 'Violent rain showers', icon: 'rain-showers' },
  85: { group: 'snow-showers', label: 'Slight snow showers', icon: 'snow-showers' },
  86: { group: 'snow-showers', label: 'Heavy snow showers', icon: 'snow-showers' },
  95: { group: 'thunderstorm', label: 'Thunderstorm', icon: 'thunderstorm' },
  96: { group: 'thunderstorm-hail', label: 'Thunderstorm with slight hail', icon: 'thunderstorm-hail' },
  99: { group: 'thunderstorm-hail', label: 'Thunderstorm with heavy hail', icon: 'thunderstorm-hail' },
};

const UNKNOWN: WeatherSummary = { group: 'unknown', label: 'Unknown', icon: 'cloud' };

export function describeWeatherCode(code: number): WeatherSummary {
  if (!Number.isInteger(code)) return UNKNOWN;
  const hit = TABLE[code];
  return hit ?? UNKNOWN;
}
