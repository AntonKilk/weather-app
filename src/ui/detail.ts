// Per-location detail view.
//
// Layout (mobile, single column):
//   [Back]
//   [Header card: name • current icon • current temp • label • humidity • wind]
//   [Hourly chart card: 24-h SVG curve + precipitation row]
//   [Daily strip card: 7 weekday cells with icon + max/min]
//
// All API-sourced strings are written via `textContent`; SVGs are built with
// `createElementNS` only (CLAUDE.md › Security). One bad input must not blank
// the whole view: chart/strip construction is wrapped in try/catch so the
// header survives even if `hourly` or `daily` are malformed.

import type { LocationSlot } from '../locations/types';
import type { OpenMeteoForecast } from '../weather/types';
import { describeWeatherCode } from '../weather/wmo';
import { renderDailyStrip } from './daily-strip';
import { formatHumidity, formatTemperature, formatWind } from './format';
import {
  projectHourlyChart,
  renderHourlyChart,
  renderPrecipRow,
  selectHourlySamples,
} from './hourly-chart';
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
  const locationName = slot.location?.name ?? '';
  const summary = describeWeatherCode(forecast.current.weather_code);

  // --- Header card ---------------------------------------------------------
  const header = document.createElement('header');
  header.className = 'detail-header';

  const name = document.createElement('h2');
  name.className = 'detail-name';
  name.textContent = locationName;
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

  // --- Hourly chart card ---------------------------------------------------
  try {
    const chartCard = document.createElement('section');
    chartCard.className = 'detail-chart';

    const chartTitle = document.createElement('h3');
    chartTitle.className = 'detail-chart-title';
    chartTitle.textContent = 'Next 24 hours';
    chartCard.appendChild(chartTitle);

    const samples = selectHourlySamples(forecast.hourly, 8);
    const geometry = projectHourlyChart(samples);
    if (geometry.points.length >= 2) {
      const chartLabel = locationName !== ''
        ? `Hourly temperature for ${locationName}`
        : 'Hourly temperature';
      chartCard.appendChild(renderHourlyChart(geometry, { ariaLabel: chartLabel }));
      chartCard.appendChild(renderPrecipRow(geometry));
    } else {
      const fallback = document.createElement('p');
      fallback.className = 'detail-chart-fallback';
      fallback.textContent = 'Hourly data unavailable.';
      chartCard.appendChild(fallback);
    }

    section.appendChild(chartCard);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[detail] failed to render chart for ${locationName}`, err);
    const fallback = document.createElement('p');
    fallback.className = 'detail-chart-fallback';
    fallback.textContent = 'Could not render the chart.';
    section.appendChild(fallback);
  }

  // --- 7-day strip card ----------------------------------------------------
  try {
    const dailyCard = document.createElement('section');
    dailyCard.className = 'detail-daily-wrap';

    const dailyTitle = document.createElement('h3');
    dailyTitle.className = 'detail-daily-title';
    dailyTitle.textContent = 'Next 7 days';
    dailyCard.appendChild(dailyTitle);

    const todayIso = typeof forecast.current.time === 'string'
      ? forecast.current.time.slice(0, 10)
      : undefined;
    dailyCard.appendChild(renderDailyStrip(forecast.daily, todayIso));

    section.appendChild(dailyCard);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[detail] failed to render daily strip for ${locationName}`, err);
    const fallback = document.createElement('p');
    fallback.className = 'detail-chart-fallback';
    fallback.textContent = 'Could not render the daily forecast.';
    section.appendChild(fallback);
  }

  return section;
}
