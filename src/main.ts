// Entry point — wiring only (CLAUDE.md > Architecture).
//
// STORY-005: the four default location slots are sourced from the
// `VITE_DEFAULT_LOCATIONS` env var (parsed + validated at the boundary).
//
// STORY-006: a service worker is registered for offline app-shell precache.
//
// STORY-007: stale-while-revalidate data flow.
//   1. Render cached forecasts immediately (works offline) with a
//      "last updated" stamp (oldest fetchedAt across slots).
//   2. If online, fetch all slots in parallel; per-slot isolation so one
//      failure does not blank the others.
//   3. `visibilitychange` → if data older than ~30 min AND online, refresh.
//
// STORY-008: a geocoding autocomplete widget is mounted under the slot grid;
// the widget surfaces typed `{ name, lat, lon }` selections.
//
// STORY-009: custom slots are added/removed via the search widget and
// persisted on-device (localStorage). Max 2 custom slots; default slots are
// not removable. Custom-slot data must NOT leave the device.
//
// Data flow at bootstrap:
//   - parse env → defaults
//   - load custom slots from localStorage
//   - SWR(union of locations) → initial render (cache-first paint)
//   - kick off refresh → re-render when it settles
//   - subscribe to the custom-slot store: any add/remove rebuilds the SWR
//     and re-renders

import './ui/styles.css';
import { parseDefaultLocations } from './locations/env';
import {
  MAX_CUSTOM_SLOTS,
  createCustomSlotStore,
  type CustomSlotStore,
} from './locations/custom-slots';
import type { Location, LocationSlot } from './locations/types';
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
import { createLocationSearchWidget } from './ui/location-search';

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
  /**
   * Custom-slot store. Tests inject an in-memory store; production wiring
   * uses the localStorage-backed default.
   */
  readonly customSlotStore?: CustomSlotStore;
  /**
   * If true, mount the geocoding search widget. Tests usually leave this
   * `false` to keep DOM assertions focussed on the slot grid.
   */
  readonly mountSearchWidget?: boolean;
}

/**
 * Build the initial app state and render it into `root`.
 *
 * Never throws — every failure mode (parse error, fetch failure, storage
 * corruption) is surfaced as a console log + a UI state that still renders.
 */
