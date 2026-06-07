// Storage-layer domain types.
//
// Layer rule (CLAUDE.md › Architecture): this file holds the storage-layer
// types and may import from `weather/` (domain). It must NOT import from
// `ui/` and must NOT know about the DOM.
//
// Naming history: STORY-007 introduces the on-device forecast cache and the
// stale-while-revalidate orchestrator. The cache lives behind a tiny
// `KeyValueStore` interface so the implementation (localStorage today,
// IndexedDB tomorrow) can swap without touching callers.

// ---------------------------------------------------------------------------
// Backing-store abstraction
// ---------------------------------------------------------------------------

/**
 * Minimal sync key/value contract — same surface as `Storage` (localStorage)
 * but explicit so we can swap in an in-memory fallback (Safari private mode,
 * jsdom, future IndexedDB-backed adapter).
 *
 * Implementations MUST swallow internal exceptions (quota, SecurityError,
 * disabled storage) and log at the boundary. Callers treat every method as
 * never-throws.
 */
export interface KeyValueStore {
  /** Returns the stored string for `key`, or `null` if missing or on read error. */
  readonly getItem: (key: string) => string | null;
  /** Best-effort write. Failures (quota, security) are swallowed + logged. */
  readonly setItem: (key: string, value: string) => void;
  /** Best-effort remove. Failures are swallowed + logged. */
  readonly removeItem: (key: string) => void;
}

// ---------------------------------------------------------------------------
// Cache entry shape
// ---------------------------------------------------------------------------

/**
 * What we persist under each cache key. `version` lets us evict entries when
 * the cached payload shape changes; `fetchedAt` is the wall-clock ms-since-epoch
 * at the moment of a successful fetch, used to render the "Updated N ago" stamp.
 */
export interface CacheEntry<T> {
  readonly value: T;
  readonly fetchedAt: number;
  readonly version: number;
}

// ---------------------------------------------------------------------------
// Read-result typed error union (mirrors src/locations/env.ts and the
// open-meteo client's discriminated errors).
// ---------------------------------------------------------------------------

export type CacheReadErrorKind =
  | 'missing'
  | 'malformed-json'
  | 'invalid-shape'
  | 'version-mismatch';

export interface CacheReadError {
  readonly kind: CacheReadErrorKind;
  /** Short, log-safe explanation. NOT for UI display. */
  readonly message: string;
}

export type CacheReadResult<T> =
  | { readonly ok: true; readonly entry: CacheEntry<T> }
  | { readonly ok: false; readonly error: CacheReadError };
