import { afterEach, describe, expect, it, vi } from 'vitest';
import { MOCK_LOCATIONS } from '../locations/mock-locations';
import type { LocationSlot } from '../locations/types';
import { MOCK_FORECASTS } from '../weather/mock-forecasts';
import type { ForecastResponse } from '../weather/types';
import { renderHomeScreen } from './home-screen';

function mount(grid: HTMLElement): void {
  document.body.append(grid);
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('renderHomeScreen', () => {
  it('renders one card per slot with its detail panel collapsed', () => {
    const grid = renderHomeScreen(MOCK_LOCATIONS, MOCK_FORECASTS);
    mount(grid);
    const cards = grid.querySelectorAll('.location-card');
    expect(cards.length).toBe(MOCK_LOCATIONS.length);
    const details = grid.querySelectorAll('.location-detail');
    expect(details.length).toBe(MOCK_LOCATIONS.length);
    details.forEach((d) => {
      expect((d as HTMLElement).hidden).toBe(true);
    });
  });

  it('wires aria-controls between each card and its detail panel', () => {
    const grid = renderHomeScreen(MOCK_LOCATIONS, MOCK_FORECASTS);
    mount(grid);
    const firstCard = grid.querySelector<HTMLElement>('.location-card');
    expect(firstCard).not.toBeNull();
    const detailId = firstCard!.getAttribute('aria-controls');
    expect(detailId).toBe(`detail-${MOCK_LOCATIONS[0]!.id}`);
    expect(document.getElementById(detailId!)).not.toBeNull();
  });

  it('expands a card on click and collapses it again on second click', () => {
    const grid = renderHomeScreen(MOCK_LOCATIONS, MOCK_FORECASTS);
    mount(grid);
    const card = grid.querySelector<HTMLElement>('.location-card')!;
    const detail = document.getElementById(card.getAttribute('aria-controls')!) as HTMLElement;

    card.click();
    expect(card.getAttribute('aria-expanded')).toBe('true');
    expect(detail.hidden).toBe(false);

    card.click();
    expect(card.getAttribute('aria-expanded')).toBe('false');
    expect(detail.hidden).toBe(true);
  });

  it('single-expand: opening a second card collapses the first', () => {
    const grid = renderHomeScreen(MOCK_LOCATIONS, MOCK_FORECASTS);
    mount(grid);
    const cards = grid.querySelectorAll<HTMLElement>('.location-card');
    const first = cards[0]!;
    const second = cards[1]!;
    const firstDetail = document.getElementById(first.getAttribute('aria-controls')!) as HTMLElement;
    const secondDetail = document.getElementById(second.getAttribute('aria-controls')!) as HTMLElement;

    first.click();
    expect(first.getAttribute('aria-expanded')).toBe('true');
    expect(firstDetail.hidden).toBe(false);

    second.click();
    expect(first.getAttribute('aria-expanded')).toBe('false');
    expect(firstDetail.hidden).toBe(true);
    expect(second.getAttribute('aria-expanded')).toBe('true');
    expect(secondDetail.hidden).toBe(false);
  });

  it('toggles on Enter and Space keypresses', () => {
    const grid = renderHomeScreen(MOCK_LOCATIONS, MOCK_FORECASTS);
    mount(grid);
    const card = grid.querySelector<HTMLElement>('.location-card')!;
    const detail = document.getElementById(card.getAttribute('aria-controls')!) as HTMLElement;

    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(detail.hidden).toBe(false);

    card.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(detail.hidden).toBe(true);
  });

  it('isolates faults: one slot missing a forecast renders degraded, others render normally', () => {
    const partial: Record<string, (typeof MOCK_FORECASTS)[string]> = {
      'mock-1': MOCK_FORECASTS['mock-1']!,
      'mock-2': MOCK_FORECASTS['mock-2']!,
      // 'mock-3' deliberately omitted
      'mock-4': MOCK_FORECASTS['mock-4']!,
    };
    const grid = renderHomeScreen(MOCK_LOCATIONS, partial);
    mount(grid);
    const cards = grid.querySelectorAll<HTMLElement>('.location-card');
    expect(cards.length).toBe(MOCK_LOCATIONS.length);
    const degraded = grid.querySelector<HTMLElement>('.location-card--degraded');
    expect(degraded).not.toBeNull();
    expect(degraded!.dataset.slotId).toBe('mock-3');
    expect(degraded!.textContent).toContain('No data');
  });

  it('expanded detail panel contains an hourly-chart svg and a 7-day strip', () => {
    const grid = renderHomeScreen(MOCK_LOCATIONS, MOCK_FORECASTS);
    mount(grid);
    const first = grid.querySelector<HTMLElement>('.location-card')!;
    first.click();
    const detail = document.getElementById('detail-mock-1')!;
    expect(detail.hidden).toBe(false);
    expect(detail.querySelectorAll('svg.hourly-chart').length).toBe(1);
    const strip = detail.querySelector<HTMLElement>('ul.daily-strip')!;
    expect(strip).not.toBeNull();
    expect(strip.querySelectorAll('.daily-strip__cell').length).toBe(7);
  });

  it('renders "Updated …" stamps on every card when lastUpdated is provided', () => {
    const now = 1_700_000_000_000;
    const lastUpdated: Record<string, number | undefined> = {};
    for (const s of MOCK_LOCATIONS) {
      lastUpdated[s.id] = now - 5 * 60 * 1000; // 5 min ago for all
    }
    const grid = renderHomeScreen(MOCK_LOCATIONS, MOCK_FORECASTS, lastUpdated, now);
    mount(grid);
    const stamps = grid.querySelectorAll('.location-card__updated');
    expect(stamps.length).toBe(MOCK_LOCATIONS.length);
    for (const s of stamps) {
      expect(s.textContent).toBe('Updated 5 min ago');
    }
  });

  it('omits stamps when lastUpdated is absent (back-compat with pre-STORY-007 callers)', () => {
    const grid = renderHomeScreen(MOCK_LOCATIONS, MOCK_FORECASTS);
    mount(grid);
    expect(grid.querySelectorAll('.location-card__updated').length).toBe(0);
  });

  it('renders a stamp on a degraded card when the slot has a cached fetchedAt but no live forecast', () => {
    const now = 1_700_000_000_000;
    const partial: Record<string, (typeof MOCK_FORECASTS)[string]> = {
      'mock-1': MOCK_FORECASTS['mock-1']!,
      'mock-2': MOCK_FORECASTS['mock-2']!,
      'mock-4': MOCK_FORECASTS['mock-4']!,
    };
    const lastUpdated: Record<string, number | undefined> = {
      'mock-3': now - 2 * 60 * 60 * 1000, // 2 h ago
    };
    const grid = renderHomeScreen(MOCK_LOCATIONS, partial, lastUpdated, now);
    mount(grid);
    const degraded = grid.querySelector<HTMLElement>('.location-card--degraded')!;
    expect(degraded.dataset.slotId).toBe('mock-3');
    const stamp = degraded.querySelector('.location-card__updated');
    expect(stamp).not.toBeNull();
    expect(stamp?.textContent).toBe('Updated 2 h ago');
  });

  it('renders a remove button on each custom-kind slot when onRemove is provided', () => {
    const baseForecast = MOCK_FORECASTS['mock-1']!;
    const slots: LocationSlot[] = [
      { id: 'default-0', name: 'Default A', latitude: 0, longitude: 0, kind: 'default' },
      {
        id: 'custom-60.0000-24.0000',
        name: 'Custom A',
        latitude: 60,
        longitude: 24,
        kind: 'custom',
      },
      {
        id: 'custom-59.0000-24.0000',
        name: 'Custom B',
        latitude: 59,
        longitude: 24,
        kind: 'custom',
      },
    ];
    const forecasts: Record<string, ForecastResponse> = {
      'default-0': baseForecast,
      'custom-60.0000-24.0000': baseForecast,
      'custom-59.0000-24.0000': baseForecast,
    };
    const grid = renderHomeScreen(slots, forecasts, undefined, Date.now(), { onRemove: () => {} });
    mount(grid);
    const buttons = grid.querySelectorAll('button.location-card__remove');
    expect(buttons.length).toBe(2);
    const defaultCard = grid.querySelector<HTMLElement>('[data-slot-id="default-0"]')!;
    expect(defaultCard.querySelector('button.location-card__remove')).toBeNull();
  });

  it('clicking remove on a custom card calls onRemove and does NOT expand the card', () => {
    const baseForecast = MOCK_FORECASTS['mock-1']!;
    const slots: LocationSlot[] = [
      {
        id: 'custom-60.0000-24.0000',
        name: 'Custom A',
        latitude: 60,
        longitude: 24,
        kind: 'custom',
      },
    ];
    const forecasts: Record<string, ForecastResponse> = {
      'custom-60.0000-24.0000': baseForecast,
    };
    const onRemove = vi.fn<(id: string) => void>();
    const grid = renderHomeScreen(slots, forecasts, undefined, Date.now(), { onRemove });
    mount(grid);
    const card = grid.querySelector<HTMLElement>('.location-card')!;
    const button = card.querySelector<HTMLButtonElement>('button.location-card__remove')!;

    button.click();

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith('custom-60.0000-24.0000');
    expect(card.getAttribute('aria-expanded')).toBe('false');
    const detail = document.getElementById(card.getAttribute('aria-controls')!) as HTMLElement;
    expect(detail.hidden).toBe(true);
  });

  it('shows the empty-state message in the detail panel when a slot has no forecast', () => {
    const partial: Record<string, (typeof MOCK_FORECASTS)[string]> = {
      'mock-1': MOCK_FORECASTS['mock-1']!,
      'mock-2': MOCK_FORECASTS['mock-2']!,
      'mock-4': MOCK_FORECASTS['mock-4']!,
    };
    const grid = renderHomeScreen(MOCK_LOCATIONS, partial);
    mount(grid);
    const degraded = grid.querySelector<HTMLElement>('.location-card--degraded')!;
    degraded.click();
    const detail = document.getElementById('detail-mock-3')!;
    expect(detail.hidden).toBe(false);
    expect(detail.textContent).toContain('No data available for this location.');
    expect(detail.querySelector('svg.hourly-chart')).toBeNull();
    expect(detail.querySelector('ul.daily-strip')).toBeNull();
  });
});
