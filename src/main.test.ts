// Integration tests for `bootstrap()` — wires env parsing + Open-Meteo client
// + on-device cache (STORY-007) + custom-slot store (STORY-009) + UI rendering.
// No real network or storage: `fetchImpl`, `cacheStore`, and the custom-slot
// `storage` are stubbed in each test.

import { afterEach, describe, expect, it, vi } from 'vitest';
import lahtiFixture from './weather/__fixtures__/forecast-lahti.json' with { type: 'json' };
import { bootstrap, type DocumentLike } from './main';
import { CACHE_KEY_PREFIX, CACHE_VERSION, createMemoryStore } from './storage';
import type { KeyValueStore } from './storage';
import {
  CUSTOM_SLOTS_STORAGE_KEY,
  MAX_CUSTOM_SLOTS,
  createCustomSlotStore,
} from './locations/custom-slots';

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

// In-memory Storage stub mirroring the one in custom-slots.test.ts but
// kept local so the two test suites stay independent.
function createMemoryStorage(seed: Record<string, string> = {}): Storage {
  const data = new Map<string, string>(Object.entries(seed));
  return {
    get length(): number {
      return data.size;
    },
    clear(): void {
      data.clear();
    },
    getItem(key: string): string | null {
      return data.has(key) ? (data.get(key) as string) : null;
    },
    key(index: number): string | null {
      return Array.from(data.keys())[index] ?? null;
    },
    removeItem(key: string): void {
      data.delete(key);
    },
    setItem(key: string, value: string): void {
      data.set(key, String(value));
    },
  } satisfies Storage;
}

function freshStore() {
  return createCustomSlotStore({ storage: createMemoryStorage() });
}

function selectors(root: HTMLElement) {
  // Distinguish "real" cards (rendered location names) from the empty
  // placeholders that pad the custom-slot region to MAX_CUSTOM_SLOTS.
  const all = root.querySelectorAll('main.list button.card');
  const named = root.querySelectorAll('main.list button.card .card-name');
  const empty = root.querySelectorAll('main.list button.card.card--empty');
  return { all, named, empty };
}

function root(): HTMLElement {
  return document.createElement('div');
}

