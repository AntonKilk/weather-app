import './ui/styles.css';
import { parseDefaultLocations } from './locations/default-locations';
import { loadForecasts } from './weather/load-forecasts';
import { renderFooter } from './ui/footer';
import { renderHomeScreen } from './ui/home-screen';
import { registerServiceWorker } from './sw/register';

const app = document.getElementById('app');

if (app === null) {
  // CLAUDE.md › Observability: console at boundaries.
  // eslint-disable-next-line no-console
  console.error('[main] #app root element not found in index.html');
} else {
  void bootstrap(app);
}

// SW registration is independent of paint — never await, never block.
// The wrapper logs lifecycle events and returns without throwing.
registerServiceWorker();

async function bootstrap(root: HTMLElement): Promise<void> {
  const parsed = parseDefaultLocations(import.meta.env.VITE_DEFAULT_LOCATIONS);
  if (!parsed.ok) {
    // eslint-disable-next-line no-console
    console.error(
      `[main] default locations unavailable: ${parsed.error.kind} — ${parsed.error.message}`,
    );
    root.replaceChildren(renderEmptyState('No default locations configured.'), renderFooter());
    return;
  }

  const slots = parsed.data;
  root.replaceChildren(renderLoading(), renderFooter());
  const forecasts = await loadForecasts(slots);
  root.replaceChildren(renderHomeScreen(slots, forecasts), renderFooter());
}

function renderLoading(): HTMLElement {
  const el = document.createElement('p');
  el.className = 'app-loading';
  el.textContent = 'Loading weather…';
  return el;
}

function renderEmptyState(message: string): HTMLElement {
  const el = document.createElement('p');
  el.className = 'app-empty';
  el.textContent = message;
  return el;
}
