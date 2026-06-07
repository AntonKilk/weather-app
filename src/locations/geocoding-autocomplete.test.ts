// Unit tests for the geocoding autocomplete controller.
//
// Uses Vitest fake timers + a stubbed `search` so no real network or real
// time is involved. The controller's debounce is wired to the global
// setTimeout, which `vi.useFakeTimers()` overrides.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createGeocodingAutocomplete } from './geocoding-autocomplete';
import type {
  AutocompleteState,
  GeocodingFetchResult,
  GeocodingResult,
  LocationSelection,
} from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HELSINKI_ROW: GeocodingResult = {
  name: 'Helsinki',
  latitude: 60.16952,
  longitude: 24.93545,
  country: 'Finland',
  admin1: 'Uusimaa',
  country_code: 'FI',
};

function okResult(rows: GeocodingResult[]): GeocodingFetchResult {
  return { ok: true, data: { results: rows } };
}

interface Harness {
  states: AutocompleteState[];
  selections: LocationSelection[];
  searchCalls: Array<{ q: string; signal: AbortSignal | undefined }>;
  controller: ReturnType<typeof createGeocodingAutocomplete>;
}

/**
 * Build a controller wired to recording arrays. The `search` impl resolves
 * results via the provided `resolver` queue (FIFO). To return a result, push
 * a function that yields a `GeocodingFetchResult`.
 */
