// Tests for `createForecastCache` — the on-device cache boundary.
//
// Uses the in-memory store so each test is hermetic and observable. The cache
// is the only point that knows about the cached-entry shape (`version`,
// `fetchedAt`, `value`) — these tests pin it down.

import { describe, expect, it } from 'vitest';
import lahtiFixture from '../weather/__fixtures__/forecast-lahti.json' with { type: 'json' };
import {
  CACHE_KEY_PREFIX,
  CACHE_VERSION,
  createForecastCache,
} from './forecast-cache';
import { createMemoryStore } from './key-value-store';
import type { Coordinates, ForecastResponse } from '../weather/types';

const COORDS_LAHTI: Coordinates = { lat: 60.98, lon: 25.66 };
const COORDS_HELSINKI: Coordinates = { lat: 60.17, lon: 24.93 };

const FORECAST = lahtiFixture as unknown as ForecastResponse;

describe('createForecastCache', () => {
  describe('read', () => {
    it('returns `missing` when the store is empty', () => {
      const cache = createForecastCache(createMemoryStore());
      const r = cache.read(COORDS_LAHTI);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error.kind).toBe('missing');
    });

    it('returns `malformed-json` when the store has garbage', () => {
      const store = createMemoryStore();
      const cache = createForecastCache(store);
      store.setItem(cache.keyFor(COORDS_LAHTI), 'not-json{');
      const r = cache.read(COORDS_LAHTI);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error.kind).toBe('malformed-json');
    });

    it('returns `invalid-shape` when the JSON is not an object', () => {
      const store = createMemoryStore();
      const cache = createForecastCache(store);
      store.setItem(cache.keyFor(COORDS_LAHTI), '42');
      const r = cache.read(COORDS_LAHTI);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error.kind).toBe('invalid-shape');
    });

    it('returns `invalid-shape` when `value` is missing required fields', () => {
      const store = createMemoryStore();
      const cache = createForecastCache(store);
      store.setItem(
        cache.keyFor(COORDS_LAHTI),
        JSON.stringify({
          version: CACHE_VERSION,
          fetchedAt: 1,
          value: { latitude: 60, longitude: 25, timezone: 'X' /* no current/hourly/daily */ },
        }),
      );
      const r = cache.read(COORDS_LAHTI);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error.kind).toBe('invalid-shape');
    });

    it('returns `invalid-shape` when `fetchedAt` is missing', () => {
      const store = createMemoryStore();
      const cache = createForecastCache(store);
      store.setItem(
        cache.keyFor(COORDS_LAHTI),
        JSON.stringify({ version: CACHE_VERSION, value: FORECAST }),
      );
      const r = cache.read(COORDS_LAHTI);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error.kind).toBe('invalid-shape');
      expect(r.error.message).toMatch(/fetchedAt/);
    });

    it('returns `version-mismatch` for a different version', () => {
      const store = createMemoryStore();
      const cache = createForecastCache(store);
      store.setItem(
        cache.keyFor(COORDS_LAHTI),
        JSON.stringify({ version: 0, fetchedAt: 1, value: FORECAST }),
      );
      const r = cache.read(COORDS_LAHTI);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error.kind).toBe('version-mismatch');
    });
  });

  describe('write + read round-trip', () => {
    it('writes then reads back the same forecast with the recorded `fetchedAt`', () => {
      const store = createMemoryStore();
      const cache = createForecastCache(store);
      cache.write(COORDS_LAHTI, FORECAST, 1_700_000_000_000);

      const r = cache.read(COORDS_LAHTI);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.entry.fetchedAt).toBe(1_700_000_000_000);
      expect(r.entry.version).toBe(CACHE_VERSION);
      expect(r.entry.value.timezone).toBe(FORECAST.timezone);
      expect(r.entry.value.current.temperature_2m).toBe(FORECAST.current.temperature_2m);
    });

    it('uses a deterministic key derived from coordinates', () => {
      const cache = createForecastCache(createMemoryStore());
      const k = cache.keyFor(COORDS_LAHTI);
      expect(k.startsWith(CACHE_KEY_PREFIX)).toBe(true);
      expect(k).toContain('60.9800');
      expect(k).toContain('25.6600');
    });

    it('stores different coordinates under different keys', () => {
      const store = createMemoryStore();
      const cache = createForecastCache(store);
      cache.write(COORDS_LAHTI, FORECAST, 10);
      cache.write(COORDS_HELSINKI, FORECAST, 20);

      const a = cache.read(COORDS_LAHTI);
      const b = cache.read(COORDS_HELSINKI);
      expect(a.ok).toBe(true);
      expect(b.ok).toBe(true);
      if (!a.ok || !b.ok) return;
      expect(a.entry.fetchedAt).toBe(10);
      expect(b.entry.fetchedAt).toBe(20);
    });

    it('overwrites the same key on a second write (last-write-wins)', () => {
      const store = createMemoryStore();
      const cache = createForecastCache(store);
      cache.write(COORDS_LAHTI, FORECAST, 1);
      cache.write(COORDS_LAHTI, FORECAST, 2);
      const r = cache.read(COORDS_LAHTI);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.entry.fetchedAt).toBe(2);
    });
  });

  describe('clear', () => {
    it('removes the entry so the next read is `missing`', () => {
      const store = createMemoryStore();
      const cache = createForecastCache(store);
      cache.write(COORDS_LAHTI, FORECAST, 1);
      cache.clear(COORDS_LAHTI);
      const r = cache.read(COORDS_LAHTI);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error.kind).toBe('missing');
    });
  });
});
