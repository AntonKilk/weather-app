// Integration tests for `bootstrap()` — wires env parsing + Open-Meteo client
// + on-device cache (STORY-007) + UI rendering. No real network or storage:
// `fetchImpl` and `cacheStore` are stubbed.

import { afterEach, describe, expect, it, vi } from 'vitest';
import lahtiFixture from './weather/__fixtures__/forecast-lahti.json' with { type: 'json' };
import { bootstrap, type DocumentLike } from './main';
import { CACHE_KEY_PREFIX, CACHE_VERSION, createMemoryStore } from './storage';
import type { KeyValueStore } from './storage';

function makeResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const TWO_LOCATIONS = JSON.stringify([
  { name: 'Alpha', lat: 60, lon: 25 },
  { name: 'Beta', lat: 59, lon: 24 },
]);

const FOUR_LOCATIONS = JSON.stringify([
  { name: 'A', lat: 60, lon: 25 },
  { name: 'B', lat: 59, lon: 24 },
  { name: 'C', lat: 58, lon: 23 },
  { name: 'D', lat: 57, lon: 22 },
]);

describe('bootstrap', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders one card per parsed location, with per-slot isolation on failure', async () => {
    const root = document.createElement('div');

    // Alpha → 200 OK with fixture; Beta → 404 → forecast=null.
    // (404 is in the 4xx range and is never retried by the client, keeping
    // the test fast — see open-meteo-client.ts retry policy.)
    const fetchImpl = vi.fn(async (input: Request | string | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('latitude=60')) {
        return makeResponse(200, lahtiFixture);
      }
      return makeResponse(404, { error: 'not found' });
    }) as unknown as typeof fetch;

    await bootstrap(root, { rawEnv: TWO_LOCATIONS, fetchImpl });

    const cards = root.querySelectorAll('main.list button.card');
    expect(cards.length).toBe(2);

    const names = Array.from(root.querySelectorAll('.card-name')).map((n) => n.textContent);
    expect(names).toEqual(['Alpha', 'Beta']);

    // Alpha has a full forecast → temp + meta render.
    const alphaCard = cards[0];
    expect(alphaCard?.querySelector('.card-temp')?.textContent).toMatch(/^-?\d+°$/);

    // Beta failed → "Unavailable" state.
    const betaCard = cards[1];
    expect(betaCard?.textContent).toContain('Unavailable');
    expect(betaCard?.querySelector('.card-temp')).toBeNull();
  });

  it('logs an error and renders zero cards when env is missing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const root = document.createElement('div');

    await bootstrap(root, { rawEnv: undefined, fetchImpl });

    expect(errorSpy).toHaveBeenCalled();
    const message = errorSpy.mock.calls[0]?.[0] as string | undefined;
    expect(message).toMatch(/VITE_DEFAULT_LOCATIONS/);
    expect(message).toMatch(/missing/);

    // App still rendered (header + footer present), just no cards.
    expect(root.querySelector('.app-header')).not.toBeNull();
    expect(root.querySelector('.app-footer a')?.textContent).toBe('Weather data by Open-Meteo');
    expect(root.querySelectorAll('main.list button.card').length).toBe(0);

    // No fetch calls were made.
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it('logs an error and renders zero cards when env JSON is malformed', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const root = document.createElement('div');

    await bootstrap(root, { rawEnv: 'not-json', fetchImpl });

    expect(errorSpy).toHaveBeenCalled();
    const message = errorSpy.mock.calls[0]?.[0] as string | undefined;
    expect(message).toMatch(/malformed-json/);
    expect(root.querySelectorAll('main.list button.card').length).toBe(0);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it('renders zero cards and makes no fetches for an empty array env', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const root = document.createElement('div');

    await bootstrap(root, { rawEnv: '[]', fetchImpl });

    expect(root.querySelectorAll('main.list button.card').length).toBe(0);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    // Header + footer (attribution) still render — empty list is a normal state.
    expect(root.querySelector('.app-footer a')?.textContent).toBe('Weather data by Open-Meteo');
  });

  it('fetches once per location and renders 4 cards on full success', async () => {
    const root = document.createElement('div');
    const fetchImpl = vi.fn(
      async (): Promise<Response> => makeResponse(200, lahtiFixture),
    ) as unknown as typeof fetch;

    await bootstrap(root, { rawEnv: FOUR_LOCATIONS, fetchImpl });

    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(4);
    expect(root.querySelectorAll('main.list button.card').length).toBe(4);
    expect(root.querySelector('.app-footer a')?.textContent).toBe('Weather data by Open-Meteo');
  });
});

