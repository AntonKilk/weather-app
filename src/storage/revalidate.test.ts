import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocationSlot } from '../locations/types';
import { SAMPLE_FORECAST } from '../weather/fixtures/open-meteo-forecast.fixture';
import type { FetchResult, ForecastResponse } from '../weather/types';
import type { CacheSnapshot, ForecastCache, WriteResult } from './forecast-cache';
import { revalidate, type Fetcher } from './revalidate';

function slot(id: string, lat = 0, lon = 0): LocationSlot {
  return { id, name: id.toUpperCase(), latitude: lat, longitude: lon, kind: 'default' };
}

function ok(): FetchResult<ForecastResponse> {
  return { ok: true, data: SAMPLE_FORECAST };
}

function err(): FetchResult<ForecastResponse> {
  return { ok: false, error: { kind: 'server', status: 503, message: 'HTTP 503' } };
}

interface MemCache extends ForecastCache {
  data: CacheSnapshot;
  writes: string[];
}

function memCache(initial: CacheSnapshot = {}, opts: { writeFails?: boolean } = {}): MemCache {
  const data: CacheSnapshot = { ...initial };
  const writes: string[] = [];
  return {
    data,
    writes,
    read: () => ({ ok: true, data }),
    writeSlot: (id, s): WriteResult => {
      writes.push(id);
      if (opts.writeFails) {
        return { ok: false, reason: { kind: 'quota', message: 'simulated' } };
      }
      data[id] = s;
      return { ok: true };
    },
    removeSlot: (id) => {
      delete data[id];
      return { ok: true };
    },
    clear: () => {
      for (const k of Object.keys(data)) delete data[k];
      return { ok: true };
    },
  };
}

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('revalidate', () => {
  it('returns empty result and does not call the fetcher when slots is empty', async () => {
    const cache = memCache();
    const fetcher = vi.fn<Fetcher>(async () => ok());
    const result = await revalidate([], { cache, fetchForecast: fetcher });
    expect(result).toEqual({ snapshot: {}, refreshed: [], failed: [] });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('on full success: writes every slot, returns merged snapshot with the injected now()', async () => {
    const slots = [slot('a'), slot('b'), slot('c')];
    const cache = memCache();
    const fetcher = vi.fn<Fetcher>(async () => ok());
    const result = await revalidate(slots, {
      cache,
      fetchForecast: fetcher,
      now: () => 1_700_000_000_000,
    });

    expect([...result.refreshed].sort()).toEqual(['a', 'b', 'c']);
    expect(result.failed).toEqual([]);
    expect([...cache.writes].sort()).toEqual(['a', 'b', 'c']);
    expect(Object.keys(result.snapshot).sort()).toEqual(['a', 'b', 'c']);
    for (const id of ['a', 'b', 'c']) {
      expect(result.snapshot[id]?.fetchedAt).toBe(1_700_000_000_000);
      expect(result.snapshot[id]?.forecast).toBe(SAMPLE_FORECAST);
    }
  });

  it('on partial failure: keeps existing cache for the failed slot, refreshes the others', async () => {
    const slots = [slot('a'), slot('b'), slot('c')];
    const initial: CacheSnapshot = {
      b: { forecast: SAMPLE_FORECAST, fetchedAt: 100 },
    };
    const cache = memCache(initial);
    const fetcher = vi.fn<Fetcher>(async (lat) => (lat === 2 ? err() : ok()));
    const result = await revalidate(
      slots.map((s, i) => ({ ...s, latitude: i + 1 })) as LocationSlot[],
      { cache, fetchForecast: fetcher, now: () => 200 },
    );

    expect([...result.refreshed].sort()).toEqual(['a', 'c']);
    expect(result.failed).toEqual(['b']);
    expect([...cache.writes].sort()).toEqual(['a', 'c']);
    expect(result.snapshot.b?.fetchedAt).toBe(100);
    expect(result.snapshot.a?.fetchedAt).toBe(200);
    expect(result.snapshot.c?.fetchedAt).toBe(200);
  });

  it('on all-fail: never touches the cache, snapshot equals the pre-cycle read', async () => {
    const slots = [slot('a'), slot('b')];
    const initial: CacheSnapshot = {
      a: { forecast: SAMPLE_FORECAST, fetchedAt: 10 },
      b: { forecast: SAMPLE_FORECAST, fetchedAt: 20 },
    };
    const cache = memCache(initial);
    const fetcher = vi.fn<Fetcher>(async () => err());
    const result = await revalidate(slots, {
      cache,
      fetchForecast: fetcher,
      now: () => 999,
    });

    expect(result.refreshed).toEqual([]);
    expect([...result.failed].sort()).toEqual(['a', 'b']);
    expect(cache.writes).toEqual([]);
    expect(result.snapshot.a?.fetchedAt).toBe(10);
    expect(result.snapshot.b?.fetchedAt).toBe(20);
  });

  it('cache write failure is non-fatal: snapshot still surfaces fresh data via the in-memory delta', async () => {
    const slots = [slot('a')];
    const cache = memCache({}, { writeFails: true });
    const fetcher = vi.fn<Fetcher>(async () => ok());
    const result = await revalidate(slots, {
      cache,
      fetchForecast: fetcher,
      now: () => 500,
    });

    expect(result.refreshed).toEqual(['a']);
    // Cache.writeSlot was called, but the underlying store didn't accept it.
    expect(cache.writes).toEqual(['a']);
    expect(cache.data.a).toBeUndefined();
    // Yet the returned snapshot still has the fresh entry for the caller to render.
    expect(result.snapshot.a?.fetchedAt).toBe(500);
    expect(result.snapshot.a?.forecast).toBe(SAMPLE_FORECAST);
  });

  it('unsupported cache: snapshot is the in-memory delta only', async () => {
    const slots = [slot('a'), slot('b')];
    const cache: ForecastCache = {
      read: () => ({ ok: false, reason: { kind: 'unsupported' } }),
      writeSlot: () => ({ ok: false, reason: { kind: 'unsupported' } }),
      removeSlot: () => ({ ok: false, reason: { kind: 'unsupported' } }),
      clear: () => ({ ok: false, reason: { kind: 'unsupported' } }),
    };
    const fetcher = vi.fn<Fetcher>(async () => ok());
    const result = await revalidate(slots, {
      cache,
      fetchForecast: fetcher,
      now: () => 1,
    });

    expect([...result.refreshed].sort()).toEqual(['a', 'b']);
    expect(Object.keys(result.snapshot).sort()).toEqual(['a', 'b']);
  });

  it('issues every fetch concurrently (does not await one before starting the next)', async () => {
    const slots = [slot('a'), slot('b'), slot('c')];
    const cache = memCache();
    let inFlight = 0;
    let maxInFlight = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetcher: Fetcher = async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await gate;
      inFlight -= 1;
      return ok();
    };

    const pending = revalidate(slots, { cache, fetchForecast: fetcher });
    await Promise.resolve();
    await Promise.resolve();
    expect(maxInFlight).toBe(3);
    release();
    await pending;
  });

  it('never throws when the fetcher returns a rejected promise (defense in depth)', async () => {
    const slots = [slot('a')];
    const cache = memCache();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetcher: Fetcher = async () => {
      throw new Error('fetcher exploded');
    };
    const result = await revalidate(slots, { cache, fetchForecast: fetcher });
    expect(result.refreshed).toEqual([]);
    expect(result.failed).toEqual(['a']);
  });
});
