import type { LocationSlot } from '../locations/types';
import type { ForecastResponse } from '../weather/types';
import { renderDailyStrip } from './daily-strip';
import { renderHourlyChart } from './hourly-chart';

export function renderDetailView(
  slot: LocationSlot,
  forecast: ForecastResponse | undefined,
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'location-detail';
  section.id = `detail-${slot.id}`;
  section.hidden = true;
  section.setAttribute('aria-label', `${slot.name} detailed view`);

  const title = document.createElement('h3');
  title.className = 'location-detail__title';
  title.textContent = slot.name;
  section.appendChild(title);

  if (forecast === undefined) {
    const empty = document.createElement('p');
    empty.className = 'location-detail__empty';
    empty.textContent = 'No data available for this location.';
    section.appendChild(empty);
    return section;
  }

  try {
    section.appendChild(renderHourlyChart(forecast.hourly));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[ui] hourly chart failed', slot.id, err);
    const fallback = document.createElement('p');
    fallback.className = 'location-detail__fallback';
    fallback.textContent = 'Hourly chart unavailable.';
    section.appendChild(fallback);
  }

  try {
    section.appendChild(renderDailyStrip(forecast.daily));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[ui] daily strip failed', slot.id, err);
    const fallback = document.createElement('p');
    fallback.className = 'location-detail__fallback';
    fallback.textContent = 'Daily forecast unavailable.';
    section.appendChild(fallback);
  }

  return section;
}
