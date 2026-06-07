// Geocoding autocomplete controller.
//
// This is the *brain* of the search experience — no DOM. The UI widget
// (`src/ui/location-search.ts`) sends text into it and renders the state it
// emits.
//
// Responsibilities (story #8 ACs 1–6):
//   AC1  enforces the ≥2-character floor (delegated to `searchLocations`).
//   AC2  debounces input ~300 ms; aborts the in-flight request on every new
//        debounced query.
//   AC3  surfaces an empty-results state distinct from errors.
//   AC4  classifies network failures as `offline` (when navigator.onLine says
//        we're offline) and as `error` otherwise. The app keeps running —
//        nothing throws, no other slot is affected (CLAUDE.md › Per-slot
//        isolation).
//   AC5  is handled by the UI widget (`textContent` rendering); the
//        controller passes raw rows to it.
//   AC6  exposes `select(row)` which calls `onSelect` with a typed
//        `{ name, lat, lon }`.
//
// The controller is layer-clean: no DOM imports. It depends on `debounce`,
// `searchLocations`, and the domain types. The widget injects callbacks for
// state + selection.

import { debounce, type DebouncedFunction } from './debounce';
import { searchLocations as defaultSearchLocations } from './open-meteo-geocoding-client';
import {
  toSelection,
  type AutocompleteState,
  type GeocodingFetchResult,
  type GeocodingResult,
  type LocationSelection,
} from './types';

const DEFAULT_DEBOUNCE_MS = 300;

export interface GeocodingAutocompleteOptions {
  /** State stream. The widget renders each transition. */
  onState(state: AutocompleteState): void;
  /** Selection callback. Receives the STORY-009 hand-off shape. */
  onSelect(selection: LocationSelection): void;
  /** Override the default 300 ms debounce — for tests. */
  debounceMs?: number;
  /** Override the search implementation — for tests / DI. */
  search?: typeof defaultSearchLocations;
  /**
   * Tell the controller whether the device is online. Defaults to
   * `() => navigator.onLine`. Note: navigator.onLine is a HINT — it can lie.
   * We only consult it to decide between `offline` and `error` UI states
   * after a network failure.
   */
  isOnline?: () => boolean;
  /** Test override for debounce timers. */
  setTimeoutImpl?: typeof globalThis.setTimeout;
  clearTimeoutImpl?: typeof globalThis.clearTimeout;
}

export interface GeocodingAutocomplete {
  /** New input from the user. Triggers debounced fetch when ≥ 2 chars. */
  query(value: string): void;
  /** User picked a suggestion. */
  select(result: GeocodingResult): void;
  /** Tear down — cancels debounce, aborts in-flight, clears callbacks. */
  destroy(): void;
}

export function createGeocodingAutocomplete(
  opts: GeocodingAutocompleteOptions,
): GeocodingAutocomplete {
  const search = opts.search ?? defaultSearchLocations;
  const isOnline = opts.isOnline ?? defaultIsOnline;
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  let destroyed = false;
  let inFlight: AbortController | null = null;
  /** Monotonic request id so a late-returning fetch can be ignored. */
  let requestSeq = 0;

  // Local mutable references to the callbacks. `destroy()` nulls them out so
  // any late callbacks become no-ops.
  let onState: ((state: AutocompleteState) => void) | null = opts.onState;
  let onSelect: ((selection: LocationSelection) => void) | null = opts.onSelect;

  function emit(state: AutocompleteState): void {
    if (destroyed) return;
    onState?.(state);
  }

  async function runSearch(value: string): Promise<void> {
    if (destroyed) return;

    // Abort any in-flight request.
    if (inFlight !== null) {
      inFlight.abort();
    }
    const controller = new AbortController();
    inFlight = controller;
    const mySeq = ++requestSeq;

    emit({ kind: 'loading' });

    let result: GeocodingFetchResult;
    try {
      result = await search(value, { signal: controller.signal });
    } catch (err: unknown) {
      // The client contract is never-throws, but defend anyway: a bug in a
      // custom `search` override must not break the app.
      // eslint-disable-next-line no-console
      console.error('[geocoding-autocomplete] search threw — treating as error', err);
      if (mySeq === requestSeq && !destroyed) {
        emit({ kind: 'error' });
        if (inFlight === controller) inFlight = null;
      }
      return;
    }

    // Stale: another query has since been issued — drop the result silently.
    if (mySeq !== requestSeq) {
      return;
    }
    if (inFlight === controller) {
      inFlight = null;
    }
    if (destroyed) return;

    if (result.ok) {
      if (result.data.results.length === 0) {
        emit({ kind: 'empty' });
      } else {
        emit({ kind: 'results', results: result.data.results });
      }
      return;
    }

    switch (result.error.kind) {
      case 'aborted':
        // The next keystroke cancelled us. The newer call is already
        // emitting its own state — do not stomp it.
        return;
      case 'network':
        emit(isOnline() ? { kind: 'error' } : { kind: 'offline' });
        return;
      case 'timeout':
      case 'http':
      case 'parse':
        emit({ kind: 'error' });
        return;
    }
  }

  const debounced: DebouncedFunction<[string]> = debounce<[string]>(
    (value) => {
      void runSearch(value);
    },
    debounceMs,
    {
      ...(opts.setTimeoutImpl !== undefined ? { setTimeoutImpl: opts.setTimeoutImpl } : {}),
      ...(opts.clearTimeoutImpl !== undefined ? { clearTimeoutImpl: opts.clearTimeoutImpl } : {}),
    },
  );

  return {
    query(value: string): void {
      if (destroyed) return;
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        // Empty input — reset to idle, cancel debounce, abort in-flight.
        debounced.cancel();
        if (inFlight !== null) {
          inFlight.abort();
          inFlight = null;
        }
        requestSeq += 1; // Invalidate any in-flight result.
        emit({ kind: 'idle' });
        return;
      }
      if (trimmed.length < 2) {
        // < 2 chars: cancel any pending search, but DO NOT emit `loading` or
        // `empty` yet — the user is mid-typing. Stay at the previous visible
        // state. (The first call after `idle` will be `loading` once they
        // hit 2 chars.) This matches the spec: "suggestions appear at ≥2".
        debounced.cancel();
        if (inFlight !== null) {
          inFlight.abort();
          inFlight = null;
        }
        requestSeq += 1;
        emit({ kind: 'idle' });
        return;
      }
      // Schedule a debounced search with the current value.
      debounced.call(trimmed);
    },
    select(result: GeocodingResult): void {
      if (destroyed) return;
      onSelect?.(toSelection(result));
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      debounced.cancel();
      if (inFlight !== null) {
        inFlight.abort();
        inFlight = null;
      }
      onState = null;
      onSelect = null;
    },
  };
}

function defaultIsOnline(): boolean {
  // `navigator` is always defined in a jsdom or browser environment. Guard
  // for the SSR / non-browser case anyway.
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine;
}
