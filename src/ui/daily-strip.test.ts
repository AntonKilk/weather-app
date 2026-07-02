import { afterEach, describe, expect, it } from 'vitest';
import { MOCK_FORECASTS } from '../weather/mock-forecasts';
import type { DailyForecast } from '../weather/types';
import { renderDailyStrip } from './daily-strip';

afterEach(() => {
  document.body.replaceChildren();
});

describe('renderDailyStrip', () => {
  it('renders 7 cells from a 7-day mock', () => {
    const strip = renderDailyStrip(MOCK_FORECASTS['mock-1']!.daily, '2026-06-07');
    document.body.appendChild(strip);
    expect(strip.classList.contains('daily-strip')).toBe(true);
    const cells = strip.querySelectorAll('.daily-strip__cell');
    expect(cells.length).toBe(7);
  });

  it('marks the cell matching todayIso with the today modifier and "Today" label', () => {
    const strip = renderDailyStrip(MOCK_FORECASTS['mock-1']!.daily, '2026-06-07');
    const first = strip.querySelector<HTMLElement>('.daily-strip__cell');
    expect(first).not.toBeNull();
    expect(first!.classList.contains('daily-strip__cell--today')).toBe(true);
    expect(first!.querySelector('.daily-strip__day')!.textContent).toBe('Today');
  });

  it('renders subsequent cells with English weekday short labels', () => {
    const strip = renderDailyStrip(MOCK_FORECASTS['mock-1']!.daily, '2026-06-07');
    const cells = strip.querySelectorAll<HTMLElement>('.daily-strip__cell');
    expect(cells.length).toBeGreaterThan(1);
    const second = cells[1]!;
    const day = second.querySelector('.daily-strip__day')!.textContent ?? '';
    expect(day).toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/);
  });

  it('includes a weather icon and a max/min temperature pair in each cell', () => {
    const strip = renderDailyStrip(MOCK_FORECASTS['mock-3']!.daily, '2026-06-07');
    const cells = strip.querySelectorAll<HTMLElement>('.daily-strip__cell');
    for (const cell of cells) {
      expect(cell.querySelector('svg.weather-icon')).not.toBeNull();
      expect(cell.querySelector('.daily-strip__max')!.textContent).toMatch(/-?\d+°/);
      expect(cell.querySelector('.daily-strip__min')!.textContent).toMatch(/-?\d+°/);
    }
  });

  it('marks the cell matching selectedIso with the selected modifier and aria-pressed', () => {
    const strip = renderDailyStrip(MOCK_FORECASTS['mock-1']!.daily, '2026-06-07', {
      selectedIso: '2026-06-09',
    });
    const cells = strip.querySelectorAll<HTMLElement>('.daily-strip__cell');
    expect(cells[2]!.classList.contains('daily-strip__cell--selected')).toBe(true);
    expect(cells[0]!.classList.contains('daily-strip__cell--selected')).toBe(false);
    const buttons = strip.querySelectorAll<HTMLButtonElement>('.daily-strip__button');
    expect(buttons[2]!.getAttribute('aria-pressed')).toBe('true');
    expect(buttons[0]!.getAttribute('aria-pressed')).toBe('false');
  });

  it('reports the tapped day via onSelectDay and moves the selected highlight', () => {
    const seen: string[] = [];
    const strip = renderDailyStrip(MOCK_FORECASTS['mock-1']!.daily, '2026-06-07', {
      selectedIso: '2026-06-07',
      onSelectDay: (iso) => seen.push(iso),
    });
    document.body.appendChild(strip);
    const buttons = strip.querySelectorAll<HTMLButtonElement>('.daily-strip__button');
    buttons[3]!.click();
    expect(seen).toEqual(['2026-06-10']);
    const cells = strip.querySelectorAll<HTMLElement>('.daily-strip__cell');
    expect(cells[3]!.classList.contains('daily-strip__cell--selected')).toBe(true);
    expect(cells[0]!.classList.contains('daily-strip__cell--selected')).toBe(false);
    expect(buttons[3]!.getAttribute('aria-pressed')).toBe('true');
    expect(buttons[0]!.getAttribute('aria-pressed')).toBe('false');
  });

  it('renders an empty-state fallback when the daily forecast has no entries', () => {
    const empty: DailyForecast = {
      time: [],
      weather_code: [],
      temperature_2m_max: [],
      temperature_2m_min: [],
      precipitation_sum: [],
    };
    const strip = renderDailyStrip(empty, '2026-06-07');
    expect(strip.classList.contains('daily-strip--empty')).toBe(true);
    const fallback = strip.querySelector('.daily-strip__fallback');
    expect(fallback).not.toBeNull();
    expect(fallback!.textContent).toBe('Daily forecast unavailable.');
  });
});