describe('bootstrap', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders one card per default location plus padding for empty custom slots', async () => {
    const r = document.createElement('div');
    const fetchImpl = vi.fn(
      async (): Promise<Response> => makeResponse(200, lahtiFixture),
    ) as unknown as typeof fetch;

    await bootstrap(r, {
      rawEnv: FOUR_LOCATIONS,
      fetchImpl,
      customSlotStore: freshStore(),
      cacheStore: createMemoryStore(),
      isOnline: () => true,
      documentImpl: null,
    });

    const { all, named, empty } = selectors(r);
    expect(named.length).toBe(4);
    expect(empty.length).toBe(MAX_CUSTOM_SLOTS);
    expect(all.length).toBe(4 + MAX_CUSTOM_SLOTS);

    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(4);
  });

  it('renders default cards with per-slot isolation on failure', async () => {
    const r = document.createElement('div');

    // Alpha → 200 OK with fixture; Beta → 404 → forecast=null.
    const fetchImpl = vi.fn(async (input: Request | string | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('latitude=60')) {
        return makeResponse(200, lahtiFixture);
      }
      return makeResponse(404, { error: 'not found' });
    }) as unknown as typeof fetch;

    await bootstrap(r, {
      rawEnv: TWO_LOCATIONS,
      fetchImpl,
      customSlotStore: freshStore(),
      cacheStore: createMemoryStore(),
      isOnline: () => true,
      documentImpl: null,
    });

    const { named } = selectors(r);
    expect(named.length).toBe(2);
    const names = Array.from(named).map((n) => n.textContent);
    expect(names).toEqual(['Alpha', 'Beta']);

    const allCards = r.querySelectorAll('main.list button.card');
    // Alpha is index 0 — has a forecast.
    expect(allCards[0]?.querySelector('.card-temp')?.textContent).toMatch(/^-?\d+°$/);
    // Beta is index 1 — 404, "Unavailable".
    expect(allCards[1]?.textContent).toContain('Unavailable');
    expect(allCards[1]?.querySelector('.card-temp')).toBeNull();
  });

  it('logs an error and renders zero named cards when env is missing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const r = document.createElement('div');

    await bootstrap(r, {
      rawEnv: undefined,
      fetchImpl,
      customSlotStore: freshStore(),
      cacheStore: createMemoryStore(),
      isOnline: () => true,
      documentImpl: null,
    });

    expect(errorSpy).toHaveBeenCalled();
    const message = errorSpy.mock.calls[0]?.[0] as string | undefined;
    expect(message).toMatch(/VITE_DEFAULT_LOCATIONS/);
    expect(message).toMatch(/missing/);

    // App still rendered (header + footer present); the only cards are the
    // 2 empty custom-slot placeholders.
    expect(r.querySelector('.app-header')).not.toBeNull();
    expect(r.querySelector('.app-footer a')?.textContent).toBe('Weather data by Open-Meteo');
    const { named, empty } = selectors(r);
    expect(named.length).toBe(0);
    expect(empty.length).toBe(MAX_CUSTOM_SLOTS);

    // No fetch calls were made (no default locations to fetch).
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it('logs an error and renders zero named cards when env JSON is malformed', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const r = document.createElement('div');

    await bootstrap(r, {
      rawEnv: 'not-json',
      fetchImpl,
      customSlotStore: freshStore(),
      cacheStore: createMemoryStore(),
      isOnline: () => true,
      documentImpl: null,
    });

    expect(errorSpy).toHaveBeenCalled();
    const message = errorSpy.mock.calls[0]?.[0] as string | undefined;
    expect(message).toMatch(/malformed-json/);
    const { named } = selectors(r);
    expect(named.length).toBe(0);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it('renders zero named cards and makes no default-fetches for an empty array env', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const r = document.createElement('div');

    await bootstrap(r, {
      rawEnv: '[]',
      fetchImpl,
      customSlotStore: freshStore(),
      cacheStore: createMemoryStore(),
      isOnline: () => true,
      documentImpl: null,
    });

    const { named } = selectors(r);
    expect(named.length).toBe(0);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    // Header + footer (attribution) still render — empty list is a normal state.
    expect(r.querySelector('.app-footer a')?.textContent).toBe('Weather data by Open-Meteo');
  });

  // -------------------------------------------------------------------------
  // STORY-009: custom slot lifecycle through bootstrap
  // -------------------------------------------------------------------------

  it('renders persisted custom slots from the store on first render', async () => {
    const storage = createMemoryStorage({
      [CUSTOM_SLOTS_STORAGE_KEY]: JSON.stringify([{ name: 'Persisted', lat: 50, lon: 10 }]),
    });
    const customSlotStore = createCustomSlotStore({ storage });
    const fetchImpl = vi.fn(
      async (): Promise<Response> => makeResponse(200, lahtiFixture),
    ) as unknown as typeof fetch;
    const r = document.createElement('div');

    await bootstrap(r, {
      rawEnv: TWO_LOCATIONS,
      fetchImpl,
      customSlotStore,
      cacheStore: createMemoryStore(),
      isOnline: () => true,
      documentImpl: null,
    });

    const names = Array.from(r.querySelectorAll('main.list .card-name')).map(
      (n) => n.textContent,
    );
    // 2 defaults + 1 custom; the second custom slot is the empty placeholder.
    expect(names).toEqual(['Alpha', 'Beta', 'Persisted']);

    // 3 named cards → 3 forecast fetches.
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3);
  });

  it('re-renders and fetches when a custom slot is added at runtime', async () => {
    const storage = createMemoryStorage();
    const customSlotStore = createCustomSlotStore({ storage });
    const fetchImpl = vi.fn(
      async (): Promise<Response> => makeResponse(200, lahtiFixture),
    ) as unknown as typeof fetch;
    const r = document.createElement('div');

    await bootstrap(r, {
      rawEnv: TWO_LOCATIONS,
      fetchImpl,
      customSlotStore,
      cacheStore: createMemoryStore(),
      isOnline: () => true,
      documentImpl: null,
    });

    // Sanity: 2 named cards before add.
    expect(r.querySelectorAll('main.list .card-name').length).toBe(2);
    const fetchBefore = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(fetchBefore).toBe(2);

    // Simulate the user picking a location from the autocomplete.
    customSlotStore.add({ name: 'NewPlace', lat: 45, lon: 9 });

    // Subscriber triggers a fresh render via `rebuildAndRender` — give microtasks a turn.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const names = Array.from(r.querySelectorAll('main.list .card-name')).map(
      (n) => n.textContent,
    );
    expect(names).toEqual(['Alpha', 'Beta', 'NewPlace']);

    // At least one additional fetch — Phase 1 re-fetches all named slots when
    // the grid changes (cache absorbs the cost of repeats).
    const fetchAfter = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(fetchAfter).toBeGreaterThan(fetchBefore);

    // Persisted to storage too.
    const raw = storage.getItem(CUSTOM_SLOTS_STORAGE_KEY);
    expect(JSON.parse(raw as string)).toEqual([{ name: 'NewPlace', lat: 45, lon: 9 }]);
  });

  it('removes a custom slot and clears its persisted entry', async () => {
    const storage = createMemoryStorage({
      [CUSTOM_SLOTS_STORAGE_KEY]: JSON.stringify([{ name: 'Trip', lat: 50, lon: 10 }]),
    });
    const customSlotStore = createCustomSlotStore({ storage });
    const fetchImpl = vi.fn(
      async (): Promise<Response> => makeResponse(200, lahtiFixture),
    ) as unknown as typeof fetch;
    const r = document.createElement('div');

    await bootstrap(r, {
      rawEnv: TWO_LOCATIONS,
      fetchImpl,
      customSlotStore,
      cacheStore: createMemoryStore(),
      isOnline: () => true,
      documentImpl: null,
    });

    // The custom card has a remove button. Default cards do not.
    const removeButtons = r.querySelectorAll('main.list .card-remove');
    expect(removeButtons.length).toBe(1);

    (removeButtons[0] as HTMLElement).click();

    // Subscriber triggers an async re-render; wait for it.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const names = Array.from(r.querySelectorAll('main.list .card-name')).map(
      (n) => n.textContent,
    );
    expect(names).toEqual(['Alpha', 'Beta']);

    // Persistence reflects the removal.
    const raw = storage.getItem(CUSTOM_SLOTS_STORAGE_KEY);
    expect(JSON.parse(raw as string)).toEqual([]);
  });

  it('caps custom slots at MAX_CUSTOM_SLOTS — additional adds are rejected', async () => {
    const storage = createMemoryStorage();
    const customSlotStore = createCustomSlotStore({ storage });
    const fetchImpl = vi.fn(
      async (): Promise<Response> => makeResponse(200, lahtiFixture),
    ) as unknown as typeof fetch;
    const r = document.createElement('div');

    await bootstrap(r, {
      rawEnv: TWO_LOCATIONS,
      fetchImpl,
      customSlotStore,
      cacheStore: createMemoryStore(),
      isOnline: () => true,
      documentImpl: null,
    });

    expect(customSlotStore.add({ name: 'X', lat: 1, lon: 1 }).ok).toBe(true);
    expect(customSlotStore.add({ name: 'Y', lat: 2, lon: 2 }).ok).toBe(true);
    const third = customSlotStore.add({ name: 'Z', lat: 3, lon: 3 });
    expect(third.ok).toBe(false);

    expect(customSlotStore.canAdd()).toBe(false);
    expect(customSlotStore.list().length).toBe(MAX_CUSTOM_SLOTS);
  });

  it('custom slot data never leaves the device — only lat/lon hits Open-Meteo, no `name` in the URL', async () => {
    const storage = createMemoryStorage({
      [CUSTOM_SLOTS_STORAGE_KEY]: JSON.stringify([
        { name: 'SecretPlace', lat: 12.345, lon: 67.89 },
      ]),
    });
    const customSlotStore = createCustomSlotStore({ storage });
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: Request | string | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push(url);
      return makeResponse(200, lahtiFixture);
    }) as unknown as typeof fetch;

    await bootstrap(root(), {
      rawEnv: TWO_LOCATIONS,
      fetchImpl,
      customSlotStore,
      cacheStore: createMemoryStore(),
      isOnline: () => true,
      documentImpl: null,
    });

    for (const url of calls) {
      expect(url).not.toContain('SecretPlace');
    }
    // One call should include the secret coords.
    expect(calls.some((u) => u.includes('latitude=12.345'))).toBe(true);
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
    const r = document.createElement('div');
    const store = createMemoryStore();
    // Seed the cache for both Alpha (lat=60) and Beta (lat=59), fetched 5 minutes ago.
    const now = 1_700_000_000_000;
    seedCache(store, { lat: 60, lon: 25 }, now - 5 * 60_000);
    seedCache(store, { lat: 59, lon: 24 }, now - 5 * 60_000);

    const fetchImpl = vi.fn() as unknown as typeof fetch;

    await bootstrap(r, {
      rawEnv: TWO_LOCATIONS,
      fetchImpl,
      cacheStore: store,
      customSlotStore: freshStore(),
      now: () => now,
      isOnline: () => false,
      documentImpl: null,
    });

    // Both cards have real forecasts (from cache) — no "Unavailable" state.
    expect(r.textContent).not.toContain('Unavailable');
    const temps = r.querySelectorAll('.card-temp');
    expect(temps.length).toBe(2);

    // Freshness stamp present and matches "Updated Nm ago" pattern.
    const stamp = r.querySelector('.app-header .last-updated');
    expect(stamp?.textContent).toBe('Updated 5m ago');

    // No network calls.
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it('persists fetched forecasts to the cache for the next cold start', async () => {
    const r = document.createElement('div');
    const store = createMemoryStore();
    const fetchImpl = vi.fn(
      async (): Promise<Response> => makeResponse(200, lahtiFixture),
    ) as unknown as typeof fetch;

    await bootstrap(r, {
      rawEnv: TWO_LOCATIONS,
      fetchImpl,
      cacheStore: store,
      customSlotStore: freshStore(),
      now: () => 1_700_000_000_000,
      isOnline: () => true,
      documentImpl: null,
    });

    // Both forecasts now in the cache.
    expect(store.getItem(`${CACHE_KEY_PREFIX}60.0000,25.0000`)).not.toBeNull();
    expect(store.getItem(`${CACHE_KEY_PREFIX}59.0000,24.0000`)).not.toBeNull();
  });

  it('refreshes on visibilitychange when data is older than 30 minutes', async () => {
    const r = document.createElement('div');
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

    await bootstrap(r, {
      rawEnv: TWO_LOCATIONS,
      fetchImpl,
      cacheStore: store,
      customSlotStore: freshStore(),
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
    const r = document.createElement('div');
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

    await bootstrap(r, {
      rawEnv: TWO_LOCATIONS,
      fetchImpl,
      cacheStore: store,
      customSlotStore: freshStore(),
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
    const r = document.createElement('div');
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

    await bootstrap(r, {
      rawEnv: TWO_LOCATIONS,
      fetchImpl,
      cacheStore: store,
      customSlotStore: freshStore(),
      now: () => 1_700_000_000_000,
      isOnline: () => true,
      documentImpl: null,
    });

    // Both default cards still render with a forecast; nothing reads "Unavailable".
    expect(r.textContent).not.toContain('Unavailable');
    const named = r.querySelectorAll('main.list button.card .card-name');
    expect(named.length).toBe(2);
    const namedCards = Array.from(r.querySelectorAll('main.list button.card')).filter(
      (c) => c.querySelector('.card-name') !== null,
    );
    namedCards.forEach((card) => {
      expect(card.querySelector('.card-temp')?.textContent).toMatch(/^-?\d+°$/);
    });
  });
});
