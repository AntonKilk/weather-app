// Storage layer barrel — the public surface for `main.ts`.
//
// Layer rule (CLAUDE.md > Architecture): the ui/ layer must NOT import from
// here directly; main.ts wires it. Domain types stay in `weather/`.

export {
  createForecastCache,
  CACHE_KEY_PREFIX,
  CACHE_VERSION,
  type ForecastCache,
} from './forecast-cache';
export { createLocalStorageStore, createMemoryStore } from './key-value-store';
export { STALE_THRESHOLD_MS, formatLastUpdated, isStale } from './freshness';
export { loadCachedThenRefresh, type SlotForecast, type SwrOptions, type SwrResult } from './swr';
export type {
  CacheEntry,
  CacheReadError,
  CacheReadErrorKind,
  CacheReadResult,
  KeyValueStore,
} from './types';
