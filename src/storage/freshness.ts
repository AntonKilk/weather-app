// Freshness helpers.
//
// Pure functions, no I/O, no DOM (CLAUDE.md › Architecture — domain-style
// helpers in the storage layer). The caller passes in the age in milliseconds,
// computed from `now() - fetchedAt`; we never call `Date.now()` here so tests
// have full control of the clock.

/** ≥ 30 min old → eligible for a background refresh (issue #7 AC). */
export const STALE_THRESHOLD_MS = 30 * 60 * 1000;

const MIN_MS = 60 * 1000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Should we trigger a background refresh? `true` iff the cached data is at
 * least `STALE_THRESHOLD_MS` old. Non-finite or negative inputs are coerced
 * to "fresh" (we can't reason about a broken clock, so leave the cache alone).
 */
export function isStale(ageMs: number): boolean {
  if (!Number.isFinite(ageMs)) return false;
  if (ageMs < 0) return false;
  return ageMs >= STALE_THRESHOLD_MS;
}

/**
 * Human-friendly stamp for the UI.
 *
 *   < 60 s      → "Just now"
 *   < 60 min    → "Updated 5m ago"
 *   < 24 h      → "Updated 2h ago"
 *   ≥ 24 h      → "Updated 3d ago"
 *   non-finite  → "Updated —"  (defensive — never crashes the page)
 *   negative    → "Just now"  (clock skew between cache write and now)
 */
export function formatLastUpdated(ageMs: number): string {
  if (!Number.isFinite(ageMs)) return 'Updated —';
  if (ageMs < 0) return 'Just now';
  if (ageMs < MIN_MS) return 'Just now';
  if (ageMs < HOUR_MS) {
    const minutes = Math.floor(ageMs / MIN_MS);
    return `Updated ${minutes}m ago`;
  }
  if (ageMs < DAY_MS) {
    const hours = Math.floor(ageMs / HOUR_MS);
    return `Updated ${hours}h ago`;
  }
  const days = Math.floor(ageMs / DAY_MS);
  return `Updated ${days}d ago`;
}
