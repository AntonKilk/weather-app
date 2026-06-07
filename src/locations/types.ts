// Domain types for the Open-Meteo Geocoding client and autocomplete controller.
//
// Layer rule (CLAUDE.md › Architecture): this file is the source of truth for
// location-domain types. Higher layers (ui/, main.ts) may import from here.
// This file must NOT import from any of those layers and must NOT know about
// fetch, IndexedDB, or the DOM.
//
// Field set was spike-verified against the Open-Meteo geocoding endpoint on
// 2026-06-07 (see .agents/PRDs/offline-weather-pwa.prd.md › Open Questions ›
// Weather API choice — RESOLVED). The geocoding endpoint:
//   GET https://geocoding-api.open-meteo.com/v1/search?name=...&count=5&language=en
// Returns `{ results: GeocodingRow[], generationtime_ms: number }` — or, on
// zero matches, `{ generationtime_ms: ... }` with NO `results` key (this is
// success-with-empty, not an error).

// ---------------------------------------------------------------------------
// Hand-off shape (the contract for STORY-009)
// ---------------------------------------------------------------------------

/**
 * The minimal location payload emitted when the user picks a suggestion.
 * This is the boundary between STORY-008 (this story) and STORY-009 (custom
 * slot persistence) — STORY-009 reads exactly these three fields.
 */
export interface LocationSelection {
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
}

// ---------------------------------------------------------------------------
// Open-Meteo geocoding response shape
// ---------------------------------------------------------------------------

/**
 * A single row from the Open-Meteo geocoding endpoint. The endpoint returns
 * many optional fields; we model only the ones the UI may render or that the
 * `LocationSelection` hand-off depends on.
 */
export interface GeocodingResult {
  readonly id?: number;
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly country?: string;
  readonly country_code?: string;
  readonly admin1?: string;
  readonly admin2?: string;
  readonly population?: number;
  readonly feature_code?: string;
  readonly timezone?: string;
  readonly elevation?: number;
}

/**
 * Narrowed response shape returned past the API boundary. Empty matches
 * (raw response missing `results`) normalise to `{ results: [] }` here.
 */
export interface GeocodingResponse {
  readonly results: readonly GeocodingResult[];
}

// ---------------------------------------------------------------------------
// Typed result / error union — mirrors src/weather/types.ts
// ---------------------------------------------------------------------------

/**
 * Discriminated error union returned by the geocoding client.
 *
 * - `timeout`  : the per-request AbortSignal.timeout fired.
 * - `network`  : fetch threw a non-timeout, non-abort error (offline, DNS, ...).
 * - `http`     : server returned a non-2xx status. `retried` is always false —
 *                geocoding does NOT retry; stale requests are cancelled by the
 *                next keystroke instead (story #8 technical note).
 * - `parse`    : response body could not be decoded or violated the expected
 *                shape at the API boundary.
 * - `aborted`  : the caller cancelled this request (typically because the user
 *                typed another character). This is a SOFT signal — the
 *                autocomplete controller drops it silently and does NOT show
 *                an error in the UI.
 *
 * The client never throws across its boundary — callers branch on `ok`.
 */
export type GeocodingError =
  | { readonly kind: 'timeout' }
  | { readonly kind: 'network'; readonly message: string }
  | { readonly kind: 'http'; readonly status: number; readonly retried: false }
  | { readonly kind: 'parse'; readonly message: string }
  | { readonly kind: 'aborted' };

/** Generic typed result. */
export type Result<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: GeocodingError };

export type GeocodingFetchResult = Result<GeocodingResponse>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Narrow a full geocoding row to the STORY-009 hand-off shape. */
export function toSelection(row: GeocodingResult): LocationSelection {
  return { name: row.name, lat: row.latitude, lon: row.longitude };
}

// ---------------------------------------------------------------------------
// Autocomplete controller state — emitted as an event stream to the UI.
// ---------------------------------------------------------------------------

/**
 * State emitted by the autocomplete controller. The UI maps each state to a
 * concrete rendering:
 *  - idle     → nothing under the input
 *  - loading  → optional spinner (the widget shows the previous suggestions
 *               or nothing — implementation detail of the widget)
 *  - results  → render the `results` array
 *  - empty    → "No results"
 *  - offline  → "Search needs a connection"
 *  - error    → "Something went wrong" (no internal details surfaced; CLAUDE.md
 *               › Security — UI never shows raw error messages)
 */
export type AutocompleteState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'results'; readonly results: readonly GeocodingResult[] }
  | { readonly kind: 'empty' }
  | { readonly kind: 'offline' }
  | { readonly kind: 'error' };