export async function bootstrap(root: HTMLElement, opts: BootstrapOptions = {}): Promise<void> {
  const raw = opts.rawEnv !== undefined ? opts.rawEnv : import.meta.env.VITE_DEFAULT_LOCATIONS;
  const parsed = parseDefaultLocations(raw);

  let defaults: readonly Location[] = [];
  if (!parsed.ok) {
    // CLAUDE.md > Error handling: log internally, render a friendly state.
    // eslint-disable-next-line no-console
    console.error(
      `[main] VITE_DEFAULT_LOCATIONS invalid (${parsed.error.kind}): ${parsed.error.message}`,
    );
  } else {
    defaults = parsed.locations;
  }
  // eslint-disable-next-line no-console
  console.info(`[main] bootstrapping with ${defaults.length} default location(s)`);

  const customStore = opts.customSlotStore ?? createCustomSlotStore();
  const now = opts.now ?? Date.now;
  const store = opts.cacheStore ?? createLocalStorageStore();
  const cache = createForecastCache(store);

  // The search widget is owned by `mountSearchWidget` below; we keep a
  // reference here so the renderer can focus its input when the user taps
  // an empty placeholder card, and so we can flip its disabled state when
  // the cap is reached.
  let searchInput: HTMLInputElement | null = null;
  let searchCapNote: HTMLElement | null = null;

  function focusSearchInput(): void {
    if (searchInput === null) return;
    searchInput.focus();
    searchInput.select();
  }

  function refreshSearchCapUI(): void {
    if (searchInput === null || searchCapNote === null) return;
    const canAdd = customStore.canAdd();
    searchInput.disabled = !canAdd;
    searchInput.setAttribute('aria-disabled', String(!canAdd));
    searchCapNote.textContent = canAdd
      ? ''
      : `${MAX_CUSTOM_SLOTS} of ${MAX_CUSTOM_SLOTS} custom slots in use`;
  }

  // Track the latest forecasts so visibilitychange knows what to compare.
  let latest: readonly SlotForecast[] = [];
  let inFlight = false;

  function renderItems(slots: readonly LocationSlot[], forecasts: readonly SlotForecast[]): void {
    const items = buildAppItems(slots, forecasts);
    const label = buildFreshnessLabel(forecasts, now());
    const renderOpts: {
      lastUpdatedLabel?: string;
      onAddRequest: () => void;
      onRemove: (slotIndex: number) => void;
    } = {
      onAddRequest: focusSearchInput,
      onRemove: (slotIndex) => {
        // Map grid index back to the custom-store index. Defaults occupy
        // [0, defaults.length); custom slots start at defaults.length.
        const customIndex = slotIndex - defaults.length;
        if (customIndex < 0 || customIndex >= customStore.list().length) {
          // Defensive — UI never offers `onRemove` for default or empty
          // slots, but a malformed call must not crash bootstrap.
          // eslint-disable-next-line no-console
          console.warn(`[main] ignoring out-of-range remove for slot index ${slotIndex}`);
          return;
        }
        customStore.remove(customIndex);
      },
    };
    if (label !== null) renderOpts.lastUpdatedLabel = label;
    renderApp(root, items, renderOpts);
    refreshSearchCapUI();
  }

  // (re-)build the SWR pipeline for the current union of locations and run
  // both passes: cache-first paint, then network refresh.
  async function rebuildAndRender(reason: string): Promise<void> {
    if (inFlight) {
      // eslint-disable-next-line no-console
      console.info(`[main] refresh already in flight (${reason}) — skipping`);
      return;
    }
    inFlight = true;
    try {
      const customs = customStore.list();
      const slots = buildSlots(defaults, customs);
      const locations = slotsToLocations(slots);
      const swrOpts: {
        fetchImpl?: typeof fetch;
        now: () => number;
        isOnline?: () => boolean;
      } = { now };
      if (opts.fetchImpl !== undefined) swrOpts.fetchImpl = opts.fetchImpl;
      if (opts.isOnline !== undefined) swrOpts.isOnline = opts.isOnline;
      const swr = loadCachedThenRefresh(locations, cache, swrOpts);

      // Cache-first paint — instant, works offline.
      latest = swr.initial;
      renderItems(slots, latest);

      // eslint-disable-next-line no-console
      console.info(`[main] refresh start (${reason})`);
      const refreshed = await swr.refresh();
      latest = refreshed;
      renderItems(slots, refreshed);
    } finally {
      inFlight = false;
    }
  }

  // Mount the geocoding search widget (production wiring only — tests opt in).
  if (opts.mountSearchWidget === true) {
    const mounted = mountSearchWidget(root, customStore);
    searchInput = mounted.input;
    searchCapNote = mounted.capNote;
  }

  // Re-render on every store change. The store calls subscribers synchronously
  // after the mutation, so each add/remove kicks off a fresh fetch cycle.
  customStore.subscribe(() => {
    void rebuildAndRender('custom-slot-change');
  });

  // Initial bootstrap render + refresh.
  await rebuildAndRender('startup');

  // Register the visibilitychange handler once per bootstrap. Tests pass
  // `documentImpl: null` to opt out; default reads `globalThis.document`.
  const docTarget = resolveDocument(opts.documentImpl);
  if (docTarget !== null) {
    docTarget.addEventListener('visibilitychange', () => {
      if (docTarget.visibilityState !== 'visible') return;
      const oldest = oldestFetchedAt(latest);
      if (oldest === null) {
        // Nothing cached yet — try a refresh anyway (best-effort).
        void rebuildAndRender('visibilitychange:cold');
        return;
      }
      if (!isStale(now() - oldest)) {
        // eslint-disable-next-line no-console
        console.info('[main] visibilitychange: data still fresh, skipping refresh');
        return;
      }
      void rebuildAndRender('visibilitychange:stale');
    });
  }
}

// ---------------------------------------------------------------------------
// Slot/forecast plumbing
// ---------------------------------------------------------------------------

