// Tests for the custom-slot store (STORY-009).
//
// Covers the contract documented in custom-slots.ts:
//   - add → list reflects, persistence reflects.
//   - cap of MAX_CUSTOM_SLOTS, `canAdd` flips.
//   - dedupe on (lat, lon) within epsilon.
//   - remove (incl. out-of-range index).
//   - corrupt storage recovery (single warn, empty list).
//   - subscribe / unsubscribe; one throwing listener doesn't break others.
//   - in-memory fallback when storage is null.
//   - persisted data is the literal `name` from the selection (no transforms).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CUSTOM_SLOTS_STORAGE_KEY, MAX_CUSTOM_SLOTS, createCustomSlotStore } from './custom-slots';
import type { LocationSelection } from './types';

// ---------------------------------------------------------------------------
// In-memory Storage stub (subset of the Storage interface we actually use)
// ---------------------------------------------------------------------------

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

const TALLINN: LocationSelection = { name: 'Tallinn', lat: 59.4372, lon: 24.7454 };
const RIGA: LocationSelection = { name: 'Riga', lat: 56.9496, lon: 24.1052 };
const STOCKHOLM: LocationSelection = { name: 'Stockholm', lat: 59.3294, lon: 18.0686 };

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createCustomSlotStore', () => {
  it('starts empty when storage has no key', () => {
    const storage = createMemoryStorage();
    const store = createCustomSlotStore({ storage });
    expect(store.list()).toEqual([]);
    expect(store.canAdd()).toBe(true);
  });

  it('add persists to storage and shows up in list', () => {
    const storage = createMemoryStorage();
    const store = createCustomSlotStore({ storage });

    const result = store.add(TALLINN);

    expect(result.ok).toBe(true);
    expect(store.list()).toEqual([{ name: 'Tallinn', lat: 59.4372, lon: 24.7454 }]);

    const raw = storage.getItem(CUSTOM_SLOTS_STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual([{ name: 'Tallinn', lat: 59.4372, lon: 24.7454 }]);
  });

  it('round-trips through a new store instance with the same storage', () => {
    const storage = createMemoryStorage();
    const first = createCustomSlotStore({ storage });
    first.add(TALLINN);
    first.add(RIGA);

    const second = createCustomSlotStore({ storage });
    expect(second.list()).toEqual([
      { name: 'Tallinn', lat: 59.4372, lon: 24.7454 },
      { name: 'Riga', lat: 56.9496, lon: 24.1052 },
    ]);
  });

  it(`caps at MAX_CUSTOM_SLOTS (${MAX_CUSTOM_SLOTS})`, () => {
    const store = createCustomSlotStore({ storage: createMemoryStorage() });
    expect(store.add(TALLINN).ok).toBe(true);
    expect(store.add(RIGA).ok).toBe(true);
    expect(store.canAdd()).toBe(false);

    const third = store.add(STOCKHOLM);
    expect(third.ok).toBe(false);
    if (third.ok) return; // type guard for TS below
    expect(third.error.kind).toBe('cap-reached');
    expect(store.list().length).toBe(MAX_CUSTOM_SLOTS);
  });

  it('rejects duplicates on (lat, lon) within epsilon', () => {
    const store = createCustomSlotStore({ storage: createMemoryStorage() });
    store.add(TALLINN);
    const dup = store.add({
      name: 'Tallinn (renamed)',
      lat: TALLINN.lat + 1e-6,
      lon: TALLINN.lon - 1e-6,
    });
    expect(dup.ok).toBe(false);
    if (dup.ok) return;
    expect(dup.error.kind).toBe('duplicate');
    expect(store.list().length).toBe(1);
  });

  it('rejects invalid selections (bad name, non-finite lat, out-of-range lon)', () => {
    const store = createCustomSlotStore({ storage: createMemoryStorage() });

    const blank = store.add({ name: '   ', lat: 10, lon: 10 });
    expect(blank.ok).toBe(false);
    if (!blank.ok) expect(blank.error.kind).toBe('invalid');

    const nan = store.add({ name: 'X', lat: Number.NaN, lon: 10 });
    expect(nan.ok).toBe(false);

    const outOfRange = store.add({ name: 'X', lat: 10, lon: 999 });
    expect(outOfRange.ok).toBe(false);

    expect(store.list().length).toBe(0);
  });

  it('remove shifts subsequent slots and persists the new order', () => {
    const storage = createMemoryStorage();
    const store = createCustomSlotStore({ storage });
    store.add(TALLINN);
    store.add(RIGA);

    expect(store.remove(0)).toBe(true);
    expect(store.list()).toEqual([{ name: 'Riga', lat: 56.9496, lon: 24.1052 }]);

    // Persistence reflects the removal.
    const raw = storage.getItem(CUSTOM_SLOTS_STORAGE_KEY);
    expect(JSON.parse(raw as string)).toEqual([{ name: 'Riga', lat: 56.9496, lon: 24.1052 }]);
  });

  it('remove returns false for out-of-range / non-integer indices', () => {
    const store = createCustomSlotStore({ storage: createMemoryStorage() });
    store.add(TALLINN);
    expect(store.remove(-1)).toBe(false);
    expect(store.remove(5)).toBe(false);
    expect(store.remove(0.5)).toBe(false);
    expect(store.list().length).toBe(1);
  });

  it('clear empties the store and persistence', () => {
    const storage = createMemoryStorage();
    const store = createCustomSlotStore({ storage });
    store.add(TALLINN);
    store.add(RIGA);
    store.clear();
    expect(store.list()).toEqual([]);
    const raw = storage.getItem(CUSTOM_SLOTS_STORAGE_KEY);
    expect(JSON.parse(raw as string)).toEqual([]);
  });

  it('drops corrupt storage (not JSON) with a single warning and starts empty', () => {
    const storage = createMemoryStorage({
      [CUSTOM_SLOTS_STORAGE_KEY]: 'not-json',
    });
    const store = createCustomSlotStore({ storage });
    expect(store.list()).toEqual([]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toMatch(/corrupt/);
  });

  it('drops corrupt storage (root not array)', () => {
    const storage = createMemoryStorage({
      [CUSTOM_SLOTS_STORAGE_KEY]: '{"nope":true}',
    });
    const store = createCustomSlotStore({ storage });
    expect(store.list()).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('drops individually bad entries but keeps valid ones', () => {
    const storage = createMemoryStorage({
      [CUSTOM_SLOTS_STORAGE_KEY]: JSON.stringify([
        { name: 'OK', lat: 60, lon: 25 },
        { name: 'BadLat', lat: 'oops', lon: 10 },
        { name: '', lat: 10, lon: 10 },
        { name: 'AlsoOK', lat: -10, lon: 100 },
      ]),
    });
    const store = createCustomSlotStore({ storage });
    expect(store.list().map((l) => l.name)).toEqual(['OK', 'AlsoOK']);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('caps load to MAX_CUSTOM_SLOTS even if storage has more', () => {
    const storage = createMemoryStorage({
      [CUSTOM_SLOTS_STORAGE_KEY]: JSON.stringify([
        { name: 'A', lat: 1, lon: 1 },
        { name: 'B', lat: 2, lon: 2 },
        { name: 'C', lat: 3, lon: 3 },
      ]),
    });
    const store = createCustomSlotStore({ storage });
    expect(store.list().length).toBe(MAX_CUSTOM_SLOTS);
    expect(store.list().map((l) => l.name)).toEqual(['A', 'B']);
  });

  describe('subscribe', () => {
    it('fires after add and remove, not on construction', () => {
      const store = createCustomSlotStore({ storage: createMemoryStorage() });
      const listener = vi.fn();
      store.subscribe(listener);

      expect(listener).not.toHaveBeenCalled();
      store.add(TALLINN);
      expect(listener).toHaveBeenCalledTimes(1);
      store.remove(0);
      expect(listener).toHaveBeenCalledTimes(2);
    });

    it('unsubscribe stops notifications', () => {
      const store = createCustomSlotStore({ storage: createMemoryStorage() });
      const listener = vi.fn();
      const unsub = store.subscribe(listener);
      store.add(TALLINN);
      unsub();
      store.add(RIGA);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('a throwing listener does not stop the other listeners', () => {
      const store = createCustomSlotStore({ storage: createMemoryStorage() });
      const good = vi.fn();
      store.subscribe(() => {
        throw new Error('boom');
      });
      store.subscribe(good);
      store.add(TALLINN);
      expect(good).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe('storage fallback', () => {
    it('works in-memory when storage is explicitly null', () => {
      const store = createCustomSlotStore({ storage: null });
      expect(store.add(TALLINN).ok).toBe(true);
      expect(store.list().length).toBe(1);
    });

    it('survives a setItem that throws (quota / disabled)', () => {
      const throwing: Storage = {
        ...createMemoryStorage(),
        setItem(): void {
          throw new Error('QuotaExceededError');
        },
      };
      const store = createCustomSlotStore({ storage: throwing });
      const result = store.add(TALLINN);
      expect(result.ok).toBe(true);
      expect(store.list().length).toBe(1);
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  it('persists `name` verbatim — no transforms across the boundary', () => {
    // Anything innerHTML-y would be a UI render bug, but we still must not
    // alter the string on the way in or out.
    const storage = createMemoryStorage();
    const store = createCustomSlotStore({ storage });
    const tricky = { name: '<b>Tallinn</b>', lat: 59.4, lon: 24.7 };
    expect(store.add(tricky).ok).toBe(true);
    expect(store.list()[0]?.name).toBe('<b>Tallinn</b>');
    const persisted = JSON.parse(storage.getItem(CUSTOM_SLOTS_STORAGE_KEY) as string);
    expect(persisted[0].name).toBe('<b>Tallinn</b>');
  });
});
