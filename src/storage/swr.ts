// Stale-while-revalidate orchestrator.
//
// CLAUDE.md › Architecture › Core data flow:
//   1. App opens → render cached forecasts immediately (works offline).
//   2. If online → fetch all slots in parallel → update cache → re-render.
//   3. `visibilitychange` → if data older than ~30 min, refresh.
//
// Layer rule: this file is part of the storage layer. Allowed imports:
// `weather/` (domain + client), `locations/` (Location type), `./forecast-cache`,
// `./types`. Forbidden: `ui/`.
//
// Per CLAUDE.md › Fault Tolerance:
//   - Per-slot isolation: `Promise.allSettled`.
//   - "Showing stale" is a normal state — failures keep the cached entry.
//   - One slot's failure never blanks the others.
//
// The orchestrator NEVER throws across its boundary. Every failure is folded
// into the returned `SlotForecast` (which holds the last known `forecast` and
// `fetchedAt` even when the refresh failed).

import type { Location } from '../locations/types';
import { fetchForecast } from '../weather/open-meteo-client';
import type { ForecastResponse } from '../weather/types';
import type { ForecastCache } from './forecast-cache';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/**
 * The view that `main.ts` and the UI consume — one entry per configured slot.
 * `forecast === null` means "no data at all for this slot" (cold cache + no
 * network); `forecast !== null` with an older `fetchedAt` means "stale, will
 * be refreshed when possible".
 */
export interface SlotForecast {
  readonly location: Location;
  readonly forecast: ForecastResponse | null;
  /** ms since epoch when the forecast was fetched; null if never cached. */
  readonly fetchedAt: number | null;
}

export interface SwrOptions {
  /** Injected for tests; defaults to global `fetch`. */
  readonly fetchImpl?: typeof fetch;
  /** Injected for tests; defaults to `Date.now`. */
  readonly now?: () => number;
  /**
   * Whether the network appears reachable. Defaults to `navigator.onLine` when
   * available, else `true` (assume online and let `fetch` decide).
   */
  readonly isOnline?: () => boolean;
}

export interface SwrResult {
  /** Synchronous cache snapshot for the initial render. */
  readonly initial: readonly SlotForecast[];
  /**
   * Kick off the refresh. Resolves to a fresh `SlotForecast[]` once every
   * per-slot fetch has settled. Successful slots are written to the cache.
   * Failed slots keep their previous `forecast` + `fetchedAt`.
   *
   * Returns the same array as `initial` (without calling fetch) if
   * `isOnline()` reports `false`.
   */
  readonly refresh: () => Promise<readonly SlotForecast[]>;
}

/**
 * Build the SWR snapshot + refresher for a set of slots.
 *
 * Pure factory — does not start any work. The caller renders `initial` and
 * then awaits `refresh()` (typically fire-and-forget into a re-render).
 */
export function loadCachedThenRefresh(
  locations: readonly Location[],
  cache: ForecastCache,
  opts: SwrOptions = {},
): SwrResult {
  const now = opts.now ?? Date.now;
  const isOnline = opts.isOnline ?? defaultIsOnline;
  const fetchImpl = opts.fetchImpl;

  const initial: SlotForecast[] = locations.map((location) => readSlot(location, cache));

  async function refresh(): Promise<readonly SlotForecast[]> {
    if (!isOnline()) {
      // eslint-disable-next-line no-console
      console.info('[swr] offline — skipping refresh');
      return initial;
    }

    const settled = await Promise.allSettled(
      locations.map((location) =>
        fetchForecast(
          { lat: location.lat, lon: location.lon },
          fetchImpl !== undefined ? { fetchImpl } : {},
        ),
      ),
    );

    const refreshed: SlotForecast[] = [];
    for (let i = 0; i < locations.length; i += 1) {
      const location = locations[i];
      if (location === undefined) continue; // noUncheckedIndexedAccess guard
      const previous = initial[i] ?? readSlot(location, cache);
      const outcome = settled[i];
      refreshed.push(mergeOutcome(location, previous, outcome, cache, now()));
    }
    return refreshed;
  }

  return { initial, refresh };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readSlot(location: Location, cache: ForecastCache): SlotForecast {
  const result = cache.read({ lat: location.lat, lon: location.lon });
  if (result.ok) {
    // eslint-disable-next-line no-console
    console.info(`[swr] cache hit ${location.name}`);
    return { location, forecast: result.entry.value, fetchedAt: result.entry.fetchedAt };
  }
  if (result.error.kind !== 'missing') {
    // version-mismatch / malformed / invalid-shape — log and treat as cold.
    // eslint-disable-next-line no-console
    console.warn(`[swr] cache unreadable ${location.name} (${result.error.kind})`);
  } else {
    // eslint-disable-next-line no-console
    console.info(`[swr] cache miss ${location.name}`);
  }
  return { location, forecast: null, fetchedAt: null };
}

function mergeOutcome(
  location: Location,
  previous: SlotForecast,
  outcome: PromiseSettledResult<Awaited<ReturnType<typeof fetchForecast>>> | undefined,
  cache: ForecastCache,
  now: number,
): SlotForecast {
  if (outcome === undefined) {
    return previous; // defensive — index alignment guarantee, but be safe
  }
  if (outcome.status === 'rejected') {
    const reason = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
    // eslint-disable-next-line no-console
    console.warn(`[swr] ${location.name}: fetch rejected (defensive): ${reason}`);
    return previous;
  }
  const result = outcome.value;
  if (!result.ok) {
    // eslint-disable-next-line no-console
    console.warn(`[swr] ${location.name}: refresh failed (${result.error.kind}) — keeping cache`);
    return previous;
  }
  // eslint-disable-next-line no-console
  console.info(`[swr] ${location.name}: refresh ok`);
  cache.write({ lat: location.lat, lon: location.lon }, result.data, now);
  return { location, forecast: result.data, fetchedAt: now };
}

function defaultIsOnline(): boolean {
  // `navigator.onLine` is widely supported (including iOS Safari) and is
  // explicitly documented as conservative: `true` when there might be a
  // network. We default to it and let the actual fetch decide the outcome.
  if (typeof navigator === 'undefined') return true;
  // In some envs the property is missing — assume online.
  const flag = (navigator as { onLine?: boolean }).onLine;
  return flag === undefined ? true : flag;
}
