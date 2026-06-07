// Entry point — wiring only (CLAUDE.md > Architecture).
//
// STORY-007: stale-while-revalidate data flow.
//   1. Build the on-device forecast cache (localStorage-backed; falls back
//      to in-memory if storage is disabled — Safari private mode etc.).
//   2. `loadCachedThenRefresh(locations, cache)` returns a synchronous cache
//      snapshot (`initial`) and a `refresh()` thunk.
//   3. Render `initial` immediately — this is the cache-first paint that
//      works even when offline. The header shows an "Updated N ago" stamp
//      computed from the OLDEST `fetchedAt` across slots (most honest:
//      "the oldest data on screen is N ago").
//   4. Fire `refresh()` — when it resolves, re-render with the merged
//      results (per-slot isolation: a failed slot keeps its cached entry).
//   5. Register a single `visibilitychange` handler. When the page becomes
//      visible AND the oldest data is older than ~30 min AND navigator
//      reports online, kick off another `refresh()`. A small `inFlight`
//      guard prevents overlapping refreshes on rapid tab-flips.
//
// All other concerns (slot management, geocoding, …) live elsewhere — this
// file is intentionally narrow.

import './ui/styles.css';
import { parseDefaultLocations } from './locations/env';
import type { LocationSlot } from './locations/types';
import {
  createForecastCache,
  createLocalStorageStore,
  formatLastUpdated,
  isStale,
  loadCachedThenRefresh,
  type KeyValueStore,
  type SlotForecast,
} from './storage';
import { registerServiceWorker } from './sw-register';
import { renderApp, type AppItem } from './ui/app';

// ---------------------------------------------------------------------------
// Bootstrap (exported for tests)
// ---------------------------------------------------------------------------

/**
 * Minimal `Document` surface used by the visibility-change handler. Lets
 * tests inject a synthetic event target without depending on jsdom's global
 * `document` (which is shared across the suite).
 */
export interface DocumentLike {
  readonly visibilityState: DocumentVisibilityState;
  readonly addEventListener: (type: 'visibilitychange', listener: () => void) => void;
}

export interface BootstrapOptions {
  /**
   * Raw env value to parse. Defaults to `import.meta.env.VITE_DEFAULT_LOCATIONS`.
   */
  readonly rawEnv?: string | undefined;
  /** Custom fetch implementation (threaded into the open-meteo client). */
  readonly fetchImpl?: typeof fetch;
  /** Inject the KV store — tests use an in-memory or pre-populated store. */
  readonly cacheStore?: KeyValueStore;
  /** Injected clock — defaults to `Date.now`. */
  readonly now?: () => number;
  /** Injected online flag — defaults to `navigator.onLine` (or true). */
  readonly isOnline?: () => boolean;
  /** Injected document target for the visibilitychange listener. */
  readonly documentImpl?: DocumentLike | null;
}

/**
 * Build the initial app state and render it into `root`.
 *
 * Never throws — every failure mode (parse error, fetch failure, storage
 * failure) is surfaced as a console log + a UI state that still renders.
 */
