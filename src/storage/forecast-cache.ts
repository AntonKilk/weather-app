import type {
  CurrentWeather,
  DailyForecast,
  ForecastResponse,
  HourlyForecast,
} from '../weather/types';

// On-device cache for the last-known forecast per slot. Backed by
// localStorage by default; abstracted behind `CacheStore` so STORY-009
// can swap to IndexedDB without a rewrite. Never throws across the
// module boundary — quota, parse, and unsupported failures all come
// back as typed Results (CLAUDE.md › Error handling). Storage shape
// (one JSON document under CACHE_KEY):
//
//   { "version": 1, "slots": { "<slot.id>": { forecast, fetchedAt } } }
//
// Shape narrowing on read is inlined to keep this module independent of
// `weather/open-meteo-client.ts` (CLAUDE.md › Architecture — storage
// must not depend on the network client).

export interface CachedSlot {
  forecast: ForecastResponse;
  fetchedAt: number;
}

export type CacheSnapshot = Record<string, CachedSlot>;

export type CacheReadFailure =
  | { kind: 'absent' }
  | { kind: 'unsupported' }
  | { kind: 'corrupt'; message: string }
  | { kind: 'wrong-version'; found: number };

export type CacheWriteFailure =
  | { kind: 'unsupported' }
  | { kind: 'quota'; message: string }
  | { kind: 'unknown'; message: string };

export type ReadResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: CacheReadFailure };

export type WriteResult =
  | { ok: true }
  | { ok: false; reason: CacheWriteFailure };

export interface CacheStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ForecastCache {
  read(): ReadResult<CacheSnapshot>;
  writeSlot(slotId: string, slot: CachedSlot): WriteResult;
  removeSlot(slotId: string): WriteResult;
  clear(): WriteResult;
}

export interface CreateForecastCacheDeps {
  store?: CacheStore | null;
  key?: string;
  version?: number;
}

export const CACHE_KEY = 'weather-cache.v1';
export const CACHE_VERSION = 1;

function defaultStore(): CacheStore | null {
  if (typeof globalThis === 'undefined') return null;
  const g = globalThis as { localStorage?: CacheStore };
  if (g.localStorage === undefined) return null;
  // Minimal duck-type check — Safari private mode historically exposes
  // localStorage but throws on setItem; we still treat that as supported
  // here and let writeSlot's try/catch classify the failure.
  if (typeof g.localStorage.getItem !== 'function') return null;
  return g.localStorage;
}

export function createForecastCache(deps: CreateForecastCacheDeps = {}): ForecastCache {
  const store = deps.store === undefined ? defaultStore() : deps.store;
  const key = deps.key ?? CACHE_KEY;
  const version = deps.version ?? CACHE_VERSION;

  function readDoc(): ReadResult<CacheSnapshot> {
    if (store === null) {
      return { ok: false, reason: { kind: 'unsupported' } };
    }
    const raw = store.getItem(key);
    if (raw === null) {
      return { ok: false, reason: { kind: 'absent' } };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown parse error';
      console.warn('[cache] corrupt — discarding', message);
      return { ok: false, reason: { kind: 'corrupt', message } };
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, reason: { kind: 'corrupt', message: 'document is not an object' } };
    }
    const doc = parsed as Record<string, unknown>;
    if (typeof doc.version !== 'number') {
      return {
        ok: false,
        reason: { kind: 'corrupt', message: 'document.version is not a number' },
      };
    }
    if (doc.version !== version) {
      return { ok: false, reason: { kind: 'wrong-version', found: doc.version } };
    }
    if (typeof doc.slots !== 'object' || doc.slots === null || Array.isArray(doc.slots)) {
      return { ok: false, reason: { kind: 'corrupt', message: 'document.slots missing' } };
    }
    const slotsRaw = doc.slots as Record<string, unknown>;
    const snapshot: CacheSnapshot = {};
    for (const [slotId, entryRaw] of Object.entries(slotsRaw)) {
      const entry = narrowCachedSlot(entryRaw);
      if (entry === null) {
        console.warn('[cache] dropping malformed entry', slotId);
        continue;
      }
      snapshot[slotId] = entry;
    }
    return { ok: true, data: snapshot };
  }

  function writeDoc(snapshot: CacheSnapshot): WriteResult {
    if (store === null) {
      return { ok: false, reason: { kind: 'unsupported' } };
    }
    const payload = JSON.stringify({ version, slots: snapshot });
    try {
      store.setItem(key, payload);
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown storage error';
      if (err instanceof DOMException && err.name === 'QuotaExceededError') {
        console.warn('[cache] write failed: quota', message);
        return { ok: false, reason: { kind: 'quota', message } };
      }
      // Some runtimes throw a non-DOMException with a quota-shaped name.
      if (
        typeof err === 'object' &&
        err !== null &&
        (err as { name?: string }).name === 'QuotaExceededError'
      ) {
        console.warn('[cache] write failed: quota', message);
        return { ok: false, reason: { kind: 'quota', message } };
      }
      console.warn('[cache] write failed', message);
      return { ok: false, reason: { kind: 'unknown', message } };
    }
  }

  function readSnapshotOrEmpty(): CacheSnapshot {
    const result = readDoc();
    return result.ok ? result.data : {};
  }

  return {
    read: readDoc,
    writeSlot(slotId, slot) {
      const snapshot = readSnapshotOrEmpty();
      snapshot[slotId] = slot;
      return writeDoc(snapshot);
    },
    removeSlot(slotId) {
      if (store === null) {
        return { ok: false, reason: { kind: 'unsupported' } };
      }
      const snapshot = readSnapshotOrEmpty();
      if (!(slotId in snapshot)) {
        return { ok: true };
      }
      delete snapshot[slotId];
      if (Object.keys(snapshot).length === 0) {
        try {
          store.removeItem(key);
          return { ok: true };
        } catch (err) {
          const message = err instanceof Error ? err.message : 'unknown storage error';
          console.warn('[cache] removeItem failed', message);
          return { ok: false, reason: { kind: 'unknown', message } };
        }
      }
      return writeDoc(snapshot);
    },
    clear() {
      if (store === null) {
        return { ok: false, reason: { kind: 'unsupported' } };
      }
      try {
        store.removeItem(key);
        return { ok: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown storage error';
        console.warn('[cache] clear failed', message);
        return { ok: false, reason: { kind: 'unknown', message } };
      }
    },
  };
}

