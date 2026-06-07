import { describe, expect, it } from 'vitest';
import { STALE_THRESHOLD_MS, formatLastUpdated, isStale } from './freshness';

const SECOND = 1000;
const MIN = 60 * SECOND;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('isStale', () => {
  it('is false just below the threshold', () => {
    expect(isStale(STALE_THRESHOLD_MS - 1)).toBe(false);
  });

  it('is true at exactly the threshold', () => {
    expect(isStale(STALE_THRESHOLD_MS)).toBe(true);
  });

  it('is true well above the threshold', () => {
    expect(isStale(2 * HOUR)).toBe(true);
  });

  it('treats NaN as not stale (broken clock — leave cache alone)', () => {
    expect(isStale(Number.NaN)).toBe(false);
  });

  it('treats Infinity as not stale (defensive)', () => {
    expect(isStale(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('treats negative ages as not stale (clock skew)', () => {
    expect(isStale(-5)).toBe(false);
  });
});

describe('formatLastUpdated', () => {
  it('renders "Just now" under one minute', () => {
    expect(formatLastUpdated(0)).toBe('Just now');
    expect(formatLastUpdated(30 * SECOND)).toBe('Just now');
    expect(formatLastUpdated(MIN - 1)).toBe('Just now');
  });

  it('renders minutes between 1m and 59m', () => {
    expect(formatLastUpdated(MIN)).toBe('Updated 1m ago');
    expect(formatLastUpdated(5 * MIN)).toBe('Updated 5m ago');
    expect(formatLastUpdated(HOUR - 1)).toBe('Updated 59m ago');
  });

  it('renders hours between 1h and 23h', () => {
    expect(formatLastUpdated(HOUR)).toBe('Updated 1h ago');
    expect(formatLastUpdated(3 * HOUR + 30 * MIN)).toBe('Updated 3h ago'); // floors
    expect(formatLastUpdated(DAY - 1)).toBe('Updated 23h ago');
  });

  it('renders days for ≥ 24 h', () => {
    expect(formatLastUpdated(DAY)).toBe('Updated 1d ago');
    expect(formatLastUpdated(7 * DAY)).toBe('Updated 7d ago');
  });

  it('renders "Updated —" for non-finite inputs', () => {
    expect(formatLastUpdated(Number.NaN)).toBe('Updated —');
    expect(formatLastUpdated(Number.POSITIVE_INFINITY)).toBe('Updated —');
  });

  it('renders "Just now" for negative inputs (clock skew)', () => {
    expect(formatLastUpdated(-1)).toBe('Just now');
  });
});
