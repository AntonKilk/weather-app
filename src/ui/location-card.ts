import type { LocationSlot } from '../locations/types';
import type { ForecastResponse } from '../weather/types';
import { wmoToCondition } from '../weather/wmo-codes';
import { formatHumidity, formatTemperature, formatWind } from './format';
import { renderIconSvg } from './icon';

export function renderLocationCard(slot: LocationSlot, forecast: ForecastResponse): HTMLElement {
  const condition = wmoToCondition(forecast.current.weather_code);

  const card = document.createElement('article');
  card.className = 'location-card';
  card.dataset.slotId = slot.id;
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-expanded', 'false');

  const icon = renderIconSvg(condition.iconKey, condition.description);
  card.appendChild(icon);

  const body = document.createElement('div');
  body.className = 'location-card__body';

  const name = document.createElement('h2');
  name.className = 'location-card__name';
  name.textContent = slot.name;

  const tempRow = document.createElement('div');
  tempRow.className = 'location-card__temp-row';

  const temp = document.createElement('span');
  temp.className = 'location-card__temp';
  temp.textContent = formatTemperature(forecast.current.temperature_2m);

  const desc = document.createElement('span');
  desc.className = 'location-card__desc';
  desc.textContent = condition.description;

  tempRow.append(temp, desc);

  const meta = document.createElement('div');
  meta.className = 'location-card__meta';

  const humidity = document.createElement('span');
  humidity.className = 'location-card__humidity';
  humidity.textContent = `Humidity: ${formatHumidity(forecast.current.relative_humidity_2m)}`;

  const wind = document.createElement('span');
  wind.className = 'location-card__wind';
  wind.textContent = `Wind: ${formatWind(forecast.current.wind_speed_10m)}`;

  meta.append(humidity, wind);
  body.append(name, tempRow, meta);
  card.appendChild(body);

  return card;
}

export function renderDegradedCard(slot: LocationSlot): HTMLElement {
  const card = document.createElement('article');
  card.className = 'location-card location-card--degraded';
  card.dataset.slotId = slot.id;
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-expanded', 'false');

  const icon = renderIconSvg('unknown', 'No data');
  card.appendChild(icon);

  const body = document.createElement('div');
  body.className = 'location-card__body';

  const name = document.createElement('h2');
  name.className = 'location-card__name';
  name.textContent = slot.name;

  const status = document.createElement('p');
  status.className = 'location-card__status';
  status.textContent = 'No data';

  body.append(name, status);
  card.appendChild(body);

  return card;
}
