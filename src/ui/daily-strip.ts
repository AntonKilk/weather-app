// 7-day forecast strip — weekday name + weather icon + max/min temperature.
//
// Renders a single row of equal-width cells laid out by CSS grid (no horizontal
// scroll on mobile — verified by Task 10 screenshot). Defensive against
// shorter-than-expected parallel arrays: renders only as many cells as the
// shortest array supports rather than blowing up the page.

import type { OpenMeteoDaily } from '../weather/types';
import { describeWeatherCode } from '../weather/wmo';
import { formatTemperature, formatWeekday } from './format';
import { createWeatherIcon } from './icons';

export function renderDailyStrip(daily: OpenMeteoDaily, todayIso?: string): HTMLElement {
  const strip = document.createElement('div');
  strip.className = 'detail-daily';

  const cellCount = Math.min(
    daily.time.length,
    daily.weather_code.length,
    daily.temperature_2m_max.length,
    daily.temperature_2m_min.length,
    7,
  );

  strip.style.setProperty('--daily-cols', String(Math.max(1, cellCount)));

  for (let i = 0; i < cellCount; i += 1) {
    const time = daily.time[i];
    const code = daily.weather_code[i];
    const max = daily.temperature_2m_max[i];
    const min = daily.temperature_2m_min[i];
    if (time === undefined || code === undefined || max === undefined || min === undefined) {
      // Should be unreachable thanks to the cellCount guard, but keep the
      // explicit check so `noUncheckedIndexedAccess` is satisfied.
      continue;
    }

    const cell = document.createElement('div');
    cell.className = 'detail-daily-cell';

    const weekdayLabel = formatWeekday(time, todayIso !== undefined ? { todayIso } : undefined);
    if (weekdayLabel === 'Today') {
      cell.classList.add('is-today');
    }

    const weekday = document.createElement('span');
    weekday.className = 'detail-daily-weekday';
    weekday.textContent = weekdayLabel;
    cell.appendChild(weekday);

    const summary = describeWeatherCode(code);
    const icon = createWeatherIcon(summary.icon, { size: 36, title: summary.label });
    icon.classList.add('detail-daily-icon');
    cell.appendChild(icon);

    const temps = document.createElement('span');
    temps.className = 'detail-daily-temps';
    const maxSpan = document.createElement('span');
    maxSpan.className = 'detail-daily-max';
    maxSpan.textContent = formatTemperature(max);
    const minSpan = document.createElement('span');
    minSpan.className = 'detail-daily-min';
    minSpan.textContent = formatTemperature(min);
    temps.appendChild(maxSpan);
    temps.appendChild(minSpan);
    cell.appendChild(temps);

    strip.appendChild(cell);
  }

  return strip;
}
