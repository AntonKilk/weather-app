import './ui/styles.css';
import { parseDefaultLocations } from './locations/default-locations';
import type { LocationSlot } from './locations/types';
import { createForecastCache, type CacheSnapshot } from './storage/forecast-cache';
import { revalidate } from './storage/revalidate';
import { REVALIDATE_THRESHOLD_MS, anyStale } from './storage/staleness';
import { registerServiceWorker } from './sw/register';
import { renderFooter } from './ui/footer';
import { renderHomeScreen } from './ui/home-screen';
import { fetchForecast } from './weather/open-meteo-client';
import type { ForecastResponse } from './weather/types';

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
  const cache = createForecastCache();

  // First paint: render from cache before any network. < 2 s and works
  // offline. When the cache is empty (first launch), show the loading
  // placeholder until revalidate resolves.
  const initial = cache.read();
  let snapshot: CacheSnapshot = initial.ok ? initial.data : {};
  if (Object.keys(snapshot).length === 0) {
    root.replaceChildren(renderLoading(), renderFooter());
  } else {
    render(root, slots, snapshot);
  }

  // Stale-while-revalidate: fetch in parallel, swap in fresh data.
  const cycle = await revalidate(slots, { cache, fetchForecast, now: Date.now });
  snapshot = cycle.snapshot;
  render(root, slots, snapshot);

  // visibilitychange refresh: when the tab returns AND cache is older
  // than 30 min AND the browser is online, kick another revalidate
  // cycle. Gated by an in-flight boolean so back-to-back focus events
  // don't stack.
  let revalidating = false;
  document.addEventListener('visibilitychange', () => {
    void onVisibilityChange();
  });

  async function onVisibilityChange(): Promise<void> {
    if (document.visibilityState !== 'visible') return;
    if (revalidating) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    const slotIds = slots.map((s) => s.id);
    if (!anyStale(Date.now(), snapshot, slotIds, REVALIDATE_THRESHOLD_MS)) {
      return;
    }
    revalidating = true;
    try {
      const next = await revalidate(slots, { cache, fetchForecast, now: Date.now });
      snapshot = next.snapshot;
      render(root, slots, snapshot);
    } finally {
      revalidating = false;
    }
  }
}

function render(root: HTMLElement, slots: LocationSlot[], snapshot: CacheSnapshot): void {
  const forecasts: Record<string, ForecastResponse> = {};
  const lastUpdated: Record<string, number | undefined> = {};
  for (const [id, entry] of Object.entries(snapshot)) {
    forecasts[id] = entry.forecast;
    lastUpdated[id] = entry.fetchedAt;
  }
  root.replaceChildren(
    renderHomeScreen(slots, forecasts, lastUpdated, Date.now()),
    renderFooter(),
  );
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
