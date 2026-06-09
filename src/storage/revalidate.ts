import type { LocationSlot } from '../locations/types';
import type { FetchResult, ForecastResponse } from '../weather/types';
import type { CacheSnapshot, ForecastCache } from './forecast-cache';

// Stale-while-revalidate orchestrator. Fetches every slot in parallel,
// writes successes back to the cache, and returns the merged snapshot
// (existing cache + this cycle's fresh data) so the caller can re-render
// from a single source of truth. Per-slot failures never affect other
// slots and never throw past this boundary (CLAUDE.md › Fault Tolerance,
// › Error handling — showing stale data is the happy path).

export type Fetcher = (lat: number, lon: number) => Promise<FetchResult<ForecastResponse>>;

export interface RevalidateDeps {
  cache: ForecastCache;
  fetchForecast: Fetcher;
  now?: () => number;
}

export interface RevalidateResult {
  snapshot: CacheSnapshot;
  refreshed: readonly string[];
  failed: readonly string[];
}

export async function revalidate(
  slots: readonly LocationSlot[],
  deps: RevalidateDeps,
): Promise<RevalidateResult> {
  const { cache, fetchForecast } = deps;
  const now = deps.now ?? Date.now;

  console.info('[revalidate] start', slots.length);

  if (slots.length === 0) {
    const initial = cache.read();
    return {
      snapshot: initial.ok ? initial.data : {},
      refreshed: [],
      failed: [],
    };
  }

  const results = await Promise.all(
    slots.map(async (slot) => {
      try {
        const result = await fetchForecast(slot.latitude, slot.longitude);
        return { slot, result } as const;
      } catch (err) {
        // fetchForecast is contractually total, but defend in depth so
        // a rejected promise NEVER crashes the cycle.
        console.warn('[revalidate] fetcher rejected for slot', slot.id, err);
        const fallback: FetchResult<ForecastResponse> = {
          ok: false,
          error: { kind: 'network', message: 'fetcher threw' },
        };
        return { slot, result: fallback } as const;
      }
    }),
  );

  const refreshed: string[] = [];
  const failed: string[] = [];
  const delta: CacheSnapshot = {};

  const cycleStart = now();
  for (const { slot, result } of results) {
    if (result.ok) {
      const entry = { forecast: result.data, fetchedAt: cycleStart };
      delta[slot.id] = entry;
      cache.writeSlot(slot.id, entry);
      refreshed.push(slot.id);
    } else {
      failed.push(slot.id);
    }
  }

  const after = cache.read();
  const base = after.ok ? after.data : {};
  // Merge in-memory delta on top — covers the case where writeSlot
  // returned an unsupported/quota failure but we still want callers to
  // render this cycle's fresh data.
  const snapshot: CacheSnapshot = { ...base, ...delta };

  console.info('[revalidate] done', { refreshed: refreshed.length, failed: failed.length });

  return { snapshot, refreshed, failed };
}
