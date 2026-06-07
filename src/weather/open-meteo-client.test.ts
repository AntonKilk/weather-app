// Unit tests for the Open-Meteo client.
//
// Pattern: mocked `fetchImpl` + mocked `sleep` (so no real time passes) + the
// real fixtures recorded in __fixtures__/. We never hit the network here.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import lahtiFixture from './__fixtures__/forecast-lahti.json';
import helsinkiFixture from './__fixtures__/forecast-helsinki.json';
import { __internals, fetchForecast } from './open-meteo-client';
import type { Coordinates } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LAHTI: Coordinates = { lat: 60.98, lon: 25.66 };
const HELSINKI: Coordinates = { lat: 60.17, lon: 24.94 };
const TALLINN: Coordinates = { lat: 59.44, lon: 24.75 };

/** Build a Response-shaped object mocked just enough for our client. */
function makeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** A `sleep` that records calls without actually waiting. */
function makeRecordingSleep(): { sleep: (ms: number) => Promise<void>; waits: number[] } {
  const waits: number[] = [];
  return {
    waits,
    sleep: async (ms) => {
      waits.push(ms);
    },
  };
}

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Happy path — response shape, URL params
// ---------------------------------------------------------------------------

describe('fetchForecast — happy path', () => {
  it('returns typed data on 200 and builds the correct Open-Meteo URL', async () => {
    let capturedUrl = '';
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      capturedUrl = url.toString();
      return makeResponse(200, lahtiFixture);
    }) as unknown as typeof fetch;

    const result = await fetchForecast(LAHTI, { fetchImpl });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Top-level
      expect(result.data.latitude).toBeCloseTo(60.98, 2);
      expect(result.data.longitude).toBeCloseTo(25.66, 2);
      expect(result.data.timezone).toBe('Europe/Helsinki');
      // Current block
      expect(result.data.current.temperature_2m).toBe(19.0);
      expect(result.data.current.wind_speed_10m).toBe(4.5);
      expect(result.data.current_units.wind_speed_10m).toBe('m/s');
      // Hourly arrays aligned
      expect(result.data.hourly.time.length).toBe(24);
      expect(result.data.hourly.temperature_2m.length).toBe(24);
      expect(result.data.hourly.precipitation_probability.length).toBe(24);
      expect(result.data.hourly.weather_code.length).toBe(24);
      // Daily — 7 days
      expect(result.data.daily.time.length).toBe(7);
      expect(result.data.daily.temperature_2m_max.length).toBe(7);
      expect(result.data.daily.temperature_2m_min.length).toBe(7);
      expect(result.data.daily.precipitation_sum.length).toBe(7);
      expect(result.data.daily.weather_code.length).toBe(7);
    }

    // URL contains all required params (AC1)
    const url = new URL(capturedUrl);
    expect(url.origin + url.pathname).toBe('https://api.open-meteo.com/v1/forecast');
    expect(url.searchParams.get('latitude')).toBe('60.98');
    expect(url.searchParams.get('longitude')).toBe('25.66');
    expect(url.searchParams.get('timezone')).toBe('auto');
    expect(url.searchParams.get('wind_speed_unit')).toBe('ms');
    expect(url.searchParams.get('forecast_days')).toBe('7');
    expect(url.searchParams.get('current')).toContain('temperature_2m');
    expect(url.searchParams.get('current')).toContain('relative_humidity_2m');
    expect(url.searchParams.get('current')).toContain('precipitation');
    expect(url.searchParams.get('current')).toContain('weather_code');
    expect(url.searchParams.get('current')).toContain('wind_speed_10m');
    expect(url.searchParams.get('hourly')).toContain('temperature_2m');
    expect(url.searchParams.get('hourly')).toContain('precipitation');
    expect(url.searchParams.get('hourly')).toContain('precipitation_probability');
    expect(url.searchParams.get('hourly')).toContain('weather_code');
    expect(url.searchParams.get('daily')).toContain('temperature_2m_max');
    expect(url.searchParams.get('daily')).toContain('temperature_2m_min');
    expect(url.searchParams.get('daily')).toContain('precipitation_sum');
    expect(url.searchParams.get('daily')).toContain('weather_code');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 2. Retry on 5xx, then success
// ---------------------------------------------------------------------------

describe('fetchForecast — retries on transient failures', () => {
  it('retries 5xx then succeeds on the second attempt; sleeps 2s once', async () => {
    let callCount = 0;
    const fetchImpl = vi.fn(async () => {
      callCount += 1;
      return callCount === 1 ? makeResponse(503, {}) : makeResponse(200, lahtiFixture);
    }) as unknown as typeof fetch;

    const { sleep, waits } = makeRecordingSleep();
    const result = await fetchForecast(LAHTI, { fetchImpl, sleep });

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([2_000]);
  });

  it('5xx three times: 3 attempts, sleeps [2000, 4000], returns http error retried=true', async () => {
    const fetchImpl = vi.fn(async () => makeResponse(502, {})) as unknown as typeof fetch;
    const { sleep, waits } = makeRecordingSleep();

    const result = await fetchForecast(LAHTI, { fetchImpl, sleep });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('http');
      if (result.error.kind === 'http') {
        expect(result.error.status).toBe(502);
        expect(result.error.retried).toBe(true);
      }
    }
    expect(fetchImpl).toHaveBeenCalledTimes(__internals.MAX_ATTEMPTS);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([2_000, 4_000]);
  });

  it('retries a transient network error then succeeds', async () => {
    let callCount = 0;
    const fetchImpl = vi.fn(async () => {
      callCount += 1;
      if (callCount === 1) {
        throw new TypeError('fetch failed');
      }
      return makeResponse(200, lahtiFixture);
    }) as unknown as typeof fetch;
    const { sleep, waits } = makeRecordingSleep();

    const result = await fetchForecast(LAHTI, { fetchImpl, sleep });

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([2_000]);
  });

  it('network errors on every attempt → typed network error, retried', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const { sleep, waits } = makeRecordingSleep();

    const result = await fetchForecast(LAHTI, { fetchImpl, sleep });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('network');
      if (result.error.kind === 'network') {
        expect(result.error.message).toContain('fetch failed');
      }
    }
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([2_000, 4_000]);
  });
});

