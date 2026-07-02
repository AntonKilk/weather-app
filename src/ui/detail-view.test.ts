import { afterEach, describe, expect, it } from 'vitest';
import type { LocationSlot } from '../locations/types';
import type { ForecastResponse } from '../weather/types';
import { renderDetailView } from './detail-view';

afterEach(() => {
  document.body.replaceChildren();
});

const SLOT: LocationSlot = {
  id: 'slot-1',
  name: 'Testville',
  latitude: 60,
  longitude: 25,
  kind: 'default',
};

// Two calendar days of hourly data with flat, distinct temperatures so the
// chart's rendered values identify which day is on screen: day one = 10°,
// day two = 20°. Dates are in the past so the real "today" never matches —
// the detail view must fall back to the first forecast day.
function twoDayForecast(): ForecastResponse {
  const time: string[] = [];
  const temperature_2m: number[] = [];
  for (const day of ['2020-01-01', '2020-01-02']) {
    for (let h = 0; h < 24; h++) {
      time.push(`${day}T${String(h).padStart(2, '0')}:00`);
      temperature_2m.push(day === '2020-01-01' ? 10 : 20);
    }
  }
  return {
    latitude: 60,
    longitude: 25,
    timezone: 'Europe/Helsinki',
    current: {
      time: '2020-01-01T12:00',
      temperature_2m: 10,
      relative_humidity_2m: 50,
      weather_code: 0,
      wind_speed_10m: 3,
    },
    hourly: {
      time,
      temperature_2m,
      precipitation: time.map(() => 0),
      precipitation_probability: time.map(() => 0),
      weather_code: time.map(() => 0),
    },
    daily: {
      time: ['2020-01-01', '2020-01-02'],
      weather_code: [0, 61],
      temperature_2m_max: [12, 22],
      temperature_2m_min: [8, 18],
      precipitation_sum: [0, 4],
    },
  };
}

function chartValues(detail: HTMLElement): string[] {
  return Array.from(detail.querySelectorAll('.hourly-chart__value')).map(
    (el) => el.textContent ?? '',
  );
}

describe('renderDetailView day switching', () => {
  it('defaults the hourly chart to the first forecast day', () => {
    const detail = renderDetailView(SLOT, twoDayForecast());
    document.body.appendChild(detail);
    const values = chartValues(detail);
    expect(values.length).toBeGreaterThan(0);
    expect(values.every((v) => v === '10°')).toBe(true);
    const cells = detail.querySelectorAll<HTMLElement>('.daily-strip__cell');
    expect(cells[0]!.classList.contains('daily-strip__cell--selected')).toBe(true);
  });

  it('switches the hourly chart to the tapped day', () => {
    const detail = renderDetailView(SLOT, twoDayForecast());
    document.body.appendChild(detail);
    const buttons = detail.querySelectorAll<HTMLButtonElement>('.daily-strip__button');
    expect(buttons.length).toBe(2);
    buttons[1]!.click();
    const values = chartValues(detail);
    expect(values.length).toBeGreaterThan(0);
    expect(values.every((v) => v === '20°')).toBe(true);
    expect(detail.querySelectorAll('svg.hourly-chart').length).toBe(1);
    const cells = detail.querySelectorAll<HTMLElement>('.daily-strip__cell');
    expect(cells[1]!.classList.contains('daily-strip__cell--selected')).toBe(true);
    expect(cells[0]!.classList.contains('daily-strip__cell--selected')).toBe(false);
  });

  it('switching back restores the first day', () => {
    const detail = renderDetailView(SLOT, twoDayForecast());
    document.body.appendChild(detail);
    const buttons = detail.querySelectorAll<HTMLButtonElement>('.daily-strip__button');
    buttons[1]!.click();
    buttons[0]!.click();
    const values = chartValues(detail);
    expect(values.every((v) => v === '10°')).toBe(true);
  });

  it('shows the hourly fallback when the selected day has no hourly data', () => {
    const forecast = twoDayForecast();
    forecast.daily.time.push('2020-01-03');
    forecast.daily.weather_code.push(0);
    forecast.daily.temperature_2m_max.push(15);
    forecast.daily.temperature_2m_min.push(5);
    forecast.daily.precipitation_sum.push(0);

    const detail = renderDetailView(SLOT, forecast);
    document.body.appendChild(detail);
    const buttons = detail.querySelectorAll<HTMLButtonElement>('.daily-strip__button');
    buttons[2]!.click();
    expect(detail.querySelector('svg.hourly-chart')).toBeNull();
    expect(detail.textContent).toContain('Hourly data unavailable.');
  });
});
