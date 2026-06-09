import type { LocationSlot } from '../locations/types';
import type { CacheStore } from './forecast-cache';

// On-device persistence for the user's custom location slots (STORY-009).
// Mirrors `createForecastCache`: same `CacheStore` shape, same
// ReadResult/WriteResult taxonomy, never throws across the boundary.
// Storage shape (one JSON document under CUSTOM_SLOTS_KEY):
//
//   { "version": 1, "slots": [{ id, name, latitude, longitude }] }
//
// `kind` is NOT persisted — the store always re-attaches `'custom'` on read
// so the on-disk doc stays minimal.

export const CUSTOM_SLOTS_KEY = 'weather-custom-slots.v1';
export const CUSTOM_SLOTS_VERSION = 1;

export type CustomSlotsReadFailure =
  | { kind: 'absent' }
  | { kind: 'unsupported' }
  | { kind: 'corrupt'; message: string }
  | { kind: 'wrong-version'; found: number };

export type CustomSlotsWriteFailure =
  | { kind: 'unsupported' }
  | { kind: 'quota'; message: string }
  | { kind: 'unknown'; message: string };

export type CustomSlotsReadResult =
  | { ok: true; data: LocationSlot[] }
  | { ok: false; reason: CustomSlotsReadFailure };

export type CustomSlotsWriteResult =
  | { ok: true }
  | { ok: false; reason: CustomSlotsWriteFailure };

export interface CustomSlotsStore {
  read(): CustomSlotsReadResult;
  write(slots: readonly LocationSlot[]): CustomSlotsWriteResult;
  clear(): CustomSlotsWriteResult;
}

export interface CreateCustomSlotsStoreDeps {
  store?: CacheStore | null;
  key?: string;
  version?: number;
}

function defaultStore(): CacheStore | null {
  if (typeof globalThis === 'undefined') return null;
  const g = globalThis as { localStorage?: CacheStore };
  if (g.localStorage === undefined) return null;
  if (typeof g.localStorage.getItem !== 'function') return null;
  return g.localStorage;
}

export function createCustomSlotsStore(
  deps: CreateCustomSlotsStoreDeps = {},
): CustomSlotsStore {
  const store = deps.store === undefined ? defaultStore() : deps.store;
  const key = deps.key ?? CUSTOM_SLOTS_KEY;
  const version = deps.version ?? CUSTOM_SLOTS_VERSION;

  function readDoc(): CustomSlotsReadResult {
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
      console.warn('[custom-slots] corrupt — discarding', message);
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
    if (!Array.isArray(doc.slots)) {
      return { ok: false, reason: { kind: 'corrupt', message: 'document.slots is not an array' } };
    }
    const slots: LocationSlot[] = [];
    for (let i = 0; i < doc.slots.length; i++) {
      const entry = narrowPersistedSlot(doc.slots[i]);
      if (entry === null) {
        console.warn('[custom-slots] dropping malformed entry', i);
        continue;
      }
      slots.push(entry);
    }
    return { ok: true, data: slots };
  }

  function writeDoc(slots: readonly LocationSlot[]): CustomSlotsWriteResult {
    if (store === null) {
      return { ok: false, reason: { kind: 'unsupported' } };
    }
    if (slots.length === 0) {
      try {
        store.removeItem(key);
        return { ok: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown storage error';
        console.warn('[custom-slots] removeItem failed', message);
        return { ok: false, reason: { kind: 'unknown', message } };
      }
    }
    const payload = JSON.stringify({
      version,
      slots: slots.map((s) => ({
        id: s.id,
        name: s.name,
        latitude: s.latitude,
        longitude: s.longitude,
      })),
    });
    try {
      store.setItem(key, payload);
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown storage error';
      if (err instanceof DOMException && err.name === 'QuotaExceededError') {
        console.warn('[custom-slots] write failed: quota', message);
        return { ok: false, reason: { kind: 'quota', message } };
      }
      if (
        typeof err === 'object' &&
        err !== null &&
        (err as { name?: string }).name === 'QuotaExceededError'
      ) {
        console.warn('[custom-slots] write failed: quota', message);
        return { ok: false, reason: { kind: 'quota', message } };
      }
      console.warn('[custom-slots] write failed', message);
      return { ok: false, reason: { kind: 'unknown', message } };
    }
  }

  return {
    read: readDoc,
    write: writeDoc,
    clear() {
      if (store === null) {
        return { ok: false, reason: { kind: 'unsupported' } };
      }
      try {
        store.removeItem(key);
        return { ok: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown storage error';
        console.warn('[custom-slots] clear failed', message);
        return { ok: false, reason: { kind: 'unknown', message } };
      }
    },
  };
}

function narrowPersistedSlot(raw: unknown): LocationSlot | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id === '') return null;
  if (typeof r.name !== 'string' || r.name === '') return null;
  if (typeof r.latitude !== 'number' || !Number.isFinite(r.latitude)) return null;
  if (r.latitude < -90 || r.latitude > 90) return null;
  if (typeof r.longitude !== 'number' || !Number.isFinite(r.longitude)) return null;
  if (r.longitude < -180 || r.longitude > 180) return null;
  return {
    id: r.id,
    name: r.name,
    latitude: r.latitude,
    longitude: r.longitude,
    kind: 'custom',
  };
}
