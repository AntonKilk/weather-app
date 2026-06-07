// End-to-end DOM smoke test for the Phase-1 UI skeleton (STORY-002).
//
// Renders the full app shell into a jsdom document with all four mock
// locations, asserts the list view, simulates a tap on a card, asserts the
// detail view appears, then taps Back and asserts the list returns.

import { describe, expect, it } from 'vitest';
import { MOCK_DEFAULT_LOCATIONS } from '../locations/defaults';
import type { LocationSlot } from '../locations/types';
import { pickForecastForName } from '../weather/mocks';
import { renderApp, type AppItem } from './app';

function buildItems(): ReadonlyArray<AppItem> {
  const slots: ReadonlyArray<LocationSlot> = MOCK_DEFAULT_LOCATIONS.map((location) => ({
    kind: 'default',
    location,
  }));
  return slots.map((slot) => ({
    slot,
    forecast: slot.location !== null ? pickForecastForName(slot.location.name) : null,
  }));
}

describe('renderApp (UI skeleton smoke)', () => {
  it('renders 4 location cards on the list view with title and footer attribution', () => {
    const root = document.createElement('div');
    renderApp(root, buildItems());

    const title = root.querySelector('.app-header h1');
    expect(title?.textContent).toBe('Weather');

    const cards = root.querySelectorAll('main.list button.card');
    expect(cards.length).toBe(4);

    const names = Array.from(root.querySelectorAll('main.list .card-name')).map(
      (el) => el.textContent,
    );
    expect(names).toEqual(['Lahti', 'Helsinki', 'Tallinn', 'Käsmu']);

    const footerLink = root.querySelector('.app-footer a');
    expect(footerLink?.textContent).toBe('Weather data by Open-Meteo');
    expect(footerLink?.getAttribute('href')).toBe('https://open-meteo.com/');
    expect(footerLink?.getAttribute('rel')).toContain('noopener');
  });

  it('renders weather metadata on each card (temp, humidity, wind)', () => {
    const root = document.createElement('div');
    renderApp(root, buildItems());

    const firstCard = root.querySelector('main.list button.card');
    expect(firstCard).not.toBeNull();
    if (firstCard === null) return;

    expect(firstCard.querySelector('.card-temp')?.textContent).toMatch(/^-?\d+°$/);
    const meta = firstCard.querySelector('.card-meta');
    expect(meta?.textContent).toContain('Humidity');
    expect(meta?.textContent).toContain('Wind');
    expect(meta?.textContent).toMatch(/\d+%/);
    expect(meta?.textContent).toContain('m/s');
  });

  it('opens detail view when a card is tapped and returns to list on Back', () => {
    const root = document.createElement('div');
    renderApp(root, buildItems());

    const firstCard = root.querySelector('main.list button.card');
    expect(firstCard).not.toBeNull();
    if (firstCard === null) return;
    (firstCard as HTMLButtonElement).click();

    // Detail view replaces the list-view subtree.
    expect(root.querySelector('main.list')).toBeNull();
    const detail = root.querySelector('section.detail');
    expect(detail).not.toBeNull();

    const detailName = detail?.querySelector('.detail-name');
    expect(detailName?.textContent).toBe('Lahti');

    // STORY-003 replaced the placeholder block with the hourly chart and
    // 7-day strip; the placeholder should be gone and the new sections present.
    expect(detail?.querySelector('.detail-placeholder')).toBeNull();
    expect(detail?.querySelector('.detail-chart svg')).not.toBeNull();
    expect(detail?.querySelector('.detail-daily')).not.toBeNull();

    const back = detail?.querySelector('button.detail-back') as HTMLButtonElement | null;
    expect(back).not.toBeNull();
    if (back === null) return;
    expect(back.textContent).toContain('Back');
    back.click();

    expect(root.querySelector('section.detail')).toBeNull();
    expect(root.querySelectorAll('main.list button.card').length).toBe(4);
  });

  it('handles unavailable forecast gracefully (no detail navigation)', () => {
    const root = document.createElement('div');
    const items: ReadonlyArray<AppItem> = [
      {
        slot: { kind: 'default', location: { name: 'Nowhere', lat: 0, lon: 0 } },
        forecast: null,
      },
    ];
    renderApp(root, items);

    const card = root.querySelector('button.card');
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain('Nowhere');
    expect(card?.textContent).toContain('Unavailable');

    // Click — should remain on list view (no forecast → no detail).
    (card as HTMLButtonElement).click();
    expect(root.querySelector('section.detail')).toBeNull();
    expect(root.querySelector('main.list')).not.toBeNull();
  });

  it('renders an empty custom slot as a disabled "+ Add a location" placeholder', () => {
    const root = document.createElement('div');
    const items: ReadonlyArray<AppItem> = [
      { slot: { kind: 'custom', location: null }, forecast: null },
    ];
    renderApp(root, items);

    const card = root.querySelector('button.card');
    expect(card).not.toBeNull();
    expect(card?.classList.contains('card--empty')).toBe(true);
    expect((card as HTMLButtonElement).disabled).toBe(true);
    expect(card?.textContent).toContain('Add a location');
  });
});
