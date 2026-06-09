// Pure staleness helpers — the "Updated N ago" stamp on each card and the
// 30-minute revalidate threshold from the PRD (`visibilitychange` refresh).
// No I/O, no side effects: same inputs → same outputs, always.

export const REVALIDATE_THRESHOLD_MS = 30 * 60 * 1000;

export type Stamp = string;

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function formatLastUpdated(now: number, fetchedAt: number): Stamp {
  if (!Number.isFinite(fetchedAt) || !Number.isFinite(now)) {
    return '';
  }
  const age = Math.max(0, now - fetchedAt);
  if (age < MINUTE_MS) {
    return 'Just now';
  }
  if (age < HOUR_MS) {
    return `Updated ${Math.floor(age / MINUTE_MS)} min ago`;
  }
  if (age < DAY_MS) {
    return `Updated ${Math.floor(age / HOUR_MS)} h ago`;
  }
  return `Updated ${Math.floor(age / DAY_MS)} d ago`;
}

export function isStale(
  now: number,
  fetchedAt: number,
  thresholdMs: number = REVALIDATE_THRESHOLD_MS,
): boolean {
  if (!Number.isFinite(fetchedAt) || !Number.isFinite(now)) {
    return true;
  }
  return now - fetchedAt >= thresholdMs;
}

export function anyStale(
  now: number,
  snapshot: Record<string, { fetchedAt: number } | undefined>,
  slotIds: readonly string[],
  thresholdMs: number = REVALIDATE_THRESHOLD_MS,
): boolean {
  for (const id of slotIds) {
    const entry = snapshot[id];
    if (entry === undefined) {
      return true;
    }
    if (isStale(now, entry.fetchedAt, thresholdMs)) {
      return true;
    }
  }
  return false;
}
