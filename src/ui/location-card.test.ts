import { describe, expect, it, vi } from 'vitest';
import type { LocationSlot } from '../locations/types';
import { MOCK_LOCATIONS } from '../locations/mock-locations';
import { MOCK_FORECASTS } from '../weather/mock-forecasts';
import { renderDegradedCard, renderLocationCard } from './location-card';

function customSlotFixture(): LocationSlot {
  return {
    id: 'custom-60.1695-24.9354',
    name: 'Sample Custom',
    latitude: 60.1695,
    longitude: 24.9354,
    kind: 'custom',
  };
}

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

  it('omits the "Updated …" stamp when no stamp is passed', () => {
    const el = renderLocationCard(slot, forecast);
    expect(el.querySelector('.location-card__updated')).toBeNull();
  });

  it('renders the "Updated …" stamp with exactly the provided text when given', () => {
    const el = renderLocationCard(slot, forecast, 'Updated 5 min ago');
    const stamps = el.querySelectorAll('.location-card__updated');
    expect(stamps.length).toBe(1);
    expect(stamps[0]?.textContent).toBe('Updated 5 min ago');
  });

  it('treats an empty-string stamp as "no stamp" (no element appended)', () => {
    const el = renderLocationCard(slot, forecast, '');
    expect(el.querySelector('.location-card__updated')).toBeNull();
  });

  it('renders the stamp via textContent — HTML in the string is escaped, not parsed', () => {
    const el = renderLocationCard(slot, forecast, '<img onerror="alert(1)"/>');
    const stamp = el.querySelector('.location-card__updated');
    expect(stamp).not.toBeNull();
    expect(stamp?.textContent).toBe('<img onerror="alert(1)"/>');
    expect(stamp?.querySelector('img')).toBeNull();
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

  it('omits the stamp when no stamp is passed (existing behaviour preserved)', () => {
    const slot = MOCK_LOCATIONS[2]!;
    const el = renderDegradedCard(slot);
    expect(el.querySelector('.location-card__updated')).toBeNull();
  });

  it('renders the stamp on a degraded card when one is passed (slot has cached data)', () => {
    const slot = MOCK_LOCATIONS[2]!;
    const el = renderDegradedCard(slot, 'Updated 3 h ago');
    expect(el.classList.contains('location-card--degraded')).toBe(true);
    const stamp = el.querySelector('.location-card__updated');
    expect(stamp).not.toBeNull();
    expect(stamp?.textContent).toBe('Updated 3 h ago');
    expect(el.textContent).toContain('No data');
  });
});

describe('renderLocationCard — remove button (STORY-009)', () => {
  const forecast = MOCK_FORECASTS['mock-1']!;

  it('renders a remove button on a custom slot when onRemove is provided', () => {
    const slot = customSlotFixture();
    const el = renderLocationCard(slot, forecast, undefined, { onRemove: () => {} });
    const button = el.querySelector<HTMLButtonElement>('button.location-card__remove');
    expect(button).not.toBeNull();
    expect(button?.type).toBe('button');
    expect(button?.getAttribute('aria-label')).toBe(`Remove ${slot.name}`);
  });

  it('does NOT render a remove button on a default slot, even if onRemove is provided', () => {
    const slot = MOCK_LOCATIONS[0]!;
    expect(slot.kind).toBe('default');
    const el = renderLocationCard(slot, forecast, undefined, { onRemove: () => {} });
    expect(el.querySelector('button.location-card__remove')).toBeNull();
  });

  it('does NOT render a remove button when callbacks/onRemove is absent', () => {
    const slot = customSlotFixture();
    const a = renderLocationCard(slot, forecast);
    const b = renderLocationCard(slot, forecast, undefined, {});
    expect(a.querySelector('button.location-card__remove')).toBeNull();
    expect(b.querySelector('button.location-card__remove')).toBeNull();
  });

  it('click on remove button calls onRemove(slot.id) and stops propagation', () => {
    const slot = customSlotFixture();
    const onRemove = vi.fn<(id: string) => void>();
    const parentClick = vi.fn();
    const el = renderLocationCard(slot, forecast, undefined, { onRemove });
    const parent = document.createElement('div');
    parent.addEventListener('click', parentClick);
    parent.appendChild(el);
    document.body.appendChild(parent);
    const button = el.querySelector<HTMLButtonElement>('button.location-card__remove')!;

    button.click();

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith(slot.id);
    expect(parentClick).not.toHaveBeenCalled();
    parent.remove();
  });

  it('renders a remove button on a custom degraded card too', () => {
    const slot = customSlotFixture();
    const el = renderDegradedCard(slot, undefined, { onRemove: () => {} });
    const button = el.querySelector<HTMLButtonElement>('button.location-card__remove');
    expect(button).not.toBeNull();
    expect(button?.getAttribute('aria-label')).toBe(`Remove ${slot.name}`);
  });
});