/**
 * Compose the unified slot list: defaults first, then custom slots padded to
 * the cap (`MAX_CUSTOM_SLOTS`) with empty placeholders. The grid always shows
 * the same number of cells regardless of how many custom slots are filled.
 */
function buildSlots(
  defaults: readonly Location[],
  customs: readonly Location[],
): readonly LocationSlot[] {
  const slots: LocationSlot[] = [];
  for (const location of defaults) {
    slots.push({ kind: 'default', location });
  }
  for (let i = 0; i < MAX_CUSTOM_SLOTS; i += 1) {
    const location = customs[i] ?? null;
    slots.push({ kind: 'custom', location });
  }
  return slots;
}

/** Extract the concrete (non-empty) locations to feed into the SWR layer. */
function slotsToLocations(slots: readonly LocationSlot[]): readonly Location[] {
  const out: Location[] = [];
  for (const slot of slots) {
    if (slot.location !== null) out.push(slot.location);
  }
  return out;
}

/** Map SWR slot results back onto the full grid (incl. empty placeholders). */
function buildAppItems(
  slots: readonly LocationSlot[],
  forecasts: readonly SlotForecast[],
): readonly AppItem[] {
  // The order is preserved: SWR consumes `slotsToLocations(slots)` in the
  // same order, so we can advance a pointer through `forecasts`.
  const items: AppItem[] = [];
  let cursor = 0;
  for (const slot of slots) {
    if (slot.location === null) {
      items.push({ slot, forecast: null });
      continue;
    }
    const entry = forecasts[cursor];
    cursor += 1;
    items.push({ slot, forecast: entry?.forecast ?? null });
  }
  return items;
}

function buildFreshnessLabel(
  slots: readonly SlotForecast[],
  nowMs: number,
): string | null {
  const oldest = oldestFetchedAt(slots);
  if (oldest === null) return null;
  return formatLastUpdated(nowMs - oldest);
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
// Search widget mount (production only)
// ---------------------------------------------------------------------------

interface MountedSearchWidget {
  readonly input: HTMLInputElement | null;
  readonly capNote: HTMLElement;
}

/**
 * Mount the autocomplete widget into a stable container under `#app`.
 *
 * The widget container lives outside the slot grid so the grid's re-render
 * (replaceChildren on the grid root) does not blow it away. We attach it
 * lazily on first call.
 */
function mountSearchWidget(root: HTMLElement, store: CustomSlotStore): MountedSearchWidget {
  let container = document.getElementById('location-search');
  if (container === null) {
    container = document.createElement('section');
    container.id = 'location-search';
    container.className = 'location-search-container';
    const parent = root.parentElement ?? document.body;
    parent.insertBefore(container, root);
  } else {
    container.replaceChildren();
  }

  const widget = createLocationSearchWidget({
    onSelect: (selection) => {
      const outcome = store.add(selection);
      if (!outcome.ok) {
        // eslint-disable-next-line no-console
        console.warn(`[main] custom slot add rejected: ${outcome.error.kind}`);
        return;
      }
      // eslint-disable-next-line no-console
      console.info(`[main] custom slot added: ${selection.name}`);
    },
  });

  const capNote = document.createElement('p');
  capNote.className = 'location-search-cap-note';
  capNote.setAttribute('role', 'status');
  capNote.setAttribute('aria-live', 'polite');

  container.append(widget.element, capNote);

  const input = widget.element.querySelector(
    'input.location-search__input',
  ) as HTMLInputElement | null;

  return { input, capNote };
}

// ---------------------------------------------------------------------------
// Module-level wiring (runs in the browser; tests import `bootstrap` directly)
// ---------------------------------------------------------------------------

const rootEl = document.getElementById('app');

if (rootEl === null) {
  // Nothing to render into — log internally, do not throw in the page.
  // (CLAUDE.md > Observability: console at boundaries.)
  // eslint-disable-next-line no-console
  console.error('[main] #app root element not found in index.html');
} else {
  // Fire-and-forget — bootstrap never throws, errors are logged inside.
  void bootstrap(rootEl, { mountSearchWidget: true });
}

// STORY-006: register the precaching service worker so the app shell is
// available offline after the first load. No-op under jsdom/tests and on
// browsers without SW support; never throws.
registerServiceWorker();