export async function bootstrap(root: HTMLElement, opts: BootstrapOptions = {}): Promise<void> {
  const raw = opts.rawEnv !== undefined ? opts.rawEnv : import.meta.env.VITE_DEFAULT_LOCATIONS;
  const parsed = parseDefaultLocations(raw);

  if (!parsed.ok) {
    // eslint-disable-next-line no-console
    console.error(
      `[main] VITE_DEFAULT_LOCATIONS invalid (${parsed.error.kind}): ${parsed.error.message}`,
    );
    renderApp(root, []);
    return;
  }

  const locations = parsed.locations;
  // eslint-disable-next-line no-console
  console.info(`[main] bootstrapping with ${locations.length} default location(s)`);

  if (locations.length === 0) {
    renderApp(root, []);
    return;
  }

  const now = opts.now ?? Date.now;
  const store = opts.cacheStore ?? createLocalStorageStore();
  const cache = createForecastCache(store);
  const swr = loadCachedThenRefresh(locations, cache, {
    ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
    now,
    ...(opts.isOnline !== undefined ? { isOnline: opts.isOnline } : {}),
  });

  // Cache-first paint — instant, works offline.
  renderItems(root, swr.initial, now());

  // Refresher closure (re-used by the visibilitychange handler below).
  let inFlight = false;
  let latest: readonly SlotForecast[] = swr.initial;

  async function runRefresh(reason: string): Promise<void> {
    if (inFlight) {
      // eslint-disable-next-line no-console
      console.info(`[main] refresh already in flight (${reason}) — skipping`);
      return;
    }
    inFlight = true;
    try {
      // eslint-disable-next-line no-console
      console.info(`[main] refresh start (${reason})`);
      const refreshed = await swr.refresh();
      latest = refreshed;
      renderItems(root, refreshed, now());
    } finally {
      inFlight = false;
    }
  }

  // Kick off the initial refresh (parallel fetches). Fire-and-forget — the
  // initial render is already on screen.
  await runRefresh('startup');

  // Register the visibilitychange handler once per bootstrap. Tests pass
  // `documentImpl: null` to opt out; default reads `globalThis.document`.
  const docTarget = resolveDocument(opts.documentImpl);
  if (docTarget !== null) {
    docTarget.addEventListener('visibilitychange', () => {
      if (docTarget.visibilityState !== 'visible') return;
      const oldest = oldestFetchedAt(latest);
      if (oldest === null) {
        // Nothing cached yet — try a refresh anyway (best-effort).
        void runRefresh('visibilitychange:cold');
        return;
      }
      if (!isStale(now() - oldest)) {
        // eslint-disable-next-line no-console
        console.info('[main] visibilitychange: data still fresh, skipping refresh');
        return;
      }
      void runRefresh('visibilitychange:stale');
    });
  }
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

function renderItems(
  root: HTMLElement,
  slots: readonly SlotForecast[],
  now: number,
): void {
  const items: AppItem[] = slots.map((slot) => toAppItem(slot));
  const label = buildFreshnessLabel(slots, now);
  if (label === null) {
    renderApp(root, items);
  } else {
    renderApp(root, items, { lastUpdatedLabel: label });
  }
}

function toAppItem(slot: SlotForecast): AppItem {
  const locationSlot: LocationSlot = { kind: 'default', location: slot.location };
  return { slot: locationSlot, forecast: slot.forecast };
}

function buildFreshnessLabel(
  slots: readonly SlotForecast[],
  now: number,
): string | null {
  const oldest = oldestFetchedAt(slots);
  if (oldest === null) return null;
  const ageMs = now - oldest;
  return formatLastUpdated(ageMs);
}

function oldestFetchedAt(slots: readonly SlotForecast[]): number | null {
  let oldest: number | null = null;
  for (const slot of slots) {
    if (slot.fetchedAt === null) continue;
    if (oldest === null || slot.fetchedAt < oldest) {
      oldest = slot.fetchedAt;
    }
  }
  return oldest;
}

function resolveDocument(injected: DocumentLike | null | undefined): DocumentLike | null {
  if (injected === null) return null;
  if (injected !== undefined) return injected;
  if (typeof document === 'undefined') return null;
  return document as DocumentLike;
}

// ---------------------------------------------------------------------------
// Module-level wiring (runs in the browser; tests import `bootstrap` directly)
// ---------------------------------------------------------------------------

const root = document.getElementById('app');

if (root === null) {
  // Nothing to render into — log internally, do not throw in the page.
  // (CLAUDE.md > Observability: console at boundaries.) In jsdom-based tests
  // the #app element is absent, so this branch absorbs the import-time call.
  // eslint-disable-next-line no-console
  console.error('[main] #app root element not found in index.html');
} else {
  // Fire-and-forget — bootstrap never throws, errors are logged inside.
  void bootstrap(root);
}

// STORY-006: register the precaching service worker so the app shell is
// available offline after the first load. No-op under jsdom/tests and on
// browsers without SW support; never throws.
registerServiceWorker();
