// Single location card.
//
// A <button> so it is keyboard-accessible and announced as actionable by screen
// readers. Three states:
//   1. empty custom slot          → "Add a location" placeholder (no onTap)
//   2. populated slot, forecast=null → "Unavailable" state (still tappable; detail shows nothing)
//   3. populated slot + forecast  → full card
// All API-sourced strings are written via textContent — no innerHTML.

import type { LocationSlot } from '../locations/types';
import type { OpenMeteoForecast } from '../weather/types';
import { describeWeatherCode } from '../weather/wmo';
import { formatHumidity, formatTemperature, formatWind } from './format';
import { createWeatherIcon } from './icons';

export interface CardItem {
  readonly slot: LocationSlot;
  readonly forecast: OpenMeteoForecast | null;
}

export function renderLocationCard(item: CardItem, onTap: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'card';

  const { slot, forecast } = item;

  if (slot.location === null) {
    button.classList.add('card--empty');
    button.setAttribute('aria-label', 'Add a location');
    const placeholder = document.createElement('span');
    placeholder.className = 'card-placeholder';
    placeholder.textContent = '+ Add a location';
    button.appendChild(placeholder);
    // Tapping an empty slot is a future story (STORY-009) — disable for now.
    button.disabled = true;
    return button;
  }

  // Header row: name + (forecast-dependent) icon + temp
  const header = document.createElement('div');
  header.className = 'card-header';

  const name = document.createElement('h2');
  name.className = 'card-name';
  name.textContent = slot.location.name;
  header.appendChild(name);

  if (forecast === null) {
    const status = document.createElement('span');
    status.className = 'card-status';
    status.textContent = 'Unavailable';
    header.appendChild(status);
    button.appendChild(header);
    button.addEventListener('click', onTap);
    return button;
  }

  const summary = describeWeatherCode(forecast.current.weather_code);

  const icon = createWeatherIcon(summary.icon, { size: 48, title: summary.label });
  icon.classList.add('card-icon');
  header.appendChild(icon);

  const temp = document.createElement('span');
  temp.className = 'card-temp';
  temp.textContent = formatTemperature(forecast.current.temperature_2m);
  header.appendChild(temp);

  button.appendChild(header);

  // Body: weather label + metadata rows
  const body = document.createElement('div');
  body.className = 'card-body';

  const label = document.createElement('p');
  label.className = 'card-label';
  label.textContent = summary.label;
  body.appendChild(label);

  const meta = document.createElement('dl');
  meta.className = 'card-meta';

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
  body.appendChild(meta);

  button.appendChild(body);
  button.setAttribute('aria-label', `${slot.location.name}, ${summary.label}, ${formatTemperature(forecast.current.temperature_2m)}`);
  button.addEventListener('click', onTap);
  return button;
}
