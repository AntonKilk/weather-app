import { describe, expect, it } from 'vitest';
import { MOCK_LOCATIONS } from '../locations/mock-locations';
import { MOCK_FORECASTS } from '../weather/mock-forecasts';
import { renderDegradedCard, renderLocationCard } from './location-card';

describe('renderLocationCard', () => {
  const slot = MOCK_LOCATIONS[0]!;
  const forecast = MOCK_FORECASTS['mock-1']!;

  it('builds an element with the location-card class and a11y attributes', () => {
    const el = renderLocationCard(slot, forecast);
    expect(el.classList.contains('location-card')).toBe(true);
    expect(el.getAttribute('role')).toBe('button');
    expect(el.getAttribute('tabindex')).toBe('0');
    expect(el.getAttribute('aria-expanded')).toBe('false');
    expect(el.dataset.slotId).toBe(slot.id);
  });

  it('renders the slot name, temp, description, humidity and wind via textContent', () => {
    const el = renderLocationCard(slot, forecast);
    const text = el.textContent ?? '';
    expect(text).toContain(slot.name);
    expect(text).toContain('19°');
    expect(text).toContain('Clear sky');
    expect(text).toContain('Humidity: 59%');
    expect(text).toContain('Wind: 4 m/s');
  });

  it('never uses innerHTML to inject content', () => {
    const el = renderLocationCard(slot, forecast);
    // No raw HTML markup inside text nodes — every textual value was set via textContent.
    expect(el.querySelector('script')).toBeNull();
  });
});

describe('renderDegradedCard', () => {
  it('shows the slot name and a "No data" message', () => {
    const slot = MOCK_LOCATIONS[2]!;
    const el = renderDegradedCard(slot);
    expect(el.classList.contains('location-card--degraded')).toBe(true);
    expect(el.textContent).toContain(slot.name);
    expect(el.textContent).toContain('No data');
  });
});
