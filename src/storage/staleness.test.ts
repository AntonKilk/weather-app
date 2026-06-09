import { describe, expect, it } from 'vitest';
import {
  REVALIDATE_THRESHOLD_MS,
  anyStale,
  formatLastUpdated,
  isStale,
} from './staleness';

const NOW = 1_700_000_000_000;
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('formatLastUpdated', () => {
  it('returns "Just now" when age is exactly 0', () => {
    expect(formatLastUpdated(NOW, NOW)).toBe('Just now');
  });

  it('returns "Just now" at 30 seconds (under the 1-minute boundary)', () => {
    expect(formatLastUpdated(NOW, NOW - 30 * 1000)).toBe('Just now');
  });

  it('returns "Just now" at 59 seconds (still under the boundary)', () => {
    expect(formatLastUpdated(NOW, NOW - 59 * 1000)).toBe('Just now');
  });

  it('returns "Updated 1 min ago" at exactly 60 seconds (lower minute boundary)', () => {
    expect(formatLastUpdated(NOW, NOW - MIN)).toBe('Updated 1 min ago');
  });

  it('returns "Updated 5 min ago" at 5 minutes', () => {
    expect(formatLastUpdated(NOW, NOW - 5 * MIN)).toBe('Updated 5 min ago');
  });

  it('returns "Updated 59 min ago" at 59 minutes', () => {
    expect(formatLastUpdated(NOW, NOW - 59 * MIN)).toBe('Updated 59 min ago');
  });

  it('returns "Updated 1 h ago" at exactly 60 minutes (lower hour boundary)', () => {
    expect(formatLastUpdated(NOW, NOW - HOUR)).toBe('Updated 1 h ago');
  });

  it('returns "Updated 23 h ago" at 23 h 59 min', () => {
    expect(formatLastUpdated(NOW, NOW - (23 * HOUR + 59 * MIN))).toBe('Updated 23 h ago');
  });

  it('returns "Updated 1 d ago" at exactly 24 hours (lower day boundary)', () => {
    expect(formatLastUpdated(NOW, NOW - DAY)).toBe('Updated 1 d ago');
  });

  it('returns "Updated 3 d ago" at 3 days', () => {
    expect(formatLastUpdated(NOW, NOW - 3 * DAY)).toBe('Updated 3 d ago');
  });

  it('clamps clock skew: fetchedAt in the future → "Just now"', () => {
    expect(formatLastUpdated(NOW, NOW + 10 * MIN)).toBe('Just now');
  });

  it('returns "" when fetchedAt is NaN', () => {
    expect(formatLastUpdated(NOW, Number.NaN)).toBe('');
  });

  it('returns "" when now is not finite', () => {
    expect(formatLastUpdated(Number.POSITIVE_INFINITY, NOW)).toBe('');
  });
});

describe('isStale', () => {
  it('returns true at exactly the threshold (lower bound)', () => {
    expect(isStale(NOW, NOW - REVALIDATE_THRESHOLD_MS)).toBe(true);
  });

  it('returns false just under the threshold', () => {
    expect(isStale(NOW, NOW - (REVALIDATE_THRESHOLD_MS - 1))).toBe(false);
  });

  it('returns true past the threshold', () => {
    expect(isStale(NOW, NOW - (REVALIDATE_THRESHOLD_MS + 5 * MIN))).toBe(true);
  });

  it('honours a custom thresholdMs argument', () => {
    expect(isStale(NOW, NOW - 5 * MIN, MIN)).toBe(true);
    expect(isStale(NOW, NOW - 30 * 1000, MIN)).toBe(false);
  });

  it('returns true on NaN fetchedAt (treat unknown freshness as stale)', () => {
    expect(isStale(NOW, Number.NaN)).toBe(true);
  });
});

describe('anyStale', () => {
  it('returns false when every slot is fresh', () => {
    const snap = {
      a: { fetchedAt: NOW - 5 * MIN },
      b: { fetchedAt: NOW - 10 * MIN },
    };
    expect(anyStale(NOW, snap, ['a', 'b'])).toBe(false);
  });

  it('returns true when at least one slot is stale', () => {
    const snap = {
      a: { fetchedAt: NOW - 5 * MIN },
      b: { fetchedAt: NOW - (REVALIDATE_THRESHOLD_MS + MIN) },
    };
    expect(anyStale(NOW, snap, ['a', 'b'])).toBe(true);
  });

  it('treats a missing slot as stale (forces revalidate)', () => {
    const snap = { a: { fetchedAt: NOW - MIN } };
    expect(anyStale(NOW, snap, ['a', 'b'])).toBe(true);
  });

  it('returns false on an empty slot id list', () => {
    expect(anyStale(NOW, {}, [])).toBe(false);
  });
});
