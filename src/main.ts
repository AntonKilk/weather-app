// Entry point — wiring only.
// Real composition (locations, fetch, cache, UI) lands in later stories
// per `.agents/PRDs/offline-weather-pwa.prd.md`.

import { createLocationSearchWidget } from './ui/location-search';

const app = document.getElementById('app');

if (app === null) {
  // Nothing to render into — log internally, do not throw in the page.
  // (CLAUDE.md › Observability: console at boundaries.)
  // eslint-disable-next-line no-console
  console.error('[main] #app root element not found in index.html');
} else {
  const heading = document.createElement('h1');
  heading.textContent = 'Weather';

  const note = document.createElement('p');
  note.textContent = 'Scaffold ready. Locations will appear here in upcoming stories.';

  // STORY-008: geocoding autocomplete for custom slots.
  // The widget surfaces a typed { name, lat, lon } selection; STORY-009
  // will own persistence. For now: log + show last selection for the demo.
  const lastPicked = document.createElement('p');
  lastPicked.className = 'last-picked';
  lastPicked.textContent = '';

  const search = createLocationSearchWidget({
    onSelect: (selection) => {
      // eslint-disable-next-line no-console
      console.info('[main] location selected', selection);
      lastPicked.textContent = `Picked: ${selection.name} (${selection.lat.toFixed(4)}, ${selection.lon.toFixed(4)})`;
    },
  });

  app.append(heading, note, search.element, lastPicked);
}
