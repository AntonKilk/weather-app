// Entry point — wiring only (CLAUDE.md › Architecture).
//
// Phase 1: hard-coded mock data per STORY-002. The real env-driven location list
// and Open-Meteo client come in STORY-005 / STORY-004.

import './ui/styles.css';
import { MOCK_DEFAULT_LOCATIONS } from './locations/defaults';
import type { LocationSlot } from './locations/types';
import { renderApp, type AppItem } from './ui/app';
import { pickForecastForName } from './weather/mocks';

const root = document.getElementById('app');

if (root === null) {
  // Nothing to render into — log internally, do not throw in the page.
  // (CLAUDE.md › Observability: console at boundaries.)
  // eslint-disable-next-line no-console
  console.error('[main] #app root element not found in index.html');
} else {
  const slots: ReadonlyArray<LocationSlot> = MOCK_DEFAULT_LOCATIONS.map((location) => ({
    kind: 'default',
    location,
  }));

  const items: ReadonlyArray<AppItem> = slots.map((slot) => ({
    slot,
    forecast: slot.location !== null ? pickForecastForName(slot.location.name) : null,
  }));

  renderApp(root, items);
}
