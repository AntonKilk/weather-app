// Integration tests for `bootstrap()` — wires env parsing + Open-Meteo client
// + custom-slot store + UI rendering. No real network: `fetchImpl` is stubbed.
// No shared persistence: a fresh in-memory store per test (`storage: null` /
// injected `Storage`) keeps assertions deterministic.

import { afterEach, describe, expect, it, vi } from 'vitest';
import lahtiFixture from './weather/__fixtures__/forecast-lahti.json' with { type: 'json' };
import { bootstrap } from './main';
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

describe('bootstrap', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders one card per default location plus padding for empty custom slots', async () => {
    const root = document.createElement('div');
    const fetchImpl = vi.fn(
      async (): Promise<Response> => makeResponse(200, lahtiFixture),
    ) as unknown as typeof fetch;

    await bootstrap(root, {
      rawEnv: FOUR_LOCATIONS,
      fetchImpl,
      customSlotStore: freshStore(),
    });

    const { all, named, empty } = selectors(root);
    expect(named.length).toBe(4);
    expect(empty.length).toBe(MAX_CUSTOM_SLOTS);
    expect(all.length).toBe(4 + MAX_CUSTOM_SLOTS);

    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(4);
  });

  it('renders default cards with per-slot isolation on failure', async () => {
    const root = document.createElement('div');

    // Alpha → 200 OK with fixture; Beta → 404 → forecast=null.
    const fetchImpl = vi.fn(async (input: Request | string | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('latitude=60')) {
        return makeResponse(200, lahtiFixture);
      }
      return makeResponse(404, { error: 'not found' });
    }) as unknown as typeof fetch;

    await bootstrap(root, {
      rawEnv: TWO_LOCATIONS,
      fetchImpl,
      customSlotStore: freshStore(),
    });

    const { named } = selectors(root);
    expect(named.length).toBe(2);
    const names = Array.from(named).map((n) => n.textContent);
    expect(names).toEqual(['Alpha', 'Beta']);

    const allCards = root.querySelectorAll('main.list button.card');
    // Alpha is index 0 — has a forecast.
    expect(allCards[0]?.querySelector('.card-temp')?.textContent).toMatch(/^-?\d+°$/);
    // Beta is index 1 — 404, "Unavailable".
    expect(allCards[1]?.textContent).toContain('Unavailable');
    expect(allCards[1]?.querySelector('.card-temp')).toBeNull();
  });

  it('logs an error and renders zero named cards when env is missing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const root = document.createElement('div');

    await bootstrap(root, {
      rawEnv: undefined,
      fetchImpl,
      customSlotStore: freshStore(),
    });

    expect(errorSpy).toHaveBeenCalled();
    const message = errorSpy.mock.calls[0]?.[0] as string | undefined;
    expect(message).toMatch(/VITE_DEFAULT_LOCATIONS/);
    expect(message).toMatch(/missing/);

    // App still rendered (header + footer present); the only cards are the
    // 2 empty custom-slot placeholders.
    expect(root.querySelector('.app-header')).not.toBeNull();
    expect(root.querySelector('.app-footer a')?.textContent).toBe('Weather data by Open-Meteo');
    const { named, empty } = selectors(root);
    expect(named.length).toBe(0);
    expect(empty.length).toBe(MAX_CUSTOM_SLOTS);

    // No fetch calls were made (no default locations to fetch).
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it('logs an error and renders zero named cards when env JSON is malformed', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const root = document.createElement('div');

    await bootstrap(root, {
      rawEnv: 'not-json',
      fetchImpl,
      customSlotStore: freshStore(),
    });

    expect(errorSpy).toHaveBeenCalled();
    const message = errorSpy.mock.calls[0]?.[0] as string | undefined;
    expect(message).toMatch(/malformed-json/);
    const { named } = selectors(root);
    expect(named.length).toBe(0);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it('renders zero named cards and makes no default-fetches for an empty array env', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const root = document.createElement('div');

    await bootstrap(root, {
      rawEnv: '[]',
      fetchImpl,
      customSlotStore: freshStore(),
    });

    const { named } = selectors(root);
    expect(named.length).toBe(0);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    // Header + footer (attribution) still render — empty list is a normal state.
    expect(root.querySelector('.app-footer a')?.textContent).toBe('Weather data by Open-Meteo');
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
    const root = document.createElement('div');

    await bootstrap(root, {
      rawEnv: TWO_LOCATIONS,
      fetchImpl,
      customSlotStore,
    });

    const names = Array.from(root.querySelectorAll('main.list .card-name')).map(
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
    const root = document.createElement('div');

    await bootstrap(root, {
      rawEnv: TWO_LOCATIONS,
      fetchImpl,
      customSlotStore,
    });

    // Sanity: 2 named cards before add.
    expect(root.querySelectorAll('main.list .card-name').length).toBe(2);
    const fetchBefore = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(fetchBefore).toBe(2);

    // Simulate the user picking a location from the autocomplete.
    customSlotStore.add({ name: 'NewPlace', lat: 45, lon: 9 });

    // Subscriber triggers a fresh render via `renderNow` — give microtasks a turn.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const names = Array.from(root.querySelectorAll('main.list .card-name')).map(
      (n) => n.textContent,
    );
    expect(names).toEqual(['Alpha', 'Beta', 'NewPlace']);

    // One additional fetch — defaults were re-fetched too because we
    // re-render the whole grid (Phase 1: no per-slot caching). That's OK,
    // the cache story (#7) lands later.
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
    const root = document.createElement('div');

    await bootstrap(root, {
      rawEnv: TWO_LOCATIONS,
      fetchImpl,
      customSlotStore,
    });

    // The custom card has a remove button. Default cards do not.
    const removeButtons = root.querySelectorAll('main.list .card-remove');
    expect(removeButtons.length).toBe(1);

    (removeButtons[0] as HTMLElement).click();

    // Subscriber triggers an async re-render; wait for it.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const names = Array.from(root.querySelectorAll('main.list .card-name')).map(
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
    const root = document.createElement('div');

    await bootstrap(root, {
      rawEnv: TWO_LOCATIONS,
      fetchImpl,
      customSlotStore,
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
    });

    for (const url of calls) {
      expect(url).not.toContain('SecretPlace');
    }
    // One call should include the secret coords.
    expect(calls.some((u) => u.includes('latitude=12.345'))).toBe(true);
  });
});

function root(): HTMLElement {
  return document.createElement('div');
}
