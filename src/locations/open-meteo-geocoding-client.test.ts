// Unit tests for the Open-Meteo geocoding client.
//
// Pattern: mocked `fetchImpl` + recorded fixtures. We never hit the network.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import helsinkiFixture from './__fixtures__/geocoding-helsinki.json';
import emptyFixture from './__fixtures__/geocoding-empty.json';
import { __internals, searchLocations } from './open-meteo-geocoding-client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
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

describe('searchLocations — happy path', () => {
  it('returns typed data on 200 and builds the correct geocoding URL', async () => {
    let capturedUrl = '';
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      capturedUrl = url.toString();
      return makeResponse(200, helsinkiFixture);
    }) as unknown as typeof fetch;

    const result = await searchLocations('Helsinki', { fetchImpl });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.results).toHaveLength(3);
      const first = result.data.results[0];
      expect(first?.name).toBe('Helsinki');
      expect(first?.latitude).toBeCloseTo(60.16952, 4);
      expect(first?.longitude).toBeCloseTo(24.93545, 4);
      expect(first?.country).toBe('Finland');
      expect(first?.admin1).toBe('Uusimaa');
      expect(first?.country_code).toBe('FI');
      // Optional fields with the wrong type would silently drop — verify the
      // good ones are present.
      expect(first?.population).toBe(558457);
    }

    // AC1: URL contains the right query params.
    const url = new URL(capturedUrl);
    expect(url.origin + url.pathname).toBe(__internals.GEOCODING_ENDPOINT);
    expect(url.searchParams.get('name')).toBe('Helsinki');
    expect(url.searchParams.get('count')).toBe('5');
    expect(url.searchParams.get('language')).toBe('en');
    expect(url.searchParams.get('format')).toBe('json');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('respects the count and language overrides', async () => {
    let capturedUrl = '';
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      capturedUrl = url.toString();
      return makeResponse(200, helsinkiFixture);
    }) as unknown as typeof fetch;

    await searchLocations('Helsinki', { fetchImpl, count: 10, language: 'fi' });

    const url = new URL(capturedUrl);
    expect(url.searchParams.get('count')).toBe('10');
    expect(url.searchParams.get('language')).toBe('fi');
  });
});

// ---------------------------------------------------------------------------
// 2. Short query — no fetch
// ---------------------------------------------------------------------------

describe('searchLocations — short query', () => {
  it('returns ok with empty results for a 1-char query and never calls fetch', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    const result = await searchLocations('H', { fetchImpl });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.results).toEqual([]);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('trims whitespace before checking the 2-char floor — single trimmed char does not fetch', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    const result = await searchLocations('  H  ', { fetchImpl });

    expect(result.ok).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('trims whitespace before building the URL name param', async () => {
    let capturedUrl = '';
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      capturedUrl = url.toString();
      return makeResponse(200, helsinkiFixture);
    }) as unknown as typeof fetch;

    await searchLocations('  Helsinki  ', { fetchImpl });

    const url = new URL(capturedUrl);
    expect(url.searchParams.get('name')).toBe('Helsinki');
  });

  it('returns empty results for the empty string and does not fetch', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    const result = await searchLocations('', { fetchImpl });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.results).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. Empty response (no `results` key) — success with zero results
// ---------------------------------------------------------------------------

describe('searchLocations — empty response', () => {
  it('returns ok with empty results when the body omits the `results` key', async () => {
    const fetchImpl = vi.fn(async () => makeResponse(200, emptyFixture)) as unknown as typeof fetch;

    const result = await searchLocations('xyzzy', { fetchImpl });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.results).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Caller abort — soft signal, no retry, no error in UI
// ---------------------------------------------------------------------------

describe('searchLocations — caller abort', () => {
  it('returns kind: "aborted" when the caller signal fires', async () => {
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
        queueMicrotask(() => {
          controller.abort();
        });
      });
    }) as unknown as typeof fetch;

    const result = await searchLocations('Helsinki', {
      fetchImpl,
      signal: controller.signal,
      timeoutMs: 30_000,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('aborted');
    }
    // No retries on abort.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 5. Timeout — single attempt, no retry
// ---------------------------------------------------------------------------

describe('searchLocations — timeout', () => {
  it('returns kind: "timeout" and does NOT retry when the per-request timeout fires', async () => {
    const fetchImpl = vi.fn(async (_url, init?: RequestInit) => {
      const signal = init?.signal;
      return await new Promise<Response>((_resolve, reject) => {
        if (signal === undefined || signal === null) {
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

    const result = await searchLocations('Helsinki', {
      fetchImpl,
      timeoutMs: 5,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('timeout');
    }
    // Geocoding does NOT retry — single call.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 6. HTTP errors — no retry, 4xx and 5xx both single-shot
// ---------------------------------------------------------------------------

describe('searchLocations — HTTP errors', () => {
  it('returns http error retried=false on 400; calls fetch once', async () => {
    const fetchImpl = vi.fn(async () => makeResponse(400, { error: 'bad request' })) as unknown as
      typeof fetch;

    const result = await searchLocations('Helsinki', { fetchImpl });

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === 'http') {
      expect(result.error.status).toBe(400);
      expect(result.error.retried).toBe(false);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns http error retried=false on 503 — does NOT retry', async () => {
    const fetchImpl = vi.fn(async () => makeResponse(503, {})) as unknown as typeof fetch;

    const result = await searchLocations('Helsinki', { fetchImpl });

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === 'http') {
      expect(result.error.status).toBe(503);
      expect(result.error.retried).toBe(false);
    }
    // The contrast with forecast client: geocoding never retries.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 7. Parse errors
// ---------------------------------------------------------------------------

describe('searchLocations — parse errors', () => {
  it('returns kind: "parse" when a row is missing latitude', async () => {
    const broken = {
      results: [{ name: 'X', longitude: 1.0 }],
    };
    const fetchImpl = vi.fn(async () => makeResponse(200, broken)) as unknown as typeof fetch;

    const result = await searchLocations('Helsinki', { fetchImpl });

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === 'parse') {
      expect(result.error.message).toMatch(/latitude/i);
    }
  });

  it('returns kind: "parse" when a row is missing name', async () => {
    const broken = {
      results: [{ latitude: 1, longitude: 2 }],
    };
    const fetchImpl = vi.fn(async () => makeResponse(200, broken)) as unknown as typeof fetch;

    const result = await searchLocations('Helsinki', { fetchImpl });

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === 'parse') {
      expect(result.error.message).toMatch(/name/i);
    }
  });

  it('returns kind: "parse" when `results` is not an array', async () => {
    const broken = { results: 'oops' };
    const fetchImpl = vi.fn(async () => makeResponse(200, broken)) as unknown as typeof fetch;

    const result = await searchLocations('Helsinki', { fetchImpl });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('parse');
    }
  });

  it('returns kind: "parse" when the body is not an object', async () => {
    const fetchImpl = vi.fn(async () => makeResponse(200, 42)) as unknown as typeof fetch;

    const result = await searchLocations('Helsinki', { fetchImpl });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('parse');
    }
  });
});

// ---------------------------------------------------------------------------
// 8. Network errors — no retry
// ---------------------------------------------------------------------------

describe('searchLocations — network errors', () => {
  it('returns kind: "network" when fetch throws; single call (no retry)', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;

    const result = await searchLocations('Helsinki', { fetchImpl });

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === 'network') {
      expect(result.error.message).toContain('fetch failed');
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