// ---------------------------------------------------------------------------
// 3. 4xx — no retry
// ---------------------------------------------------------------------------

describe('fetchForecast — 4xx never retries', () => {
  it('returns http error retried=false on 400; calls fetch once; never sleeps', async () => {
    const fetchImpl = vi.fn(async () => makeResponse(400, { error: 'bad request' })) as unknown as
      typeof fetch;
    const { sleep, waits } = makeRecordingSleep();

    const result = await fetchForecast(LAHTI, { fetchImpl, sleep });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('http');
      if (result.error.kind === 'http') {
        expect(result.error.status).toBe(400);
        expect(result.error.retried).toBe(false);
      }
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
  });

  it('returns http error retried=false on 404', async () => {
    const fetchImpl = vi.fn(async () => makeResponse(404, {})) as unknown as typeof fetch;
    const { sleep, waits } = makeRecordingSleep();

    const result = await fetchForecast(LAHTI, { fetchImpl, sleep });

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === 'http') {
      expect(result.error.status).toBe(404);
      expect(result.error.retried).toBe(false);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. Timeout
// ---------------------------------------------------------------------------

describe('fetchForecast — timeout', () => {
  it('returns kind: "timeout" when the per-attempt AbortSignal.timeout fires on every attempt', async () => {
    // Simulate fetch that respects the abort signal: it rejects with a
    // TimeoutError DOMException when the signal aborts. Set a tiny timeout
    // so we don't depend on fake timers crossing into native timers.
    const fetchImpl = vi.fn(async (_url, init?: RequestInit) => {
      const signal = init?.signal;
      return await new Promise<Response>((_resolve, reject) => {
        if (signal === undefined || signal === null) {
          // Should never happen: client always passes a signal.
          reject(new Error('no signal'));
          return;
        }
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        signal.addEventListener(
          'abort',
          () => {
            reject(signal.reason);
          },
          { once: true },
        );
      });
    }) as unknown as typeof fetch;

    const { sleep, waits } = makeRecordingSleep();

    const result = await fetchForecast(LAHTI, {
      fetchImpl,
      sleep,
      timeoutMs: 5, // tiny — fires quickly on the real event loop
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('timeout');
    }
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([2_000, 4_000]);
  });

  it('returns kind: "network" with "aborted by caller" if the caller aborts', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async (_url, init?: RequestInit) => {
      const signal = init?.signal;
      return await new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener(
          'abort',
          () => {
            reject(signal.reason);
          },
          { once: true },
        );
        // Trigger the caller abort on the next tick.
        queueMicrotask(() => {
          controller.abort();
        });
      });
    }) as unknown as typeof fetch;
    const { sleep, waits } = makeRecordingSleep();

    const result = await fetchForecast(LAHTI, {
      fetchImpl,
      sleep,
      signal: controller.signal,
      timeoutMs: 30_000,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('network');
      if (result.error.kind === 'network') {
        expect(result.error.message).toBe('aborted by caller');
      }
    }
    // No retries on caller abort.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5. Parse errors and input validation
// ---------------------------------------------------------------------------

describe('fetchForecast — parse / input errors', () => {
  it('returns kind: "parse" when the JSON is missing required blocks', async () => {
    const fetchImpl = vi.fn(async () => makeResponse(200, {})) as unknown as typeof fetch;
    const { sleep, waits } = makeRecordingSleep();

    const result = await fetchForecast(LAHTI, { fetchImpl, sleep });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('parse');
    }
    // Parse errors are NOT retried — fetch happened only once.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
  });

  it('returns kind: "parse" when latitude is missing from the response', async () => {
    const broken = { ...lahtiFixture } as Record<string, unknown>;
    delete broken.latitude;
    const fetchImpl = vi.fn(async () => makeResponse(200, broken)) as unknown as typeof fetch;

    const result = await fetchForecast(LAHTI, { fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('parse');
      if (result.error.kind === 'parse') {
        expect(result.error.message).toMatch(/latitude/i);
      }
    }
  });

  it('returns kind: "parse" when hourly.temperature_2m has a non-number entry', async () => {
    const broken = JSON.parse(JSON.stringify(lahtiFixture)) as Record<string, unknown> & {
      hourly: Record<string, unknown>;
    };
    broken.hourly.temperature_2m = [10, 11, 'not a number', 13];
    const fetchImpl = vi.fn(async () => makeResponse(200, broken)) as unknown as typeof fetch;

    const result = await fetchForecast(LAHTI, { fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === 'parse') {
      expect(result.error.message).toMatch(/temperature_2m/);
    }
  });

  it('returns kind: "parse" without calling fetch when coordinates are invalid', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await fetchForecast({ lat: Number.NaN, lon: 0 }, { fetchImpl });

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === 'parse') {
      expect(result.error.message).toMatch(/coordinates/i);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects out-of-range latitude without calling fetch', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await fetchForecast({ lat: 200, lon: 0 }, { fetchImpl });
    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 6. Slot isolation — one bad location does NOT break the others
// ---------------------------------------------------------------------------

describe('fetchForecast — per-slot isolation in parallel', () => {
  it('Promise.all of three calls: middle one always 500 — outer two still succeed', async () => {
    const { sleep } = makeRecordingSleep();

    const fetchLahti = vi.fn(async () => makeResponse(200, lahtiFixture)) as unknown as
      typeof fetch;
    const fetchHelsinki = vi.fn(async () => makeResponse(500, {})) as unknown as typeof fetch;
    const fetchTallinn = vi.fn(async () =>
      makeResponse(200, helsinkiFixture),
    ) as unknown as typeof fetch;

    const [lahti, helsinki, tallinn] = await Promise.all([
      fetchForecast(LAHTI, { fetchImpl: fetchLahti, sleep }),
      fetchForecast(HELSINKI, { fetchImpl: fetchHelsinki, sleep }),
      fetchForecast(TALLINN, { fetchImpl: fetchTallinn, sleep }),
    ]);

    expect(lahti.ok).toBe(true);
    expect(tallinn.ok).toBe(true);
    expect(helsinki.ok).toBe(false);
    if (!helsinki.ok && helsinki.error.kind === 'http') {
      expect(helsinki.error.status).toBe(500);
      expect(helsinki.error.retried).toBe(true);
    }
  });

  it('Promise.allSettled handles a mix where one rejects and others fulfil — but fetchForecast never rejects', async () => {
    const fetchOk = vi.fn(async () => makeResponse(200, lahtiFixture)) as unknown as typeof fetch;
    const fetchBoom = vi.fn(async () => {
      throw new Error('boom');
    }) as unknown as typeof fetch;
    const { sleep } = makeRecordingSleep();

    const settled = await Promise.allSettled([
      fetchForecast(LAHTI, { fetchImpl: fetchOk, sleep }),
      fetchForecast(HELSINKI, { fetchImpl: fetchBoom, sleep }),
    ]);

    // Both promises FULFIL — the client never throws.
    expect(settled[0]?.status).toBe('fulfilled');
    expect(settled[1]?.status).toBe('fulfilled');
    if (settled[0]?.status === 'fulfilled') {
      expect(settled[0].value.ok).toBe(true);
    }
    if (settled[1]?.status === 'fulfilled') {
      expect(settled[1].value.ok).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Backoff schedule constants (sanity)
// ---------------------------------------------------------------------------

describe('fetchForecast — backoff schedule', () => {
  it('uses the 2/4/8 second schedule and 3 attempts max', () => {
    expect(__internals.WAIT_MS).toEqual([2_000, 4_000, 8_000]);
    expect(__internals.MAX_ATTEMPTS).toBe(3);
    expect(__internals.DEFAULT_TIMEOUT_MS).toBe(10_000);
  });
});
