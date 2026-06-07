// Tests for `loadCachedThenRefresh` — the stale-while-revalidate orchestrator.
//
// Strategy:
//   - In-memory KV store + real `ForecastCache` so the cache contract is
//     exercised end-to-end (write → re-read).
//   - Injected `fetchImpl` so we never touch the network and can simulate
//     per-slot success/failure.
//   - Injected `now` so all freshness assertions are deterministic.

import { describe, expect, it, vi } from 'vitest';
import lahtiFixture from '../weather/__fixtures__/forecast-lahti.json' with { type: 'json' };
import { createForecastCache } from './forecast-cache';
import { createMemoryStore } from './key-value-store';
import { loadCachedThenRefresh } from './swr';
import type { Location } from '../locations/types';

const ALPHA: Location = { name: 'Alpha', lat: 60, lon: 25 };
const BETA: Location = { name: 'Beta', lat: 59, lon: 24 };

function makeResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function urlMatchesLat(url: string, lat: number): boolean {
  // Open-Meteo URL contains `latitude=<lat>` — match the integer prefix to
  // dodge `.0` formatting variance.
  return url.includes(`latitude=${lat}`);
}

describe('loadCachedThenRefresh', () => {
  it('cold start + offline → initial is null-forecasts and refresh does NOT call fetch', async () => {
    const store = createMemoryStore();
    const cache = createForecastCache(store);
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    const swr = loadCachedThenRefresh([ALPHA, BETA], cache, {
      fetchImpl,
      now: () => 1_000,
      isOnline: () => false,
    });

    expect(swr.initial.map((s) => s.forecast)).toEqual([null, null]);
    expect(swr.initial.map((s) => s.fetchedAt)).toEqual([null, null]);

    const refreshed = await swr.refresh();
    expect(refreshed).toBe(swr.initial); // same array — no work done
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it('cold start + online → fetches each slot in parallel and populates the cache', async () => {
    const store = createMemoryStore();
    const cache = createForecastCache(store);
    const fetchImpl = vi.fn(
      async (): Promise<Response> => makeResponse(200, lahtiFixture),
    ) as unknown as typeof fetch;

    const swr = loadCachedThenRefresh([ALPHA, BETA], cache, {
      fetchImpl,
      now: () => 5_000,
      isOnline: () => true,
    });

    expect(swr.initial.map((s) => s.forecast)).toEqual([null, null]);

    const refreshed = await swr.refresh();
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
    expect(refreshed[0]?.forecast).not.toBeNull();
    expect(refreshed[1]?.forecast).not.toBeNull();
    expect(refreshed[0]?.fetchedAt).toBe(5_000);
    expect(refreshed[1]?.fetchedAt).toBe(5_000);

    // Cache populated for the next bootstrap.
    const reread = cache.read({ lat: ALPHA.lat, lon: ALPHA.lon });
    expect(reread.ok).toBe(true);
  });

  it('warm cache + offline → initial reflects cached forecasts; refresh skips fetch', async () => {
    const store = createMemoryStore();
    const cache = createForecastCache(store);
    cache.write({ lat: ALPHA.lat, lon: ALPHA.lon }, lahtiFixture as never, 100);
    cache.write({ lat: BETA.lat, lon: BETA.lon }, lahtiFixture as never, 200);

    const fetchImpl = vi.fn() as unknown as typeof fetch;

    const swr = loadCachedThenRefresh([ALPHA, BETA], cache, {
      fetchImpl,
      now: () => 1_000,
      isOnline: () => false,
    });

    expect(swr.initial[0]?.forecast).not.toBeNull();
    expect(swr.initial[0]?.fetchedAt).toBe(100);
    expect(swr.initial[1]?.fetchedAt).toBe(200);

    const refreshed = await swr.refresh();
    expect(refreshed).toBe(swr.initial);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it('warm cache + partial failure → updated slot refreshed, failed slot keeps old cache', async () => {
    const store = createMemoryStore();
    const cache = createForecastCache(store);
    cache.write({ lat: ALPHA.lat, lon: ALPHA.lon }, lahtiFixture as never, 100);
    cache.write({ lat: BETA.lat, lon: BETA.lon }, lahtiFixture as never, 200);

    // Alpha (lat=60) succeeds; Beta (lat=59) → 404 (non-retryable).
    const fetchImpl = vi.fn(async (input: Request | string | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      if (urlMatchesLat(url, 60)) return makeResponse(200, lahtiFixture);
      return makeResponse(404, { error: 'not found' });
    }) as unknown as typeof fetch;

    const swr = loadCachedThenRefresh([ALPHA, BETA], cache, {
      fetchImpl,
      now: () => 9_999,
      isOnline: () => true,
    });

    const refreshed = await swr.refresh();
    // Alpha: updated to now=9999
    expect(refreshed[0]?.forecast).not.toBeNull();
    expect(refreshed[0]?.fetchedAt).toBe(9_999);
    // Beta: kept previous cache entry (no blank)
    expect(refreshed[1]?.forecast).not.toBeNull();
    expect(refreshed[1]?.fetchedAt).toBe(200);
  });

  it('corrupt cache entry → treated as cold without throwing', async () => {
    const store = createMemoryStore();
    const cache = createForecastCache(store);
    // Corrupt the entry for Alpha — wrong version.
    store.setItem(
      cache.keyFor({ lat: ALPHA.lat, lon: ALPHA.lon }),
      JSON.stringify({ version: 99, fetchedAt: 1, value: lahtiFixture }),
    );

    const fetchImpl = vi.fn() as unknown as typeof fetch;

    const swr = loadCachedThenRefresh([ALPHA], cache, {
      fetchImpl,
      now: () => 0,
      isOnline: () => false,
    });

    expect(swr.initial[0]?.forecast).toBeNull();
    expect(swr.initial[0]?.fetchedAt).toBeNull();
  });

  it('empty locations array → initial is empty and refresh resolves without fetches', async () => {
    const store = createMemoryStore();
    const cache = createForecastCache(store);
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    const swr = loadCachedThenRefresh([], cache, {
      fetchImpl,
      now: () => 0,
      isOnline: () => true,
    });

    expect(swr.initial.length).toBe(0);
    const refreshed = await swr.refresh();
    expect(refreshed.length).toBe(0);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });
});
