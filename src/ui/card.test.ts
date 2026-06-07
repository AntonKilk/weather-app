// Tests for the location card — STORY-002 (placeholder, unavailable, full)
// plus STORY-009 add-request / remove flows.
//
// Pure DOM unit tests (no app shell, no fetch). Forecast fixtures come from
// the existing weather fixture set so we don't recreate it here.

import { describe, expect, it, vi } from 'vitest';
import lahtiFixture from '../weather/__fixtures__/forecast-lahti.json' with { type: 'json' };
import type { LocationSlot } from '../locations/types';
import type { OpenMeteoForecast } from '../weather/types';
import { renderLocationCard, type CardItem } from './card';

const FIXTURE = lahtiFixture as unknown as OpenMeteoForecast;

function defaultSlot(name = 'Lahti'): LocationSlot {
  return { kind: 'default', location: { name, lat: 60.98, lon: 25.66 } };
}

function customSlot(name = 'Tallinn'): LocationSlot {
  return { kind: 'custom', location: { name, lat: 59.44, lon: 24.75 } };
}

function emptyCustomSlot(): LocationSlot {
  return { kind: 'custom', location: null };
}

describe('renderLocationCard', () => {
  describe('empty custom placeholder', () => {
    it('is disabled by default (no onAddRequest)', () => {
      const item: CardItem = { slot: emptyCustomSlot(), forecast: null };
      const card = renderLocationCard(item, () => undefined);
      expect(card.disabled).toBe(true);
      expect(card.classList.contains('card--empty')).toBe(true);
      expect(card.textContent).toContain('Add a location');
    });

    it('is enabled and fires onAddRequest when handler is supplied', () => {
      const onAddRequest = vi.fn();
      const onTap = vi.fn();
      const item: CardItem = { slot: emptyCustomSlot(), forecast: null };
      const card = renderLocationCard(item, onTap, { onAddRequest });
      expect(card.disabled).toBe(false);
      card.click();
      expect(onAddRequest).toHaveBeenCalledTimes(1);
      // The "main" tap handler is not used in this state — we don't open
      // detail for a non-existent forecast.
      expect(onTap).not.toHaveBeenCalled();
    });
  });

  describe('populated custom slot', () => {
    it('shows the remove button only when onRemove is provided', () => {
      const withoutRemove = renderLocationCard(
        { slot: customSlot(), forecast: FIXTURE },
        () => undefined,
      );
      expect(withoutRemove.querySelector('.card-remove')).toBeNull();

      const withRemove = renderLocationCard(
        { slot: customSlot(), forecast: FIXTURE },
        () => undefined,
        { onRemove: () => undefined },
      );
      const removeBtn = withRemove.querySelector('.card-remove');
      expect(removeBtn).not.toBeNull();
      expect(removeBtn?.getAttribute('aria-label')).toBe('Remove Tallinn');
    });

    it('remove click fires onRemove and does NOT trigger the card tap', () => {
      const onTap = vi.fn();
      const onRemove = vi.fn();
      const card = renderLocationCard({ slot: customSlot(), forecast: FIXTURE }, onTap, {
        onRemove,
      });
      const removeBtn = card.querySelector('.card-remove') as HTMLElement;
      expect(removeBtn).not.toBeNull();
      removeBtn.click();
      expect(onRemove).toHaveBeenCalledTimes(1);
      expect(onTap).not.toHaveBeenCalled();
    });

    it('keyboard Enter on the remove button also fires onRemove', () => {
      const onRemove = vi.fn();
      const card = renderLocationCard({ slot: customSlot(), forecast: FIXTURE }, () => undefined, {
        onRemove,
      });
      const removeBtn = card.querySelector('.card-remove') as HTMLElement;
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      removeBtn.dispatchEvent(event);
      expect(onRemove).toHaveBeenCalledTimes(1);
    });

    it('still shows the remove button when forecast is unavailable', () => {
      const onRemove = vi.fn();
      const card = renderLocationCard(
        { slot: customSlot('Faraway'), forecast: null },
        () => undefined,
        { onRemove },
      );
      expect(card.textContent).toContain('Unavailable');
      const removeBtn = card.querySelector('.card-remove') as HTMLElement;
      expect(removeBtn).not.toBeNull();
      removeBtn.click();
      expect(onRemove).toHaveBeenCalledTimes(1);
    });
  });

  describe('default slot', () => {
    it('never shows a remove button — defaults are not user-removable', () => {
      const card = renderLocationCard({ slot: defaultSlot(), forecast: FIXTURE }, () => undefined, {
        onRemove: () => undefined,
      });
      expect(card.querySelector('.card-remove')).toBeNull();
    });
  });
});
