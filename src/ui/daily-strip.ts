import type { DailyForecast } from '../weather/types';
import { wmoToCondition } from '../weather/wmo-codes';
import { formatTemperature, formatWeekdayShort } from './format';
import { renderIconSvg } from './icon';

const MAX_DAYS = 7;

function todayCalendarDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function renderDailyStrip(daily: DailyForecast, todayIso?: string): HTMLElement {
  const list = document.createElement('ul');
  list.className = 'daily-strip';

  if (daily.time.length === 0) {
    list.classList.add('daily-strip--empty');
    const fallback = document.createElement('li');
    fallback.className = 'daily-strip__fallback';
    fallback.textContent = 'Daily forecast unavailable.';
    list.appendChild(fallback);
    return list;
  }

  const today = todayIso ?? todayCalendarDate();
  const count = Math.min(MAX_DAYS, daily.time.length);

  for (let i = 0; i < count; i++) {
    const iso = daily.time[i];
    const code = daily.weather_code[i];
    const max = daily.temperature_2m_max[i];
    const min = daily.temperature_2m_min[i];

    if (
      iso === undefined ||
      code === undefined ||
      max === undefined ||
      min === undefined ||
      !Number.isFinite(max) ||
      !Number.isFinite(min)
    ) {
      continue;
    }

    const cell = document.createElement('li');
    cell.className = 'daily-strip__cell';
    const dayLabel = formatWeekdayShort(iso, today);
    if (dayLabel === 'Today') {
      cell.classList.add('daily-strip__cell--today');
    }

    const day = document.createElement('span');
    day.className = 'daily-strip__day';
    day.textContent = dayLabel;
    cell.appendChild(day);

    const condition = wmoToCondition(code);
    const icon = renderIconSvg(condition.iconKey, condition.description);
    cell.appendChild(icon);

    const temps = document.createElement('span');
    temps.className = 'daily-strip__temps';
    const maxSpan = document.createElement('span');
    maxSpan.className = 'daily-strip__max';
    maxSpan.textContent = formatTemperature(max);
    const minSpan = document.createElement('span');
    minSpan.className = 'daily-strip__min';
    minSpan.textContent = formatTemperature(min);
    temps.append(maxSpan, minSpan);
    cell.appendChild(temps);

    list.appendChild(cell);
  }

  return list;
}
