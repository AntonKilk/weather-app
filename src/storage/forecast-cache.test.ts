import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_FORECAST } from '../weather/fixtures/open-meteo-forecast.fixture';
import type { ForecastResponse } from '../weather/types';
import {
  CACHE_KEY,
  CACHE_VERSION,
  type CacheStore,
  type CachedSlot,
  createForecastCache,
} from './forecast-cache';

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

function sampleSlot(fetchedAt = 1_700_000_000_000): CachedSlot {
  return { forecast: SAMPLE_FORECAST, fetchedAt };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('createForecastCache', () => {
  it('read returns "unsupported" when store is null', () => {
    const cache = createForecastCache({ store: null });
    expect(cache.read()).toEqual({ ok: false, reason: { kind: 'unsupported' } });
  });

  it('writeSlot returns "unsupported" when store is null and never throws', () => {
    const cache = createForecastCache({ store: null });
    const result = cache.writeSlot('a', sampleSlot());
    expect(result).toEqual({ ok: false, reason: { kind: 'unsupported' } });
  });

  it('read returns "absent" when the key is not present', () => {
    const store = memStore();
    const cache = createForecastCache({ store });
    expect(cache.read()).toEqual({ ok: false, reason: { kind: 'absent' } });
  });

  it('read returns "corrupt" on invalid JSON and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = memStore();
    store.setItem(CACHE_KEY, '{not valid json');
    const cache = createForecastCache({ store });
    const result = cache.read();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.kind).toBe('corrupt');
    }
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('read returns "wrong-version" with the on-disk version when versions differ', () => {
    const store = memStore();
    store.setItem(CACHE_KEY, JSON.stringify({ version: 999, slots: {} }));
    const cache = createForecastCache({ store });
    const result = cache.read();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toEqual({ kind: 'wrong-version', found: 999 });
    }
  });

  it('drops malformed slot entries, keeps valid ones, and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = memStore();
    const malformed: ForecastResponse = { ...SAMPLE_FORECAST };
    // Strip `current` to break the shape guard.
    const broken = { ...malformed } as unknown as Record<string, unknown>;
    delete broken.current;
    const doc = {
      version: CACHE_VERSION,
      slots: {
        good: { forecast: SAMPLE_FORECAST, fetchedAt: 123 },
        bad: { forecast: broken, fetchedAt: 456 },
        'missing-ts': { forecast: SAMPLE_FORECAST },
      },
    };
    store.setItem(CACHE_KEY, JSON.stringify(doc));
    const cache = createForecastCache({ store });
    const result = cache.read();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.data).sort()).toEqual(['good']);
      expect(result.data.good?.fetchedAt).toBe(123);
    }
    // One warn per dropped entry (bad, missing-ts) → 2.
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('round-trips a single slot through writeSlot → read', () => {
    const store = memStore();
    const cache = createForecastCache({ store });
    const slot = sampleSlot(1_700_000_001_000);
    expect(cache.writeSlot('default-0', slot)).toEqual({ ok: true });
    const result = cache.read();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ 'default-0': slot });
    }
  });

  it('merges multiple writeSlot calls into a single document', () => {
    const store = memStore();
    const cache = createForecastCache({ store });
    cache.writeSlot('a', sampleSlot(1));
    cache.writeSlot('b', sampleSlot(2));
    const result = cache.read();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.data).sort()).toEqual(['a', 'b']);
      expect(result.data.a?.fetchedAt).toBe(1);
      expect(result.data.b?.fetchedAt).toBe(2);
    }
    expect(store.size()).toBe(1);
  });

  it('writeSlot overwrites an existing slot with the latest payload', () => {
    const store = memStore();
    const cache = createForecastCache({ store });
    cache.writeSlot('a', sampleSlot(1));
    cache.writeSlot('a', sampleSlot(2));
    const result = cache.read();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.a?.fetchedAt).toBe(2);
    }
  });

  it('removeSlot removes the named slot, preserves the rest', () => {
    const store = memStore();
    const cache = createForecastCache({ store });
    cache.writeSlot('a', sampleSlot(1));
    cache.writeSlot('b', sampleSlot(2));
    expect(cache.removeSlot('a')).toEqual({ ok: true });
    const result = cache.read();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.data)).toEqual(['b']);
    }
  });

  it('removeSlot deletes the on-disk key when the snapshot becomes empty', () => {
    const store = memStore();
    const cache = createForecastCache({ store });
    cache.writeSlot('only', sampleSlot(1));
    expect(store.size()).toBe(1);
    cache.removeSlot('only');
    expect(store.size()).toBe(0);
    expect(cache.read()).toEqual({ ok: false, reason: { kind: 'absent' } });
  });

  it('clear() removes the on-disk key', () => {
    const store = memStore();
    const cache = createForecastCache({ store });
    cache.writeSlot('a', sampleSlot(1));
    expect(cache.clear()).toEqual({ ok: true });
    expect(store.size()).toBe(0);
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
    const cache = createForecastCache({ store });
    const result = cache.writeSlot('a', sampleSlot());
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
    const cache = createForecastCache({ store });
    const result = cache.writeSlot('a', sampleSlot());
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason.kind === 'unknown') {
      expect(result.reason.message).toContain('disk full');
    } else {
      expect.fail('expected { kind: "unknown" } reason');
    }
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('default store path round-trips through jsdom localStorage', () => {
    // No `store` dep injected — exercises the defaultStore() branch.
    const cache = createForecastCache();
    const slot = sampleSlot(1_700_000_002_000);
    expect(cache.writeSlot('default-0', slot)).toEqual({ ok: true });
    const result = cache.read();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data['default-0']).toEqual(slot);
    }
    expect(localStorage.getItem(CACHE_KEY)).not.toBeNull();
  });
});
