import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocationSlot } from '../locations/types';
import {
  CUSTOM_SLOTS_KEY,
  CUSTOM_SLOTS_VERSION,
  createCustomSlotsStore,
} from './custom-slots-store';
import type { CacheStore } from './forecast-cache';

function memStore(): CacheStore & { snapshot(): Record<string, string>; size(): number } {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => {
      m.set(k, v);
    },
    removeItem: (k) => {
      m.delete(k);
    },
    snapshot: () => Object.fromEntries(m),
    size: () => m.size,
  };
}

function slot(id: string, name = id, lat = 0, lon = 0): LocationSlot {
  return { id, name, latitude: lat, longitude: lon, kind: 'custom' };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('createCustomSlotsStore', () => {
  it('read returns "unsupported" when store is null', () => {
    const s = createCustomSlotsStore({ store: null });
    expect(s.read()).toEqual({ ok: false, reason: { kind: 'unsupported' } });
  });

  it('write returns "unsupported" when store is null and never throws', () => {
    const s = createCustomSlotsStore({ store: null });
    expect(s.write([slot('a')])).toEqual({ ok: false, reason: { kind: 'unsupported' } });
  });

  it('read returns "absent" when the key is not present', () => {
    const store = memStore();
    const s = createCustomSlotsStore({ store });
    expect(s.read()).toEqual({ ok: false, reason: { kind: 'absent' } });
  });

  it('read returns "corrupt" on invalid JSON and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = memStore();
    store.setItem(CUSTOM_SLOTS_KEY, '{not json');
    const s = createCustomSlotsStore({ store });
    const result = s.read();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.kind).toBe('corrupt');
    }
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('read returns "wrong-version" with the on-disk version when versions differ', () => {
    const store = memStore();
    store.setItem(CUSTOM_SLOTS_KEY, JSON.stringify({ version: 999, slots: [] }));
    const s = createCustomSlotsStore({ store });
    const result = s.read();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toEqual({ kind: 'wrong-version', found: 999 });
    }
  });

  it('drops malformed entries, keeps valid ones, and warns per drop', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = memStore();
    const doc = {
      version: CUSTOM_SLOTS_VERSION,
      slots: [
        { id: 'custom-1', name: 'OK', latitude: 60, longitude: 24 },
        { id: 'custom-2', name: 'bad lat', latitude: '60', longitude: 24 },
        { name: 'no id', latitude: 60, longitude: 24 },
        { id: 'custom-3', name: '', latitude: 60, longitude: 24 },
        { id: 'custom-4', name: 'oor', latitude: 91, longitude: 24 },
      ],
    };
    store.setItem(CUSTOM_SLOTS_KEY, JSON.stringify(doc));
    const s = createCustomSlotsStore({ store });
    const result = s.read();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([
        { id: 'custom-1', name: 'OK', latitude: 60, longitude: 24, kind: 'custom' },
      ]);
    }
    expect(warn).toHaveBeenCalledTimes(4);
  });

  it('round-trips slots through write → read, attaching kind: "custom" on the way back', () => {
    const store = memStore();
    const s = createCustomSlotsStore({ store });
    const input: LocationSlot[] = [
      slot('custom-60.1695-24.9354', 'Helsinki', 60.1695, 24.9354),
      slot('custom-59.4372-24.7536', 'Tallinn', 59.4372, 24.7536),
    ];
    expect(s.write(input)).toEqual({ ok: true });
    const result = s.read();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(input);
    }
  });

  it('preserves slot order across the round-trip', () => {
    const store = memStore();
    const s = createCustomSlotsStore({ store });
    const input: LocationSlot[] = [slot('a', 'A'), slot('b', 'B'), slot('c', 'C')];
    s.write(input);
    const result = s.read();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    }
  });

  it('does NOT persist the `kind` field on disk', () => {
    const store = memStore();
    const s = createCustomSlotsStore({ store });
    s.write([slot('a')]);
    const raw = store.getItem(CUSTOM_SLOTS_KEY);
    expect(raw).not.toBeNull();
    const doc = JSON.parse(raw!) as { slots: Array<Record<string, unknown>> };
    expect(doc.slots[0]).not.toHaveProperty('kind');
    expect(Object.keys(doc.slots[0] ?? {}).sort()).toEqual(['id', 'latitude', 'longitude', 'name']);
  });

  it('write([]) deletes the on-disk key', () => {
    const store = memStore();
    const s = createCustomSlotsStore({ store });
    s.write([slot('a')]);
    expect(store.size()).toBe(1);
    expect(s.write([])).toEqual({ ok: true });
    expect(store.size()).toBe(0);
    expect(s.read()).toEqual({ ok: false, reason: { kind: 'absent' } });
  });

  it('classifies QuotaExceededError DOMException as { kind: "quota" } and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store: CacheStore = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
      removeItem: () => {},
    };
    const s = createCustomSlotsStore({ store });
    const result = s.write([slot('a')]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.kind).toBe('quota');
    }
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('classifies a non-quota throw as { kind: "unknown" } and never re-throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store: CacheStore = {
      getItem: () => null,
      setItem: () => {
        throw new Error('disk full');
      },
      removeItem: () => {},
    };
    const s = createCustomSlotsStore({ store });
    const result = s.write([slot('a')]);
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason.kind === 'unknown') {
      expect(result.reason.message).toContain('disk full');
    } else {
      expect.fail('expected { kind: "unknown" } reason');
    }
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('default store path round-trips through jsdom localStorage', () => {
    const s = createCustomSlotsStore();
    expect(s.write([slot('custom-1', 'Sample')])).toEqual({ ok: true });
    const result = s.read();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data[0]?.id).toBe('custom-1');
    }
    expect(localStorage.getItem(CUSTOM_SLOTS_KEY)).not.toBeNull();
  });

  it('clear() removes the on-disk key', () => {
    const store = memStore();
    const s = createCustomSlotsStore({ store });
    s.write([slot('a')]);
    expect(s.clear()).toEqual({ ok: true });
    expect(store.size()).toBe(0);
    expect(s.read()).toEqual({ ok: false, reason: { kind: 'absent' } });
  });

  it('read after clear() returns { kind: "absent" }', () => {
    const s = createCustomSlotsStore();
    s.write([slot('a')]);
    s.clear();
    expect(s.read()).toEqual({ ok: false, reason: { kind: 'absent' } });
  });

  it('rejects a top-level non-object document as corrupt', () => {
    const store = memStore();
    store.setItem(CUSTOM_SLOTS_KEY, JSON.stringify(['array', 'not', 'object']));
    const s = createCustomSlotsStore({ store });
    const result = s.read();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.kind).toBe('corrupt');
    }
  });

  it('rejects a document whose slots is not an array as corrupt', () => {
    const store = memStore();
    store.setItem(
      CUSTOM_SLOTS_KEY,
      JSON.stringify({ version: CUSTOM_SLOTS_VERSION, slots: 'oops' }),
    );
    const s = createCustomSlotsStore({ store });
    const result = s.read();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.kind).toBe('corrupt');
    }
  });
});
