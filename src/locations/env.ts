// Parse + validate `VITE_DEFAULT_LOCATIONS` env (CLAUDE.md > Configuration).
//
// The env var holds a single-line JSON array of `{ name, lat, lon }` objects.
// We do NOT trust its shape — it could be missing, malformed, or contain
// bad coordinates if a user copies a stale `.env.local`. This module is the
// single boundary that validates it; downstream code receives a typed array
// of `Location` (or an explanatory error).
//
// Layer rule (CLAUDE.md > Architecture): pure function, no I/O, no DOM.
// Callers handle logging at the boundary.

import type { Location } from './types';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/**
 * Why parsing failed, as a stable string union. The caller can match on this
 * to render a friendlier UI state if it ever wants to differentiate "you
 * forgot to set it" from "your JSON is broken".
 */
export type EnvParseErrorKind =
  | 'missing'
  | 'malformed-json'
  | 'invalid-shape'
  | 'invalid-entry';

export interface EnvParseError {
  readonly kind: EnvParseErrorKind;
  /** Short human-readable explanation — safe to log; do not show as-is in UI. */
  readonly message: string;
}

export type ParseDefaultLocationsResult =
  | { readonly ok: true; readonly locations: readonly Location[] }
  | { readonly ok: false; readonly error: EnvParseError };

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse and validate the raw `VITE_DEFAULT_LOCATIONS` value.
 *
 * Contract:
 *  - `undefined` or whitespace-only string → `missing`.
 *  - non-JSON or `JSON.parse` throws       → `malformed-json`.
 *  - root is not an array                  → `invalid-shape`.
 *  - any element fails per-entry checks    → `invalid-entry` (message names
 *                                            the index and the field).
 *  - empty array (`[]`) is allowed and returns `{ ok: true, locations: [] }`
 *    — the UI shows zero cards rather than crashing. The owner sees the empty
 *    state immediately and knows their env is wrong.
 *
 * Per-entry validity:
 *  - `name`: non-empty string.
 *  - `lat`: finite number in [-90, 90].
 *  - `lon`: finite number in [-180, 180].
 *
 * Extra fields on an entry are ignored (forward compatible).
 */
export function parseDefaultLocations(raw: string | undefined): ParseDefaultLocationsResult {
  if (raw === undefined) {
    return fail('missing', 'VITE_DEFAULT_LOCATIONS is not set');
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return fail('missing', 'VITE_DEFAULT_LOCATIONS is empty');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    return fail('malformed-json', `not valid JSON: ${detail}`);
  }

  if (!Array.isArray(parsed)) {
    return fail('invalid-shape', 'expected a JSON array at the root');
  }

  const locations: Location[] = [];
  for (let i = 0; i < parsed.length; i += 1) {
    const entry = parsed[i];
    const validated = validateEntry(entry, i);
    if (!validated.ok) {
      return { ok: false, error: validated.error };
    }
    locations.push(validated.location);
  }

  return { ok: true, locations };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type EntryResult =
  | { readonly ok: true; readonly location: Location }
  | { readonly ok: false; readonly error: EnvParseError };

function validateEntry(entry: unknown, index: number): EntryResult {
  if (!isPlainObject(entry)) {
    return entryFail(index, 'must be a JSON object');
  }
  const name = entry['name'];
  if (typeof name !== 'string' || name.trim().length === 0) {
    return entryFail(index, '`name` must be a non-empty string');
  }
  const lat = entry['lat'];
  if (typeof lat !== 'number' || !Number.isFinite(lat)) {
    return entryFail(index, '`lat` must be a finite number');
  }
  if (lat < -90 || lat > 90) {
    return entryFail(index, `\`lat\` ${lat} out of range [-90, 90]`);
  }
  const lon = entry['lon'];
  if (typeof lon !== 'number' || !Number.isFinite(lon)) {
    return entryFail(index, '`lon` must be a finite number');
  }
  if (lon < -180 || lon > 180) {
    return entryFail(index, `\`lon\` ${lon} out of range [-180, 180]`);
  }
  return { ok: true, location: { name, lat, lon } };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(kind: EnvParseErrorKind, message: string): ParseDefaultLocationsResult {
  return { ok: false, error: { kind, message } };
}

function entryFail(index: number, reason: string): EntryResult {
  return {
    ok: false,
    error: { kind: 'invalid-entry', message: `entry[${index}]: ${reason}` },
  };
}
