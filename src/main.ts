import './ui/styles.css';
import {
  addCustomSlot,
  canAddCustomSlot,
  findExistingCustomSlot,
  placeToSlot,
  removeCustomSlot,
} from './locations/custom-slots';
import { parseDefaultLocations } from './locations/default-locations';
import { searchGeocoding } from './locations/geocoding-client';
import type { GeocodingPlace } from './locations/types';
import type { LocationSlot } from './locations/types';
import { createCustomSlotsStore } from './storage/custom-slots-store';
import { createForecastCache, type CacheSnapshot } from './storage/forecast-cache';
import { revalidate } from './storage/revalidate';
import { REVALIDATE_THRESHOLD_MS, anyStale } from './storage/staleness';
import { registerServiceWorker } from './sw/register';
import { renderFooter } from './ui/footer';
import { renderHomeScreen } from './ui/home-screen';
import { renderSearchInput } from './ui/search-input';
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
  const defaultSlots = parsed.data;

  const cache = createForecastCache();
  const slotsStore = createCustomSlotsStore();
  const customRead = slotsStore.read();
  let customSlots: LocationSlot[] = customRead.ok ? customRead.data : [];
  if (
    !customRead.ok &&
    customRead.reason.kind !== 'absent' &&
    customRead.reason.kind !== 'unsupported'
  ) {
    console.warn('[main] custom slots read failure:', customRead.reason);
  }

  const content = document.createElement('div');
  content.className = 'app-content';
  let searchEl = mountSearchOrNotice();
  root.replaceChildren(searchEl, content);

  // First paint: render from cache before any network. < 2 s and works
  // offline. When the cache is empty (first launch), show the loading
  // placeholder until revalidate resolves.
  const initial = cache.read();
  let snapshot: CacheSnapshot = initial.ok ? initial.data : {};
  if (Object.keys(snapshot).length === 0) {
    content.replaceChildren(renderLoading(), renderFooter());
  } else {
    renderGrid();
  }

  // Stale-while-revalidate: fetch in parallel, swap in fresh data.
  const cycle = await revalidate(mergedSlots(), { cache, fetchForecast, now: Date.now });
  snapshot = cycle.snapshot;
  renderGrid();

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
    const slots = mergedSlots();
    const slotIds = slots.map((s) => s.id);
    if (!anyStale(Date.now(), snapshot, slotIds, REVALIDATE_THRESHOLD_MS)) {
      return;
    }
    revalidating = true;
    try {
      const next = await revalidate(slots, { cache, fetchForecast, now: Date.now });
      snapshot = next.snapshot;
      renderGrid();
    } finally {
      revalidating = false;
    }
  }

  function mergedSlots(): LocationSlot[] {
    return [...defaultSlots, ...customSlots];
  }

  function renderGrid(): void {
    content.replaceChildren(
      renderHomeScreen(mergedSlots(), forecastsFromSnapshot(), lastUpdatedFromSnapshot(), Date.now(), {
        onRemove: handleRemove,
      }),
      renderFooter(),
    );
  }

  function forecastsFromSnapshot(): Record<string, ForecastResponse> {
    const out: Record<string, ForecastResponse> = {};
    for (const [id, entry] of Object.entries(snapshot)) {
      out[id] = entry.forecast;
    }
    return out;
  }

  function lastUpdatedFromSnapshot(): Record<string, number | undefined> {
    const out: Record<string, number | undefined> = {};
    for (const [id, entry] of Object.entries(snapshot)) {
      out[id] = entry.fetchedAt;
    }
    return out;
  }

  function mountSearchOrNotice(): HTMLElement {
    if (canAddCustomSlot(customSlots)) {
      return renderSearchInput({
        searchGeocoding: (query, signal) => searchGeocoding(query, { signal }),
        onSelect: (place) => {
          void handleSelect(place);
        },
      });
    }
    const notice = document.createElement('p');
    notice.className = 'custom-slots-full';
    notice.textContent = 'Custom slots full — remove one to add another';
    return notice;
  }

  function remountSearch(): void {
    const next = mountSearchOrNotice();
    root.replaceChild(next, searchEl);
    searchEl = next;
  }

  async function handleSelect(place: GeocodingPlace): Promise<void> {
    const placeResult = placeToSlot(place);
    if (!placeResult.ok) {
      console.warn('[custom-slots] place rejected:', placeResult.reason);
      return;
    }
    const existing = findExistingCustomSlot(customSlots, place);
    if (existing !== null) {
      console.info('[custom-slots] duplicate; ignoring', existing.id);
      return;
    }
    const addResult = addCustomSlot(customSlots, placeResult.slot);
    if (!addResult.ok) {
      console.warn('[custom-slots] add failed:', addResult.reason);
      return;
    }
    customSlots = addResult.slots;
    const writeResult = slotsStore.write(customSlots);
    if (!writeResult.ok) {
      console.warn('[custom-slots] persist failed:', writeResult.reason);
      // Continue: in-memory add still wins until reload.
    }
    console.info('[custom-slots] added', placeResult.slot.id);
    remountSearch();
    renderGrid();
    const next = await revalidate(mergedSlots(), { cache, fetchForecast, now: Date.now });
    snapshot = next.snapshot;
    renderGrid();
  }

  function handleRemove(id: string): void {
    const before = customSlots.length;
    customSlots = removeCustomSlot(customSlots, id);
    if (customSlots.length === before) return;
    const writeResult = slotsStore.write(customSlots);
    if (!writeResult.ok) {
      console.warn('[custom-slots] persist failed:', writeResult.reason);
    }
    const evict = cache.removeSlot(id);
    if (!evict.ok) {
      console.warn('[custom-slots] cache evict failed:', evict.reason);
    }
    // Drop the slot from the snapshot too so the next render doesn't
    // show stale data for the removed card.
    const nextSnapshot: CacheSnapshot = { ...snapshot };
    delete nextSnapshot[id];
    snapshot = nextSnapshot;
    console.info('[custom-slots] removed', id);
    remountSearch();
    renderGrid();
  }
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
