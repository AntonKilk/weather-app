// Open-Meteo forecast response shape (spike-verified 2026-06-07, see PRD).
// These types are the contract between mock fixtures and the real API client
// that lands in STORY-004. Field names mirror Open-Meteo exactly.

export interface CurrentWeather {
  time: string;
  temperature_2m: number;
  relative_humidity_2m: number;
  weather_code: number;
  wind_speed_10m: number;
}

export interface HourlyForecast {
  time: string[];
  temperature_2m: number[];
  precipitation: number[];
  precipitation_probability: number[];
  weather_code: number[];
}

export interface DailyForecast {
  time: string[];
  weather_code: number[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  precipitation_sum: number[];
}

export interface ForecastResponse {
  latitude: number;
  longitude: number;
  timezone: string;
  current: CurrentWeather;
  hourly: HourlyForecast;
  daily: DailyForecast;
}

export type WeatherIconKey =
  | 'clear'
  | 'mostly-clear'
  | 'partly-cloudy'
  | 'cloudy'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'freezing-rain'
  | 'snow'
  | 'snow-showers'
  | 'thunderstorm'
  | 'unknown';

export interface WeatherCondition {
  code: number;
  description: string;
  iconKey: WeatherIconKey;
}
