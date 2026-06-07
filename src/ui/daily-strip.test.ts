import { describe, expect, it } from 'vitest';
import type { OpenMeteoDaily } from '../weather/types';
import { renderDailyStrip } from './daily-strip';

function makeDaily(overrides: Partial<OpenMeteoDaily> = {}): OpenMeteoDaily {
  return {
    time: [
      '2026-06-07',
      '2026-06-08',
      '2026-06-09',
      '2026-06-10',
      '2026-06-11',
      '2026-06-12',
      '2026-06-13',
    ],
    weather_code: [1, 3, 61, 2, 80, 95, 2],
    temperature_2m_max: [21, 24, 18, 21, 19, 21, 19],
    temperature_2m_min: [9, 13, 13, 11, 12, 10, 11],
    precipitation_sum: [0, 0.5, 4.2, 0.1, 2.0, 8.0, 0.3],
    ...overrides,
  };
}

describe('renderDailyStrip', () => {
  it('renders 7 cells when daily arrays have 7 entries', () => {
    const strip = renderDailyStrip(makeDaily());
    const cells = strip.querySelectorAll('.detail-daily-cell');
    expect(cells.length).toBe(7);
  });

  it('shows weekday labels in calendar order', () => {
    const strip = renderDailyStrip(makeDaily());
    const weekdays = Array.from(strip.querySelectorAll('.detail-daily-weekday')).map(
      (el) => el.textContent,
    );
    // 2026-06-07 is a Sunday → Sun, Mon, Tue, Wed, Thu, Fri, Sat.
    expect(weekdays).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  });

  it('marks the cell matching todayIso with "Today" + .is-today class', () => {
    const strip = renderDailyStrip(makeDaily(), '2026-06-07');
    const firstCell = strip.querySelector('.detail-daily-cell');
    expect(firstCell?.classList.contains('is-today')).toBe(true);
    expect(firstCell?.querySelector('.detail-daily-weekday')?.textContent).toBe('Today');

    // Other cells stay as weekday labels.
    const secondCell = strip.querySelectorAll('.detail-daily-cell')[1];
    expect(secondCell?.classList.contains('is-today')).toBe(false);
    expect(secondCell?.querySelector('.detail-daily-weekday')?.textContent).toBe('Mon');
  });

  it('renders max/min temperatures with degree sign', () => {
    const strip = renderDailyStrip(makeDaily());
    const firstCell = strip.querySelector('.detail-daily-cell');
    expect(firstCell?.querySelector('.detail-daily-max')?.textContent).toBe('21°');
    expect(firstCell?.querySelector('.detail-daily-min')?.textContent).toBe('9°');
  });

  it('renders a weather icon SVG per cell', () => {
    const strip = renderDailyStrip(makeDaily());
    const icons = strip.querySelectorAll('.detail-daily-cell .weather-icon');
    expect(icons.length).toBe(7);
  });

  it('degrades to the shortest array length without crashing', () => {
    const strip = renderDailyStrip(
      makeDaily({ temperature_2m_min: [9, 13] }), // only 2 mins provided
    );
    const cells = strip.querySelectorAll('.detail-daily-cell');
    expect(cells.length).toBe(2);
  });

  it('renders nothing when all arrays are empty', () => {
    const strip = renderDailyStrip({
      time: [],
      weather_code: [],
      temperature_2m_max: [],
      temperature_2m_min: [],
      precipitation_sum: [],
    });
    expect(strip.querySelectorAll('.detail-daily-cell').length).toBe(0);
  });
});