function makeHarness(
  resolver: (q: string, signal: AbortSignal | undefined) => Promise<GeocodingFetchResult>,
  opts: { isOnline?: () => boolean; debounceMs?: number } = {},
): Harness {
  const states: AutocompleteState[] = [];
  const selections: LocationSelection[] = [];
  const searchCalls: Array<{ q: string; signal: AbortSignal | undefined }> = [];

  const controller = createGeocodingAutocomplete({
    onState: (s) => {
      states.push(s);
    },
    onSelect: (sel) => {
      selections.push(sel);
    },
    debounceMs: opts.debounceMs ?? 300,
    isOnline: opts.isOnline,
    search: async (q, callerOpts) => {
      searchCalls.push({ q, signal: callerOpts?.signal });
      return await resolver(q, callerOpts?.signal);
    },
  });

  return { states, selections, searchCalls, controller };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Debounce
// ---------------------------------------------------------------------------

describe('createGeocodingAutocomplete — debounce', () => {
  it('coalesces rapid queries into one search call with the last value', async () => {
    const h = makeHarness(async () => okResult([HELSINKI_ROW]));

    h.controller.query('He');
    h.controller.query('Hel');
    h.controller.query('Hels');

    expect(h.searchCalls).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(300);

    expect(h.searchCalls).toHaveLength(1);
    expect(h.searchCalls[0]?.q).toBe('Hels');
  });
});

// ---------------------------------------------------------------------------
// 2. Happy path state sequence
// ---------------------------------------------------------------------------

describe('createGeocodingAutocomplete — state sequence', () => {
  it('emits loading → results on a successful search', async () => {
    const h = makeHarness(async () => okResult([HELSINKI_ROW]));

    h.controller.query('Helsinki');

    await vi.advanceTimersByTimeAsync(300);
    // Allow microtasks to settle (async search).
    await vi.runOnlyPendingTimersAsync();

    expect(h.states.map((s) => s.kind)).toEqual(['loading', 'results']);
    const last = h.states[h.states.length - 1];
    if (last && last.kind === 'results') {
      expect(last.results).toHaveLength(1);
      expect(last.results[0]?.name).toBe('Helsinki');
    }
  });

  it('emits empty when the search returns no rows', async () => {
    const h = makeHarness(async () => okResult([]));

    h.controller.query('xyzzy');

    await vi.advanceTimersByTimeAsync(300);
    await vi.runOnlyPendingTimersAsync();

    expect(h.states.map((s) => s.kind)).toEqual(['loading', 'empty']);
  });
});

// ---------------------------------------------------------------------------
// 3. Offline / error classification
// ---------------------------------------------------------------------------

describe('createGeocodingAutocomplete — failure states', () => {
  it('emits offline when network fails AND isOnline() is false', async () => {
    const h = makeHarness(
      async () => ({ ok: false, error: { kind: 'network', message: 'fetch failed' } }),
      { isOnline: () => false },
    );

    h.controller.query('Helsinki');

    await vi.advanceTimersByTimeAsync(300);
    await vi.runOnlyPendingTimersAsync();

    expect(h.states.map((s) => s.kind)).toEqual(['loading', 'offline']);
  });

  it('emits error when network fails BUT isOnline() is true', async () => {
    const h = makeHarness(
      async () => ({ ok: false, error: { kind: 'network', message: 'fetch failed' } }),
      { isOnline: () => true },
    );

    h.controller.query('Helsinki');

    await vi.advanceTimersByTimeAsync(300);
    await vi.runOnlyPendingTimersAsync();

    expect(h.states.map((s) => s.kind)).toEqual(['loading', 'error']);
  });

  it('emits error on timeout', async () => {
    const h = makeHarness(async () => ({ ok: false, error: { kind: 'timeout' } }));

    h.controller.query('Helsinki');

    await vi.advanceTimersByTimeAsync(300);
    await vi.runOnlyPendingTimersAsync();

    expect(h.states.map((s) => s.kind)).toEqual(['loading', 'error']);
  });

  it('emits error on HTTP failure', async () => {
    const h = makeHarness(async () => ({
      ok: false,
      error: { kind: 'http', status: 503, retried: false },
    }));

    h.controller.query('Helsinki');

    await vi.advanceTimersByTimeAsync(300);
    await vi.runOnlyPendingTimersAsync();

    expect(h.states.map((s) => s.kind)).toEqual(['loading', 'error']);
  });

  it('does NOT emit a state for an `aborted` result (silent)', async () => {
    const h = makeHarness(async () => ({ ok: false, error: { kind: 'aborted' } }));

    h.controller.query('Helsinki');

    await vi.advanceTimersByTimeAsync(300);
    await vi.runOnlyPendingTimersAsync();

    // `loading` is emitted, but the aborted result must not produce a final
    // `error` state — UI keeps showing what it had.
    expect(h.states.map((s) => s.kind)).toEqual(['loading']);
  });
});

// ---------------------------------------------------------------------------
// 4. Abort in-flight on new query
// ---------------------------------------------------------------------------

describe('createGeocodingAutocomplete — abort in-flight on new query', () => {
  it('aborts the previous request signal when a new debounced query lands', async () => {
    // First fetch hangs; second resolves quickly. We capture both signals.
    let resolveFirst: (v: GeocodingFetchResult) => void = () => {};
    const firstPromise = new Promise<GeocodingFetchResult>((resolve) => {
      resolveFirst = resolve;
    });
    let call = 0;
    const h = makeHarness(async () => {
      call += 1;
      if (call === 1) {
        return await firstPromise;
      }
      return okResult([HELSINKI_ROW]);
    });

    h.controller.query('Helsinki');
    await vi.advanceTimersByTimeAsync(300);
    // First search is now in flight — let microtasks settle.
    await Promise.resolve();

    expect(h.searchCalls).toHaveLength(1);
    const firstSignal = h.searchCalls[0]?.signal;
    expect(firstSignal?.aborted).toBe(false);

    // New query while first is in flight.
    h.controller.query('Tallinn');
    await vi.advanceTimersByTimeAsync(300);
    await Promise.resolve();

    expect(h.searchCalls).toHaveLength(2);
    // The first signal must now be aborted — that's AC2.
    expect(firstSignal?.aborted).toBe(true);

    // Even if the hung first request later resolves, the stale-seq guard
    // must drop the result. Resolve it now.
    resolveFirst(okResult([{ ...HELSINKI_ROW, name: 'Late' }]));
    await vi.runOnlyPendingTimersAsync();

    // The visible last state is from the SECOND (Tallinn) call.
    const last = h.states[h.states.length - 1];
    expect(last?.kind).toBe('results');
    if (last?.kind === 'results') {
      expect(last.results[0]?.name).toBe('Helsinki'); // The second resolver returned HELSINKI_ROW.
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Reset to idle on empty input
// ---------------------------------------------------------------------------

describe('createGeocodingAutocomplete — empty/short input', () => {
  it('emits idle and does not fetch when input is cleared', async () => {
    const h = makeHarness(async () => okResult([HELSINKI_ROW]));

    h.controller.query('Helsinki');
    await vi.advanceTimersByTimeAsync(300);
    await vi.runOnlyPendingTimersAsync();
    expect(h.searchCalls).toHaveLength(1);

    h.controller.query('');
    // Idle is emitted synchronously — no need to advance timers.

    const last = h.states[h.states.length - 1];
    expect(last?.kind).toBe('idle');

    // No further fetches even after time passes.
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.searchCalls).toHaveLength(1);
  });

  it('emits idle and does not fetch for a 1-char input', async () => {
    const h = makeHarness(async () => okResult([HELSINKI_ROW]));

    h.controller.query('H');
    await vi.advanceTimersByTimeAsync(1000);

    const last = h.states[h.states.length - 1];
    expect(last?.kind).toBe('idle');
    expect(h.searchCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Selection callback shape
// ---------------------------------------------------------------------------

describe('createGeocodingAutocomplete — select', () => {
  it('select(row) calls onSelect with exactly { name, lat, lon }', () => {
    const h = makeHarness(async () => okResult([HELSINKI_ROW]));

    h.controller.select(HELSINKI_ROW);

    expect(h.selections).toHaveLength(1);
    const sel = h.selections[0];
    expect(sel).toBeDefined();
    if (sel) {
      // Object shape MUST be exactly these three keys — the STORY-009 contract.
      expect(Object.keys(sel).sort()).toEqual(['lat', 'lon', 'name']);
      expect(sel.name).toBe('Helsinki');
      expect(sel.lat).toBeCloseTo(60.16952, 5);
      expect(sel.lon).toBeCloseTo(24.93545, 5);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. destroy()
// ---------------------------------------------------------------------------

describe('createGeocodingAutocomplete — destroy', () => {
  it('cancels pending debounce and stops further state emissions', async () => {
    const h = makeHarness(async () => okResult([HELSINKI_ROW]));

    h.controller.query('Helsinki');
    h.controller.destroy();
    await vi.advanceTimersByTimeAsync(1000);

    expect(h.searchCalls).toHaveLength(0);
    expect(h.states).toEqual([]);
  });

  it('is idempotent', () => {
    const h = makeHarness(async () => okResult([HELSINKI_ROW]));
    h.controller.destroy();
    h.controller.destroy();
    h.controller.destroy();
    // No throw, no effect.
    expect(h.states).toEqual([]);
  });

  it('select() after destroy is a no-op', () => {
    const h = makeHarness(async () => okResult([HELSINKI_ROW]));
    h.controller.destroy();
    h.controller.select(HELSINKI_ROW);
    expect(h.selections).toEqual([]);
  });

  it('query() after destroy is a no-op', async () => {
    const h = makeHarness(async () => okResult([HELSINKI_ROW]));
    h.controller.destroy();
    h.controller.query('Helsinki');
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.searchCalls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 8. Defensive: if a custom `search` throws, the controller emits `error`
// ---------------------------------------------------------------------------

describe('createGeocodingAutocomplete — defensive (search throws)', () => {
  it('emits error if the search implementation throws', async () => {
    const h = makeHarness(async () => {
      throw new Error('boom');
    });

    h.controller.query('Helsinki');
    await vi.advanceTimersByTimeAsync(300);
    await vi.runOnlyPendingTimersAsync();

    const last = h.states[h.states.length - 1];
    expect(last?.kind).toBe('error');
  });
});
