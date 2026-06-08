import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocationSlot } from '../locations/types';
import { SAMPLE_FORECAST } from './fixtures/open-meteo-forecast.fixture';
import { loadForecasts } from './load-forecasts';
import type { FetchResult } from './open-meteo-client';
import type { ForecastResponse } from './types';

type Fetcher = (lat: number, lon: number) => Promise<FetchResult<ForecastResponse>>;

function slot(id: string, name: string, lat: number, lon: number): LocationSlot {
  return { id, name, latitude: lat, longitude: lon, kind: 'default' };
}

function ok(): FetchResult<ForecastResponse> {
  return { ok: true, data: SAMPLE_FORECAST };
}

function err(): FetchResult<ForecastResponse> {
  return { ok: false, error: { kind: 'server', status: 503, message: 'HTTP 503' } };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadForecasts', () => {
  it('returns an empty map and does not call the fetcher when slots is empty', async () => {
    const fetcher = vi.fn<Fetcher>(async () => ok());
    const result = await loadForecasts([], { fetchForecast: fetcher });
    expect(result).toEqual({});
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('fetches every slot in parallel and keys the map by slot.id on full success', async () => {
    const slots = [slot('a', 'Alpha', 1, 2), slot('b', 'Beta', 3, 4), slot('c', 'Gamma', 5, 6)];
    const fetcher = vi.fn<Fetcher>(async () => ok());
    const result = await loadForecasts(slots, { fetchForecast: fetcher });

    expect(Object.keys(result).sort()).toEqual(['a', 'b', 'c']);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
  });

  it('omits failed slots, keeps successful ones, and console.warn names the failed slot', async () => {
    const slots = [slot('a', 'Alpha', 1, 1), slot('b', 'Beta', 2, 2), slot('c', 'Gamma', 3, 3)];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetcher = vi.fn<Fetcher>(async (lat) => (lat === 2 ? err() : ok()));

    const result = await loadForecasts(slots, { fetchForecast: fetcher });

    expect(Object.keys(result).sort()).toEqual(['a', 'c']);
    expect(result.b).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0] ?? '');
    expect(message).toContain('b');
    expect(message).toContain('Beta');
  });

  it('returns an empty map and warns per slot when every fetch fails — never throws', async () => {
    const slots = [slot('a', 'Alpha', 1, 1), slot('b', 'Beta', 2, 2)];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetcher = vi.fn<Fetcher>(async () => err());

    const result = await loadForecasts(slots, { fetchForecast: fetcher });

    expect(result).toEqual({});
    expect(warn).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('issues all fetches concurrently (does not await one before starting the next)', async () => {
    const slots = [slot('a', 'A', 1, 1), slot('b', 'B', 2, 2), slot('c', 'C', 3, 3)];
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

    const pending = loadForecasts(slots, { fetchForecast: fetcher });
    // Give the event loop a tick so the three fetches each enter the await.
    await Promise.resolve();
    await Promise.resolve();
    expect(maxInFlight).toBe(3);
    release();
    await pending;
  });

  it('uses the default fetcher when no deps are provided (empty slots path stays a no-network smoke)', async () => {
    // The default-fetcher path would hit the network — we deliberately
    // exercise it only with an empty slot list to prove the dep is optional
    // without making a real HTTP call.
    const result = await loadForecasts([]);
    expect(result).toEqual({});
  });
});
