// `KeyValueStore` adapters.
//
// CLAUDE.md › Architecture: storage adapters live under `src/storage/` and
// expose a tiny sync surface (`KeyValueStore`). They are the ONLY files in the
// codebase that touch `window.localStorage`.
//
// Design rules (mirror `src/sw-register.ts` for the boundary discipline):
//   - Never throw across the boundary. Storage errors (quota exceeded,
//     SecurityError, disabled storage) are swallowed and logged so the rest
//     of the app keeps working with degraded freshness.
//   - Probe `localStorage` once at construction with a sentinel write/remove.
//     If it throws, fall back to the in-memory store transparently — the
//     orchestrator never has to know.
//   - The in-memory store is also exported for tests (`createMemoryStore`).

import type { KeyValueStore } from './types';

// ---------------------------------------------------------------------------
// In-memory store (test default; also the production fallback)
// ---------------------------------------------------------------------------

/**
 * `Map`-backed `KeyValueStore`. Pure, sync, never throws. Tests use this by
 * default; production falls back to it if `localStorage` is unavailable.
 */
export function createMemoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem(key) {
      const v = map.get(key);
      return v === undefined ? null : v;
    },
    setItem(key, value) {
      map.set(key, value);
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

// ---------------------------------------------------------------------------
// localStorage adapter
// ---------------------------------------------------------------------------

const PROBE_KEY = '__weather_app_probe__';

/**
 * `KeyValueStore` backed by `window.localStorage`. Falls back to an in-memory
 * store if `localStorage` cannot be probed (SSR, Safari private mode, disabled
 * by browser policy). Quota / Security errors at write time are swallowed and
 * logged — they do not propagate to the caller.
 */
export function createLocalStorageStore(): KeyValueStore {
  const ls = probeLocalStorage();
  if (ls === null) {
    // eslint-disable-next-line no-console
    console.info('[storage] localStorage unavailable, using in-memory fallback');
    return createMemoryStore();
  }

  return {
    getItem(key) {
      try {
        return ls.getItem(key);
      } catch (err: unknown) {
        // eslint-disable-next-line no-console
        console.warn(`[storage] getItem(${key}) failed: ${describe(err)}`);
        return null;
      }
    },
    setItem(key, value) {
      try {
        ls.setItem(key, value);
      } catch (err: unknown) {
        // Most likely QuotaExceededError. Swallow — graceful degradation per
        // CLAUDE.md > Fault Tolerance ("graceful degradation is the product").
        // eslint-disable-next-line no-console
        console.warn(`[storage] setItem(${key}) failed: ${describe(err)}`);
      }
    },
    removeItem(key) {
      try {
        ls.removeItem(key);
      } catch (err: unknown) {
        // eslint-disable-next-line no-console
        console.warn(`[storage] removeItem(${key}) failed: ${describe(err)}`);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return `globalThis.localStorage` if a one-shot probe-write succeeds.
 * Otherwise `null` — the caller picks a fallback.
 *
 * Reading `globalThis.localStorage` itself can throw (e.g. file:// or strict
 * iframe contexts), so the property access is also wrapped.
 */
function probeLocalStorage(): Storage | null {
  let ls: Storage | undefined;
  try {
    ls = globalThis.localStorage;
  } catch {
    return null;
  }
  if (ls === undefined || ls === null) {
    return null;
  }
  try {
    ls.setItem(PROBE_KEY, '1');
    ls.removeItem(PROBE_KEY);
    return ls;
  } catch {
    return null;
  }
}

function describe(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}
