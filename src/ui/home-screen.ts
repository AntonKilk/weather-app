import type { LocationSlot } from '../locations/types';
import type { ForecastResponse } from '../weather/types';
import { renderDetailPlaceholder } from './detail-view';
import { renderDegradedCard, renderLocationCard } from './location-card';

export function renderHomeScreen(
  slots: LocationSlot[],
  forecasts: Record<string, ForecastResponse>,
): HTMLElement {
  const main = document.createElement('main');
  main.className = 'locations-grid';

  type SlotElements = { card: HTMLElement; detail: HTMLElement };
  const bySlot = new Map<string, SlotElements>();

  for (const slot of slots) {
    let card: HTMLElement;
    const forecast = forecasts[slot.id];

    try {
      if (forecast === undefined) {
        card = renderDegradedCard(slot);
      } else {
        card = renderLocationCard(slot, forecast);
      }
    } catch (err) {
      // Per CLAUDE.md › Error handling: one bad slot must not break the others.
      console.error('[ui] failed to render slot', slot.id, err);
      card = renderDegradedCard(slot);
    }

    const detail = renderDetailPlaceholder(slot);
    card.setAttribute('aria-controls', detail.id);

    bySlot.set(slot.id, { card, detail });
    main.append(card, detail);
  }

  let expandedId: string | null = null;

  const toggle = (slotId: string): void => {
    if (expandedId !== null && expandedId !== slotId) {
      const previous = bySlot.get(expandedId);
      if (previous !== undefined) {
        previous.card.setAttribute('aria-expanded', 'false');
        previous.detail.hidden = true;
      }
    }

    const current = bySlot.get(slotId);
    if (current === undefined) {
      return;
    }

    if (expandedId === slotId) {
      current.card.setAttribute('aria-expanded', 'false');
      current.detail.hidden = true;
      expandedId = null;
    } else {
      current.card.setAttribute('aria-expanded', 'true');
      current.detail.hidden = false;
      expandedId = slotId;
    }
  };

  const findCard = (target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof Element)) {
      return null;
    }
    const card = target.closest<HTMLElement>('.location-card');
    return card !== null && main.contains(card) ? card : null;
  };

  main.addEventListener('click', (event) => {
    const card = findCard(event.target);
    if (card === null) {
      return;
    }
    const slotId = card.dataset.slotId;
    if (slotId !== undefined) {
      toggle(slotId);
    }
  });

  main.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    const card = findCard(event.target);
    if (card === null) {
      return;
    }
    event.preventDefault();
    const slotId = card.dataset.slotId;
    if (slotId !== undefined) {
      toggle(slotId);
    }
  });

  return main;
}
