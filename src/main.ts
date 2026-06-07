// Entry point — wiring only (CLAUDE.md > Architecture).
//
// STORY-005: the four default location slots are sourced from the
// `VITE_DEFAULT_LOCATIONS` env var (parsed + validated at the boundary) and
// the per-slot forecast comes from the real Open-Meteo client (STORY-004).
// Mocks remain available to tests but are no longer on the production path.
//
// STORY-008: a geocoding autocomplete widget is mounted under the slot grid;
// the widget surfaces typed `{ name, lat, lon }` selections.
//
// STORY-009: custom slots are added/removed via the search widget and
// persisted on-device (localStorage). Max 2 custom slots; default slots are
// not removable. Custom-slot data must NOT leave the device.
//
// Data flow:
//   1. Parse `import.meta.env.VITE_DEFAULT_LOCATIONS` → typed `Location[]`.
//      Parse failure → console.error + render only custom slots (CLAUDE.md
//      › Error handling: no raw errors in the UI; render a friendly state).
//   2. Load custom slots from localStorage (corrupt store → drop + warn).
//   3. Build the unified slot list: defaults first, then custom (max 2).
//   4. `Promise.allSettled(fetchForecast(...))` per slot that has a location —
//      per-slot isolation per CLAUDE.md › Fault tolerance: one slot's failure
//      must not blank-screen the others.
//   5. Re-render whenever the custom-slot store changes (add / remove).

import './ui/styles.css';
import { parseDefaultLocations } from './locations/env';
import {
  MAX_CUSTOM_SLOTS,
  createCustomSlotStore,
  type CustomSlotStore,
} from './locations/custom-slots';
import type { Location, LocationSlot } from './locations/types';
import { renderApp, type AppItem } from './ui/app';
import { createLocationSearchWidget } from './ui/location-search';
import { fetchForecast } from './weather/open-meteo-client';
import type { ForecastResponse } from './weather/types';

// ---------------------------------------------------------------------------
// Bootstrap (exported for tests)
// ---------------------------------------------------------------------------

export interface BootstrapOptions {
  /**
   * Raw env value to parse. Defaults to `import.meta.env.VITE_DEFAULT_LOCATIONS`.
   * Tests inject a deterministic value here instead of relying on Vite.
   */
  readonly rawEnv?: string | undefined;
  /**
   * Custom fetch implementation, threaded through to the Open-Meteo client.
   * Tests inject a stub to avoid real network.
   */
  readonly fetchImpl?: typeof fetch;
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

  // Render closure — captures `root`, `defaults`, and the fetch impl. Re-runs
  // whenever the custom-slot store changes (add / remove / clear) so the grid
  // stays in sync with persistence.
  const renderNow = async (): Promise<void> => {
    const customs = customStore.list();
    const slots = buildSlots(defaults, customs);
    const items = await fetchAllForecasts(slots, opts.fetchImpl);
    renderApp(root, items, {
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
    });
    refreshSearchCapUI();
  };

  // Mount the geocoding search widget (production wiring only — tests opt in).
  if (opts.mountSearchWidget === true) {
    const mounted = mountSearchWidget(root, customStore);
    searchInput = mounted.input;
    searchCapNote = mounted.capNote;
  }

  // Re-render on every store change. The store calls subscribers synchronously
  // after the mutation, so each add/remove kicks off a fresh fetch cycle.
  customStore.subscribe(() => {
    void renderNow();
  });

  await renderNow();
}

// ---------------------------------------------------------------------------
// Helpers
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
  // Padding empty custom slots keeps the layout stable until the user fills
  // them. The UI renders a "Add a location" placeholder for the null case.
  for (let i = 0; i < MAX_CUSTOM_SLOTS; i += 1) {
    const location = customs[i] ?? null;
    slots.push({ kind: 'custom', location });
  }
  return slots;
}

async function fetchAllForecasts(
  slots: readonly LocationSlot[],
  fetchImpl: typeof fetch | undefined,
): Promise<readonly AppItem[]> {
  // Per-slot isolation: each fetch is independent, and `allSettled` makes
  // sure one slot's rejection cannot blank-screen the others.
  const tasks = slots.map(async (slot): Promise<AppItem> => {
    if (slot.location === null) {
      return { slot, forecast: null };
    }
    const location = slot.location;
    try {
      const result = await fetchForecast(
        { lat: location.lat, lon: location.lon },
        fetchImpl !== undefined ? { fetchImpl } : {},
      );
      const forecast = extractForecast(location.name, result);
      return { slot, forecast };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error(`[main] ${location.name}: fetch threw unexpectedly: ${reason}`);
      return { slot, forecast: null };
    }
  });
  return Promise.all(tasks);
}

function extractForecast(
  name: string,
  result: Awaited<ReturnType<typeof fetchForecast>>,
): ForecastResponse | null {
  if (!result.ok) {
    // eslint-disable-next-line no-console
    console.warn(`[main] ${name}: forecast unavailable (${result.error.kind})`);
    return null;
  }
  // eslint-disable-next-line no-console
  console.info(`[main] ${name}: forecast ok`);
  return result.data;
}

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
 *
 * Returns handles to the input (so the empty-card → "focus search" flow
 * works) and the cap note (so the renderer can show "2 of 2 custom slots
 * in use" when the user has filled both).
 */
function mountSearchWidget(root: HTMLElement, store: CustomSlotStore): MountedSearchWidget {
  let container = document.getElementById('location-search');
  if (container === null) {
    container = document.createElement('section');
    container.id = 'location-search';
    container.className = 'location-search-container';
    // Insert before the slot grid root if present, else append. The grid
    // owns `#app` content via `renderApp` and uses `replaceChildren`, so
    // placing this container as a sibling of `#app` keeps it stable.
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
