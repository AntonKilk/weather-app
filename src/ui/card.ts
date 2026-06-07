// Single location card.
//
// A <button> so it is keyboard-accessible and announced as actionable by screen
// readers. Three states:
//   1. empty custom slot          → "Add a location" placeholder. Disabled
//                                   unless `onAddRequest` is supplied
//                                   (STORY-009 enables it so a tap focuses
//                                   the search input).
//   2. populated slot, forecast=null → "Unavailable" state (still tappable; detail shows nothing)
//   3. populated slot + forecast  → full card
//
// STORY-009: populated CUSTOM slots get a small "×" remove button. Default
// slots never do — they are env-baked and not user-removable per the issue
// acceptance criteria. The remove handler calls `event.stopPropagation()`
// so the card's main click (which opens the detail view) does not fire.
//
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

export interface CardOptions {
  /**
   * Called when the user taps an empty custom-slot placeholder. If absent,
   * the empty placeholder is rendered as a disabled button (legacy behaviour
   * pre-STORY-009).
   */
  readonly onAddRequest?: () => void;
  /**
   * Called when the user taps the "×" button on a populated custom slot.
   * Ignored for default slots and empty placeholders. If absent, no remove
   * button is rendered.
   */
  readonly onRemove?: () => void;
}

export function renderLocationCard(
  item: CardItem,
  onTap: () => void,
  opts: CardOptions = {},
): HTMLButtonElement {
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
    if (opts.onAddRequest !== undefined) {
      const onAddRequest = opts.onAddRequest;
      button.addEventListener('click', () => onAddRequest());
    } else {
      // Legacy / pre-wired state — owner of the card hasn't supplied an
      // add-request handler, so the placeholder is non-interactive.
      button.disabled = true;
    }
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
    appendRemoveButton(button, slot, slot.location.name, opts.onRemove);
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
  appendRemoveButton(button, slot, slot.location.name, opts.onRemove);
  button.setAttribute(
    'aria-label',
    `${slot.location.name}, ${summary.label}, ${formatTemperature(forecast.current.temperature_2m)}`,
  );
  button.addEventListener('click', onTap);
  return button;
}

/**
 * Render the "×" remove button for a populated custom slot. No-op for
 * default slots and for cases without an `onRemove` handler.
 */
function appendRemoveButton(
  card: HTMLButtonElement,
  slot: LocationSlot,
  name: string,
  onRemove: (() => void) | undefined,
): void {
  if (slot.kind !== 'custom' || slot.location === null || onRemove === undefined) {
    return;
  }
  // A nested <button> inside a <button> is invalid HTML, so use a <span>
  // with role="button". It still gets keyboard focus and stays accessible.
  const remove = document.createElement('span');
  remove.className = 'card-remove';
  remove.setAttribute('role', 'button');
  remove.setAttribute('tabindex', '0');
  remove.setAttribute('aria-label', `Remove ${name}`);
  remove.textContent = '×';
  const handle = (event: Event): void => {
    event.stopPropagation();
    onRemove();
  };
  remove.addEventListener('click', handle);
  remove.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handle(event);
    }
  });
  card.appendChild(remove);
}