// ---------------------------------------------------------------------------
// STORY-007: cache-first paint + visibilitychange refresh
// ---------------------------------------------------------------------------

function seedCache(
  store: KeyValueStore,
  coords: { lat: number; lon: number },
  fetchedAt: number,
): void {
  const key = `${CACHE_KEY_PREFIX}${coords.lat.toFixed(4)},${coords.lon.toFixed(4)}`;
  store.setItem(
    key,
    JSON.stringify({ version: CACHE_VERSION, fetchedAt, value: lahtiFixture }),
  );
}

describe('bootstrap — offline cache + SWR', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders cached forecasts when offline (no fetches, "Updated …" stamp present)', async () => {
    const root = document.createElement('div');
    const store = createMemoryStore();
    // Seed the cache for both Alpha (lat=60) and Beta (lat=59), fetched 5 minutes ago.
    const now = 1_700_000_000_000;
    seedCache(store, { lat: 60, lon: 25 }, now - 5 * 60_000);
    seedCache(store, { lat: 59, lon: 24 }, now - 5 * 60_000);

    const fetchImpl = vi.fn() as unknown as typeof fetch;

    await bootstrap(root, {
      rawEnv: TWO_LOCATIONS,
      fetchImpl,
      cacheStore: store,
      now: () => now,
      isOnline: () => false,
      documentImpl: null,
    });

    // Both cards have real forecasts (from cache) — no "Unavailable" state.
    expect(root.textContent).not.toContain('Unavailable');
    const temps = root.querySelectorAll('.card-temp');
    expect(temps.length).toBe(2);

    // Freshness stamp present and matches "Updated Nm ago" pattern.
    const stamp = root.querySelector('.app-header .last-updated');
    expect(stamp?.textContent).toBe('Updated 5m ago');

    // No network calls.
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it('persists fetched forecasts to the cache for the next cold start', async () => {
    const root = document.createElement('div');
    const store = createMemoryStore();
    const fetchImpl = vi.fn(
      async (): Promise<Response> => makeResponse(200, lahtiFixture),
    ) as unknown as typeof fetch;

    await bootstrap(root, {
      rawEnv: TWO_LOCATIONS,
      fetchImpl,
      cacheStore: store,
      now: () => 1_700_000_000_000,
      isOnline: () => true,
      documentImpl: null,
    });

    // Both forecasts now in the cache.
    expect(store.getItem(`${CACHE_KEY_PREFIX}60.0000,25.0000`)).not.toBeNull();
    expect(store.getItem(`${CACHE_KEY_PREFIX}59.0000,24.0000`)).not.toBeNull();
  });

  it('refreshes on visibilitychange when data is older than 30 minutes', async () => {
    const root = document.createElement('div');
    const store = createMemoryStore();

    // Build a sequence of `now` values so that the cached data is "fresh"
    // initially-and-after-startup-refresh, then becomes "stale" exactly when
    // visibilitychange fires (35 min after seeding).
    const seededAt = 1_700_000_000_000;
    const callsBeforeVisible = 35 * 60_000;
    let nowOffset = 0;
    const now = (): number => seededAt + nowOffset;

    seedCache(store, { lat: 60, lon: 25 }, seededAt);
    seedCache(store, { lat: 59, lon: 24 }, seededAt);

    const fetchImpl = vi.fn(
      async (): Promise<Response> => makeResponse(200, lahtiFixture),
    ) as unknown as typeof fetch;

    // Fake document target — we capture the listener so we can dispatch.
    const handle: { listener: (() => void) | null } = { listener: null };
    let visibility: DocumentVisibilityState = 'hidden';
    const docImpl: DocumentLike = {
      get visibilityState() {
        return visibility;
      },
      addEventListener(_type, l) {
        handle.listener = l;
      },
    };

    await bootstrap(root, {
      rawEnv: TWO_LOCATIONS,
      fetchImpl,
      cacheStore: store,
      now,
      isOnline: () => true,
      documentImpl: docImpl,
    });

    // Startup refresh fires once (online) and re-writes the cache at now=0
    // offset.
    const startupCalls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(startupCalls).toBe(2);

    expect(handle.listener).not.toBeNull();

    // Advance time past the 30-minute staleness threshold and signal that the
    // tab became visible.
    nowOffset = callsBeforeVisible;
    visibility = 'visible';
    handle.listener?.();
    // Microtask flush for the awaited refresh inside the listener.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const afterVisibleCalls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(afterVisibleCalls).toBeGreaterThan(startupCalls);
  });

  it('does NOT refresh on visibilitychange when data is still fresh (< 30 min)', async () => {
    const root = document.createElement('div');
    const store = createMemoryStore();

    const seededAt = 1_700_000_000_000;
    let nowOffset = 0;
    const now = (): number => seededAt + nowOffset;

    seedCache(store, { lat: 60, lon: 25 }, seededAt);
    seedCache(store, { lat: 59, lon: 24 }, seededAt);

    const fetchImpl = vi.fn(
      async (): Promise<Response> => makeResponse(200, lahtiFixture),
    ) as unknown as typeof fetch;

    const handle: { listener: (() => void) | null } = { listener: null };
    let visibility: DocumentVisibilityState = 'hidden';
    const docImpl: DocumentLike = {
      get visibilityState() {
        return visibility;
      },
      addEventListener(_type, l) {
        handle.listener = l;
      },
    };

    await bootstrap(root, {
      rawEnv: TWO_LOCATIONS,
      fetchImpl,
      cacheStore: store,
      now,
      isOnline: () => true,
      documentImpl: docImpl,
    });

    const startupCalls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length;

    // Only 5 min passed — still fresh.
    nowOffset = 5 * 60_000;
    visibility = 'visible';
    handle.listener?.();
    await Promise.resolve();
    await Promise.resolve();

    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(startupCalls);
  });

  it('keeps the cached forecast for a slot whose refresh fails (no blank, no error overlay)', async () => {
    const root = document.createElement('div');
    const store = createMemoryStore();
    const seededAt = 1_700_000_000_000 - 60_000;
    seedCache(store, { lat: 60, lon: 25 }, seededAt);
    seedCache(store, { lat: 59, lon: 24 }, seededAt);

    // Alpha refresh succeeds; Beta → 404 (not retryable).
    const fetchImpl = vi.fn(async (input: Request | string | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('latitude=60')) return makeResponse(200, lahtiFixture);
      return makeResponse(404, { error: 'not found' });
    }) as unknown as typeof fetch;

    await bootstrap(root, {
      rawEnv: TWO_LOCATIONS,
      fetchImpl,
      cacheStore: store,
      now: () => 1_700_000_000_000,
      isOnline: () => true,
      documentImpl: null,
    });

    // Both cards still render with a forecast; nothing reads "Unavailable".
    expect(root.textContent).not.toContain('Unavailable');
    const cards = root.querySelectorAll('main.list button.card');
    expect(cards.length).toBe(2);
    cards.forEach((card) => {
      expect(card.querySelector('.card-temp')?.textContent).toMatch(/^-?\d+°$/);
    });
  });
});