// --- Shape narrowing (inlined; mirrors open-meteo-client.ts) ----------------

function narrowCachedSlot(raw: unknown): CachedSlot | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.fetchedAt !== 'number' || !Number.isFinite(r.fetchedAt)) return null;
  const forecast = narrowForecastResponse(r.forecast);
  if (forecast === null) return null;
  return { forecast, fetchedAt: r.fetchedAt };
}

function narrowForecastResponse(raw: unknown): ForecastResponse | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.latitude !== 'number' || typeof r.longitude !== 'number') return null;
  if (typeof r.timezone !== 'string') return null;
  const current = narrowCurrent(r.current);
  if (current === null) return null;
  const hourly = narrowHourly(r.hourly);
  if (hourly === null) return null;
  const daily = narrowDaily(r.daily);
  if (daily === null) return null;
  return { latitude: r.latitude, longitude: r.longitude, timezone: r.timezone, current, hourly, daily };
}

function narrowCurrent(raw: unknown): CurrentWeather | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.time !== 'string') return null;
  if (typeof c.temperature_2m !== 'number') return null;
  if (typeof c.relative_humidity_2m !== 'number') return null;
  if (typeof c.weather_code !== 'number') return null;
  if (typeof c.wind_speed_10m !== 'number') return null;
  return {
    time: c.time,
    temperature_2m: c.temperature_2m,
    relative_humidity_2m: c.relative_humidity_2m,
    weather_code: c.weather_code,
    wind_speed_10m: c.wind_speed_10m,
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'number');
}

function narrowHourly(raw: unknown): HourlyForecast | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const h = raw as Record<string, unknown>;
  if (!isStringArray(h.time)) return null;
  if (!isNumberArray(h.temperature_2m)) return null;
  if (!isNumberArray(h.precipitation)) return null;
  if (!isNumberArray(h.precipitation_probability)) return null;
  if (!isNumberArray(h.weather_code)) return null;
  const n = h.time.length;
  if (
    h.temperature_2m.length !== n ||
    h.precipitation.length !== n ||
    h.precipitation_probability.length !== n ||
    h.weather_code.length !== n
  ) {
    return null;
  }
  return {
    time: h.time,
    temperature_2m: h.temperature_2m,
    precipitation: h.precipitation,
    precipitation_probability: h.precipitation_probability,
    weather_code: h.weather_code,
  };
}

function narrowDaily(raw: unknown): DailyForecast | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const d = raw as Record<string, unknown>;
  if (!isStringArray(d.time)) return null;
  if (!isNumberArray(d.weather_code)) return null;
  if (!isNumberArray(d.temperature_2m_max)) return null;
  if (!isNumberArray(d.temperature_2m_min)) return null;
  if (!isNumberArray(d.precipitation_sum)) return null;
  const n = d.time.length;
  if (
    d.weather_code.length !== n ||
    d.temperature_2m_max.length !== n ||
    d.temperature_2m_min.length !== n ||
    d.precipitation_sum.length !== n
  ) {
    return null;
  }
  return {
    time: d.time,
    weather_code: d.weather_code,
    temperature_2m_max: d.temperature_2m_max,
    temperature_2m_min: d.temperature_2m_min,
    precipitation_sum: d.precipitation_sum,
  };
}
