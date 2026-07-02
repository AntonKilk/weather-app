import type { DailyForecast } from '../weather/types';
import { wmoToCondition } from '../weather/wmo-codes';
import { formatTemperature, formatWeekdayShort, todayCalendarDate } from './format';
import { renderIconSvg } from './icon';

const MAX_DAYS = 7;

export interface DailyStripOptions {
  // Calendar day ('YYYY-MM-DD' or full ISO) whose cell starts highlighted.
  selectedIso?: string;
  // When provided, cells become day switchers: tapping one moves the
  // selection highlight and reports the day's ISO date to the caller.
  onSelectDay?: (dayIso: string) => void;
}

function sameCalendarDay(a: string, b: string): boolean {
  return a.slice(0, 10) === b.slice(0, 10);
}

export function renderDailyStrip(
  daily: DailyForecast,
  todayIso?: string,
  options?: DailyStripOptions,
): HTMLElement {
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
  const selected = options?.selectedIso;
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
    const isSelected = selected !== undefined && sameCalendarDay(iso, selected);
    if (isSelected) {
      cell.classList.add('daily-strip__cell--selected');
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'daily-strip__button';
    button.dataset.dayIso = iso;
    button.setAttribute('aria-pressed', isSelected ? 'true' : 'false');

    const day = document.createElement('span');
    day.className = 'daily-strip__day';
    day.textContent = dayLabel;
    button.appendChild(day);

    const condition = wmoToCondition(code);
    const icon = renderIconSvg(condition.iconKey, condition.description);
    button.appendChild(icon);

    const temps = document.createElement('span');
    temps.className = 'daily-strip__temps';
    const maxSpan = document.createElement('span');
    maxSpan.className = 'daily-strip__max';
    maxSpan.textContent = formatTemperature(max);
    const minSpan = document.createElement('span');
    minSpan.className = 'daily-strip__min';
    minSpan.textContent = formatTemperature(min);
    temps.append(maxSpan, minSpan);
    button.appendChild(temps);

    cell.appendChild(button);
    list.appendChild(cell);
  }

  const onSelectDay = options?.onSelectDay;
  if (onSelectDay !== undefined) {
    list.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const button = target.closest<HTMLButtonElement>('.daily-strip__button');
      if (button === null || !list.contains(button)) {
        return;
      }
      const dayIso = button.dataset.dayIso;
      if (dayIso === undefined) {
        return;
      }
      for (const other of list.querySelectorAll('.daily-strip__button')) {
        other.setAttribute('aria-pressed', other === button ? 'true' : 'false');
      }
      for (const otherCell of list.querySelectorAll('.daily-strip__cell')) {
        otherCell.classList.toggle('daily-strip__cell--selected', otherCell.contains(button));
      }
      onSelectDay(dayIso);
    });
  }

  return list;
}
