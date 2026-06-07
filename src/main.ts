// Entry point — wiring only.
// Real composition (locations, fetch, cache, UI) lands in later stories
// per `.agents/PRDs/offline-weather-pwa.prd.md`.

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

  app.append(heading, note);
}
