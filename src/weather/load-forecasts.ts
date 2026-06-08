import type { LocationSlot } from '../locations/types';
import type { ForecastResponse } from './types';
import type { FetchResult } from './open-meteo-client';
import { fetchForecast as defaultFetchForecast } from './open-meteo-client';

// Orchestrates a parallel fetch of every slot's forecast. NEVER throws —
// `fetchForecast` is contractually total (STORY-004), so a failed slot is
// simply absent from the returned map and the home screen falls back to
// `renderDegradedCard` for it (CLAUDE.md › Error handling: one slot must
// not break the others).

export interface LoadForecastsDeps {
  fetchForecast?: (lat: number, lon: number) => Promise<FetchResult<ForecastResponse>>;
}

export async function loadForecasts(
  slots: readonly LocationSlot[],
  deps: LoadForecastsDeps = {},
): Promise<Record<string, ForecastResponse>> {
  const fetcher = deps.fetchForecast ?? defaultFetchForecast;
  const map: Record<string, ForecastResponse> = {};
  if (slots.length === 0) {
    return map;
  }

  const results = await Promise.all(
    slots.map((slot) => fetcher(slot.latitude, slot.longitude)),
  );

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const result = results[i];
    if (slot === undefined || result === undefined) continue;
    if (result.ok) {
      map[slot.id] = result.data;
    } else {
      console.warn(
        `[load-forecasts] failed for slot ${slot.id} (${slot.name})`,
        result.error,
      );
    }
  }

  return map;
}
