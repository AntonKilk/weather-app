// Custom-slot store — STORY-009.
//
// The user can fill up to two "custom" location slots from the geocoding
// autocomplete. The slots survive page reloads and offline opens, so they
// live in `localStorage`. Default slots (from VITE_DEFAULT_LOCATIONS) are
// owned by `env.ts` and are NOT touched by this store.
//
// Layer rule (CLAUDE.md > Architecture): this module sits next to the slot
// model in `src/locations/` and exposes a domain-shaped API. The only I/O
// it touches is `globalThis.localStorage` (or an injected `Storage` for
// tests). It must not import from `ui/`, `weather/`, or `main.ts`.
//
// Security (CLAUDE.md > Security): custom-slot data never leaves the
// device. We persist `{ name, lat, lon }` only — the same shape as the
// build-time defaults — and read it back through a strict boundary
// validator that mirrors `env.ts`. Anything malformed on disk is dropped
// with a single console.warn; we never let bad storage state blank the
// app.

import type { Location, LocationSelection } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of custom slots a user can fill. */
export const MAX_CUSTOM_SLOTS = 2;

/**
 * Persistence key. Versioned (`:v1`) so a future shape change can ignore the
 * old payload cleanly. Namespaced under `weather-app:` to play nicely with
 * other tools that might share the same origin during dev.
 */
export const CUSTOM_SLOTS_STORAGE_KEY = 'weather-app:custom-slots:v1';

/**
 * Two slots are "the same place" when their coordinates are within ~11 m
 * (1e-4 degrees ≈ 11 m at the equator). Open-Meteo returns one canonical
 * (lat, lon) per result, so users tapping the same suggestion twice get
 * exactly the same numbers; the epsilon is defence-in-depth.
 */
const DUPLICATE_EPSILON = 1e-4;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type AddErrorKind = 'cap-reached' | 'duplicate' | 'invalid';

export interface AddError {
  readonly kind: AddErrorKind;
  readonly message: string;
}

export type AddResult = { readonly ok: true } | { readonly ok: false; readonly error: AddError };

/** Unsubscribe handle returned by `subscribe`. */
export type Unsubscribe = () => void;

export interface CustomSlotStore {
  /** Snapshot of the current custom slots in insertion order. */
  list(): readonly Location[];
  /** Whether another slot can be added (`list().length < MAX_CUSTOM_SLOTS`). */
  canAdd(): boolean;
  /**
   * Append a slot. Returns a typed `AddResult`:
   *  - `cap-reached`: store already holds `MAX_CUSTOM_SLOTS`.
   *  - `duplicate`  : (lat, lon) matches an existing slot within the epsilon.
   *  - `invalid`    : the selection failed boundary validation (bad name,
   *                   non-finite lat/lon, out-of-range coordinates).
   */
  add(selection: LocationSelection): AddResult;
  /**
   * Remove the slot at `index` (0-based against `list()`). Returns `true` if
   * a slot was removed; `false` for an out-of-range index.
   */
  remove(index: number): boolean;
  /** Drop all custom slots — used by tests; not exposed in the UI. */
  clear(): void;
  /**
   * Subscribe to mutations. Listener is invoked synchronously AFTER the
   * mutation has been applied and persisted. Errors thrown by one listener
   * do not prevent the other listeners from running (per CLAUDE.md > Error
   * handling: a single failure must not blank the screen).
   */
  subscribe(listener: () => void): Unsubscribe;
}

