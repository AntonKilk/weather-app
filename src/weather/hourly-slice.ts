import type { HourlyForecast } from './types';

// Pure slice of the 7-day hourly series down to one calendar day, so the UI
// can show an hourly chart for any day of the daily strip — not just today.
// Matching is done on the 'YYYY-MM-DD' prefix of each hourly timestamp:
// Open-Meteo returns local ISO times (timezone=auto), so a string prefix
// compare is exact and avoids Date-parsing timezone pitfalls.

export function sliceHourlyForDay(hourly: HourlyForecast, dayIso: string): HourlyForecast {
  const day = dayIso.slice(0, 10);

  const time: string[] = [];
  const temperature_2m: number[] = [];
  const precipitation: number[] = [];
  const precipitation_probability: number[] = [];
  const weather_code: number[] = [];

  for (let i = 0; i < hourly.time.length; i++) {
    const t = hourly.time[i];
    const temp = hourly.temperature_2m[i];
    const precip = hourly.precipitation[i];
    const prob = hourly.precipitation_probability[i];
    const code = hourly.weather_code[i];
    if (
      t === undefined ||
      temp === undefined ||
      precip === undefined ||
      prob === undefined ||
      code === undefined
    ) {
      continue;
    }
    if (!t.startsWith(day)) {
      continue;
    }
    time.push(t);
    temperature_2m.push(temp);
    precipitation.push(precip);
    precipitation_probability.push(prob);
    weather_code.push(code);
  }

  return { time, temperature_2m, precipitation, precipitation_probability, weather_code };
}
