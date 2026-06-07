// Entry point — wiring only (CLAUDE.md > Architecture).
//
// STORY-005: the four default location slots are now sourced from the
// `VITE_DEFAULT_LOCATIONS` env var (parsed + validated at the boundary) and
// the per-slot forecast comes from the real Open-Meteo client (STORY-004).
// Mocks remain available to tests but are no longer on the production path.
//
// Data flow:
//   1. Parse `import.meta.env.VITE_DEFAULT_LOCATIONS` → typed `Location[]`.
//      Parse failure → console.error + empty UI (CLAUDE.md > Error handling:
//      no raw errors in the UI; render a friendly state).
//   2. `Promise.allSettled(fetchForecast(...))` per location — per-slot
//      isolation per CLAUDE.md > Fault tolerance: one slot's failure must
//      not blank-screen the others.
//   3. Map each result into an `AppItem` (forecast on ok, null on error) and
//      render. The card / detail components already handle `forecast: null`
//      as an "Unavailable" state, so nothing here needs to know about it.

import './ui/styles.css';
import { parseDefaultLocations } from './locations/env';
import type { Location, LocationSlot } from './locations/types';
import { renderApp, type AppItem } from './ui/app';
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
}

/**
 * Build the initial app state and render it into `root`.
 *
 * Never throws — every failure mode (parse error, fetch failure) is
 * surfaced as a console log + a UI state that still renders.
 */
export async function bootstrap(root: HTMLElement, opts: BootstrapOptions = {}): Promise<void> {
  const raw = opts.rawEnv !== undefined ? opts.rawEnv : import.meta.env.VITE_DEFAULT_LOCATIONS;
  const parsed = parseDefaultLocations(raw);

  if (!parsed.ok) {
    // CLAUDE.md > Error handling: log internally, render a friendly state.
    // Empty UI is the correct "no data at all" representation here.
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

  const items = await fetchAllForecasts(locations, opts.fetchImpl);
  renderApp(root, items);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchAllForecasts(
  locations: readonly Location[],
  fetchImpl: typeof fetch | undefined,
): Promise<readonly AppItem[]> {
  // Parallel fetches with per-slot isolation. Even if one promise rejects
  // unexpectedly (the client should never throw, but defensively...), the
  // others still resolve via `allSettled`.
  const settled = await Promise.allSettled(
    locations.map((location) =>
      fetchForecast(
        { lat: location.lat, lon: location.lon },
        fetchImpl !== undefined ? { fetchImpl } : {},
      ),
    ),
  );

  const items: AppItem[] = [];
  for (let i = 0; i < locations.length; i += 1) {
    const location = locations[i];
    if (location === undefined) continue; // noUncheckedIndexedAccess guard
    const slot: LocationSlot = { kind: 'default', location };
    const outcome = settled[i];
    const forecast = extractForecast(location.name, outcome);
    items.push({ slot, forecast });
  }
  return items;
}

function extractForecast(
  name: string,
  outcome: PromiseSettledResult<Awaited<ReturnType<typeof fetchForecast>>> | undefined,
): ForecastResponse | null {
  if (outcome === undefined) {
    // Shouldn't happen — index lined up by construction. Defensive.
    // eslint-disable-next-line no-console
    console.warn(`[main] ${name}: no fetch outcome (defensive)`);
    return null;
  }
  if (outcome.status === 'rejected') {
    const reason = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
    // eslint-disable-next-line no-console
    console.error(`[main] ${name}: fetch rejected unexpectedly: ${reason}`);
    return null;
  }
  const result = outcome.value;
  if (!result.ok) {
    // eslint-disable-next-line no-console
    console.warn(`[main] ${name}: forecast unavailable (${result.error.kind})`);
    return null;
  }
  // eslint-disable-next-line no-console
  console.info(`[main] ${name}: forecast ok`);
  return result.data;
}

// ---------------------------------------------------------------------------
// Module-level wiring (runs in the browser; tests import `bootstrap` directly)
// ---------------------------------------------------------------------------

const root = document.getElementById('app');

if (root === null) {
  // Nothing to render into — log internally, do not throw in the page.
  // (CLAUDE.md > Observability: console at boundaries.)
  // eslint-disable-next-line no-console
  console.error('[main] #app root element not found in index.html');
} else {
  // Fire-and-forget — bootstrap never throws, errors are logged inside.
  void bootstrap(root);
}