export interface CreateCustomSlotStoreOptions {
  /**
   * Persistence backend. Defaults to `globalThis.localStorage`. Tests inject
   * an in-memory `Storage`. Pass `null` to force in-memory mode (useful when
   * the host blocks `localStorage`, e.g. some private-mode browsers).
   */
  readonly storage?: Storage | null;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createCustomSlotStore(opts: CreateCustomSlotStoreOptions = {}): CustomSlotStore {
  const storage = resolveStorage(opts.storage);
  const slots: Location[] = loadSlots(storage);
  const listeners: Array<() => void> = [];

  function notify(): void {
    // Copy first — a listener may unsubscribe itself, mutating the array
    // mid-iteration.
    const snapshot = listeners.slice();
    for (const listener of snapshot) {
      try {
        listener();
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.warn(`[custom-slots] subscriber threw: ${reason}`);
      }
    }
  }

  function persist(): void {
    if (storage === null) return;
    try {
      storage.setItem(CUSTOM_SLOTS_STORAGE_KEY, JSON.stringify(slots));
    } catch (err: unknown) {
      // Quota exceeded or storage disabled mid-session. Log and carry on —
      // the in-memory state is still consistent.
      const reason = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.warn(`[custom-slots] persist failed: ${reason}`);
    }
  }

  return {
    list(): readonly Location[] {
      // Defensive copy — readonly at the type level isn't enough at runtime.
      return slots.slice();
    },
    canAdd(): boolean {
      return slots.length < MAX_CUSTOM_SLOTS;
    },
    add(selection: LocationSelection): AddResult {
      const validated = validateSelection(selection);
      if (!validated.ok) return validated;
      if (slots.length >= MAX_CUSTOM_SLOTS) {
        return failAdd('cap-reached', `at most ${MAX_CUSTOM_SLOTS} custom slots`);
      }
      const location = validated.location;
      if (slots.some((existing) => isSamePlace(existing, location))) {
        return failAdd('duplicate', `${location.name} is already in a custom slot`);
      }
      slots.push(location);
      persist();
      notify();
      return { ok: true };
    },
    remove(index: number): boolean {
      if (!Number.isInteger(index) || index < 0 || index >= slots.length) {
        return false;
      }
      slots.splice(index, 1);
      persist();
      notify();
      return true;
    },
    clear(): void {
      if (slots.length === 0) return;
      slots.length = 0;
      persist();
      notify();
    },
    subscribe(listener: () => void): Unsubscribe {
      listeners.push(listener);
      return () => {
        const i = listeners.indexOf(listener);
        if (i !== -1) listeners.splice(i, 1);
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Resolve the storage backend. Explicit `null` opts out; explicit `Storage`
 * is used as-is; undefined falls back to `globalThis.localStorage` and
 * catches any access throwing (private mode / disabled cookies).
 */
function resolveStorage(provided: Storage | null | undefined): Storage | null {
  if (provided === null) return null;
  if (provided !== undefined) return provided;
  try {
    const candidate = globalThis.localStorage;
    if (candidate === undefined || candidate === null) return null;
    // Probe write/read — some browsers throw on access in private mode
    // ONLY when you try to use it, not when you read the property.
    const probeKey = `${CUSTOM_SLOTS_STORAGE_KEY}:probe`;
    candidate.setItem(probeKey, '1');
    candidate.removeItem(probeKey);
    return candidate;
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.warn(`[custom-slots] localStorage unavailable, using in-memory: ${reason}`);
    return null;
  }
}

function loadSlots(storage: Storage | null): Location[] {
  if (storage === null) return [];
  let raw: string | null;
  try {
    raw = storage.getItem(CUSTOM_SLOTS_STORAGE_KEY);
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.warn(`[custom-slots] read failed: ${reason}`);
    return [];
  }
  if (raw === null) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.warn(`[custom-slots] dropping corrupt store (not JSON): ${reason}`);
    return [];
  }
  if (!Array.isArray(parsed)) {
    // eslint-disable-next-line no-console
    console.warn('[custom-slots] dropping corrupt store (root is not an array)');
    return [];
  }

  const out: Location[] = [];
  for (let i = 0; i < parsed.length && out.length < MAX_CUSTOM_SLOTS; i += 1) {
    const validated = validateEntry(parsed[i]);
    if (!validated.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[custom-slots] dropping invalid entry[${i}]: ${validated.error.message}`);
      continue;
    }
    out.push(validated.location);
  }
  return out;
}

type ValidationResult =
  | { readonly ok: true; readonly location: Location }
  | { readonly ok: false; readonly error: AddError };

/** Validate a stored entry of unknown shape. Mirrors env.ts boundary checks. */
function validateEntry(entry: unknown): ValidationResult {
  if (!isPlainObject(entry)) {
    return failValidate('invalid', 'entry must be an object');
  }
  return validateLatLonName(entry['name'], entry['lat'], entry['lon']);
}

/**
 * Validate a `LocationSelection` from the autocomplete widget. The widget
 * has already narrowed at the API boundary, but `LocationSelection` is
 * structurally just `Location`, so we re-check here. Cheap insurance.
 */
function validateSelection(selection: LocationSelection): ValidationResult {
  return validateLatLonName(selection.name, selection.lat, selection.lon);
}

function validateLatLonName(rawName: unknown, rawLat: unknown, rawLon: unknown): ValidationResult {
  if (typeof rawName !== 'string' || rawName.trim().length === 0) {
    return failValidate('invalid', '`name` must be a non-empty string');
  }
  if (typeof rawLat !== 'number' || !Number.isFinite(rawLat)) {
    return failValidate('invalid', '`lat` must be a finite number');
  }
  if (rawLat < -90 || rawLat > 90) {
    return failValidate('invalid', `\`lat\` ${rawLat} out of range [-90, 90]`);
  }
  if (typeof rawLon !== 'number' || !Number.isFinite(rawLon)) {
    return failValidate('invalid', '`lon` must be a finite number');
  }
  if (rawLon < -180 || rawLon > 180) {
    return failValidate('invalid', `\`lon\` ${rawLon} out of range [-180, 180]`);
  }
  return {
    ok: true,
    location: { name: rawName, lat: rawLat, lon: rawLon },
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSamePlace(a: Location, b: Location): boolean {
  return Math.abs(a.lat - b.lat) < DUPLICATE_EPSILON && Math.abs(a.lon - b.lon) < DUPLICATE_EPSILON;
}

function failAdd(kind: AddErrorKind, message: string): AddResult {
  return { ok: false, error: { kind, message } };
}

function failValidate(kind: AddErrorKind, message: string): ValidationResult {
  return { ok: false, error: { kind, message } };
}
