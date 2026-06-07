// Per-location detail view.
//
// Phase-1 placeholder: shows the header (name + current conditions) and reserves
// a slot for the hourly SVG chart + 7-day forecast that STORY-003 will render.
// The "Back" button returns to the list; no router, no URL state.

import type { LocationSlot } from '../locations/types';
import type { OpenMeteoForecast } from '../weather/types';
import { describeWeatherCode } from '../weather/wmo';
import { formatHumidity, formatTemperature, formatWind } from './format';
import { createWeatherIcon } from './icons';

export interface DetailItem {
  readonly slot: LocationSlot;
  readonly forecast: OpenMeteoForecast;
}

export function renderLocationDetail(item: DetailItem, onBack: () => void): HTMLElement {
  const section = document.createElement('section');
  section.className = 'detail';

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'detail-back';
  back.textContent = '← Back';
  back.setAttribute('aria-label', 'Back to locations');
  back.addEventListener('click', onBack);
  section.appendChild(back);

  const { slot, forecast } = item;
  const summary = describeWeatherCode(forecast.current.weather_code);

  const header = document.createElement('header');
  header.className = 'detail-header';

  const name = document.createElement('h2');
  name.className = 'detail-name';
  // slot.location may be null only for empty custom slots; the caller filters
  // those out before reaching here. Defensive check keeps TS happy.
  name.textContent = slot.location?.name ?? '';
  header.appendChild(name);

  const icon = createWeatherIcon(summary.icon, { size: 64, title: summary.label });
  icon.classList.add('detail-icon');
  header.appendChild(icon);

  const temp = document.createElement('span');
  temp.className = 'detail-temp';
  temp.textContent = formatTemperature(forecast.current.temperature_2m);
  header.appendChild(temp);

  const label = document.createElement('p');
  label.className = 'detail-label';
  label.textContent = summary.label;
  header.appendChild(label);

  const meta = document.createElement('dl');
  meta.className = 'detail-meta';

  function appendMeta(term: string, value: string): void {
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = value;
    meta.appendChild(dt);
    meta.appendChild(dd);
  }

  appendMeta('Humidity', formatHumidity(forecast.current.relative_humidity_2m));
  appendMeta('Wind', formatWind(forecast.current.wind_speed_10m));
  header.appendChild(meta);

  section.appendChild(header);

  const placeholder = document.createElement('p');
  placeholder.className = 'detail-placeholder';
  placeholder.textContent = 'Hourly chart and 7-day forecast — coming in STORY-003.';
  section.appendChild(placeholder);

  return section;
}
