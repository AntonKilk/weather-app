import type { LocationSlot } from '../locations/types';
import { sliceHourlyForDay } from '../weather/hourly-slice';
import type { ForecastResponse } from '../weather/types';
import { renderDailyStrip } from './daily-strip';
import { todayCalendarDate } from './format';
import { renderHourlyChart } from './hourly-chart';

// The hourly chart defaults to today; when today is outside the cached daily
// range (very stale cache), fall back to the first forecast day so the chart
// still lines up with the strip's first cell.
function defaultSelectedDay(forecast: ForecastResponse): string | undefined {
  const today = todayCalendarDate();
  const match = forecast.daily.time.find((iso) => iso.slice(0, 10) === today);
  return match ?? forecast.daily.time[0];
}

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

  const data = forecast;
  let selectedDay = defaultSelectedDay(data);

  const chartHolder = document.createElement('div');
  chartHolder.className = 'location-detail__chart-holder';
  section.appendChild(chartHolder);

  function renderChart(): void {
    const hourly =
      selectedDay === undefined ? data.hourly : sliceHourlyForDay(data.hourly, selectedDay);
    try {
      chartHolder.replaceChildren(renderHourlyChart(hourly));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[ui] hourly chart failed', slot.id, err);
      const fallback = document.createElement('p');
      fallback.className = 'location-detail__fallback';
      fallback.textContent = 'Hourly chart unavailable.';
      chartHolder.replaceChildren(fallback);
    }
  }

  renderChart();

  try {
    section.appendChild(
      renderDailyStrip(data.daily, undefined, {
        selectedIso: selectedDay,
        onSelectDay: (dayIso) => {
          selectedDay = dayIso;
          renderChart();
        },
      }),
    );
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
