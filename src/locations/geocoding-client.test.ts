import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SAMPLE_HITS_PARSED,
  SAMPLE_HITS_RAW,
  SAMPLE_NO_RESULTS_RAW,
} from './fixtures/open-meteo-geocoding.fixture';
import {
  DEFAULT_GEOCODING_COUNT,
  MIN_QUERY_LENGTH,
  OPEN_METEO_GEOCODING_URL,
  buildGeocodingUrl,
  parseGeocoding,
  searchGeocoding,
} from './geocoding-client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function emptyResponse(status: number): Response {
  return new Response(null, { status });
}

type FetchFn = typeof fetch;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildGeocodingUrl', () => {
  it('starts with the Open-Meteo geocoding endpoint', () => {
    const url = buildGeocodingUrl('Helsinki');
    expect(url.startsWith(`${OPEN_METEO_GEOCODING_URL}?`)).toBe(true);
  });

  it('encodes the name, count, and language via URLSearchParams', () => {
    const params = new URL(buildGeocodingUrl('Helsinki')).searchParams;
    expect(params.get('name')).toBe('Helsinki');
    expect(params.get('count')).toBe(String(DEFAULT_GEOCODING_COUNT));
    expect(params.get('language')).toBe('en');
  });

  it('percent-encodes non-ASCII names round-trip safely', () => {
    const url = buildGeocodingUrl('Käsmu');
    // Round-tripping through the URL parser is the actual contract — the raw
    // characters in the string don't matter as long as `searchParams.get`
    // returns the original on the other side.
    expect(new URL(url).searchParams.get('name')).toBe('Käsmu');
  });

  it('honours a custom count', () => {
    expect(new URL(buildGeocodingUrl('X', 3)).searchParams.get('count')).toBe('3');
  });
});

describe('searchGeocoding — query validation', () => {
  it('returns ok:[] for a query shorter than MIN_QUERY_LENGTH; fetchImpl is NOT called', async () => {
    expect(MIN_QUERY_LENGTH).toBe(2); // sanity — this test assumes 2
    const fetchImpl = vi.fn<FetchFn>(async () => jsonResponse(SAMPLE_HITS_RAW));
    const result = await searchGeocoding('a', { fetchImpl });
    expect(result).toEqual({ ok: true, data: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('treats whitespace-only input as too short; fetchImpl is NOT called', async () => {
    const fetchImpl = vi.fn<FetchFn>(async () => jsonResponse(SAMPLE_HITS_RAW));
    const result = await searchGeocoding('   ', { fetchImpl });
    expect(result).toEqual({ ok: true, data: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('trims the query before sending', async () => {
    const fetchImpl = vi.fn<FetchFn>(async () => jsonResponse(SAMPLE_HITS_RAW));
    await searchGeocoding('  Helsinki  ', { fetchImpl });
    const calledUrl = fetchImpl.mock.calls[0]![0] as string;
    expect(new URL(calledUrl).searchParams.get('name')).toBe('Helsinki');
  });
});

describe('searchGeocoding — happy path', () => {
  it('returns ok with the parsed places on a 200 with a valid body', async () => {
    const fetchImpl = vi.fn<FetchFn>(async () => jsonResponse(SAMPLE_HITS_RAW));
    const result = await searchGeocoding('Helsinki', { fetchImpl });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(SAMPLE_HITS_PARSED);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('passes the URL built by buildGeocodingUrl to fetch with an AbortSignal', async () => {
    const fetchImpl = vi.fn<FetchFn>(async () => jsonResponse(SAMPLE_HITS_RAW));
    await searchGeocoding('Helsinki', { fetchImpl });
    const [calledUrl, init] = fetchImpl.mock.calls[0]!;
    expect(calledUrl).toBe(buildGeocodingUrl('Helsinki'));
    expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });
});

describe('searchGeocoding — no results', () => {
  it('returns ok:[] when the response omits the results key', async () => {
    const fetchImpl = vi.fn<FetchFn>(async () => jsonResponse(SAMPLE_NO_RESULTS_RAW));
    const result = await searchGeocoding('zzzzzzqqxx', { fetchImpl });
    expect(result).toEqual({ ok: true, data: [] });
  });

  it('returns ok:[] for an explicitly empty results array', async () => {
    const fetchImpl = vi.fn<FetchFn>(async () =>
      jsonResponse({ results: [], generationtime_ms: 0.1 }),
    );
    const result = await searchGeocoding('zzzzzzqqxx', { fetchImpl });
    expect(result).toEqual({ ok: true, data: [] });
  });
});

describe('searchGeocoding — failure classification', () => {
  it('returns kind:client on 4xx and does NOT retry', async () => {
    const fetchImpl = vi.fn<FetchFn>(async () => emptyResponse(400));
    const result = await searchGeocoding('Helsinki', { fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('client');
      if (result.error.kind === 'client') expect(result.error.status).toBe(400);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns kind:server on 5xx and does NOT retry', async () => {
    const fetchImpl = vi.fn<FetchFn>(async () => emptyResponse(503));
    const result = await searchGeocoding('Helsinki', { fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('server');
      if (result.error.kind === 'server') expect(result.error.status).toBe(503);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('classifies a generic Error throw as kind:network', async () => {
    const fetchImpl = vi.fn<FetchFn>(async () => {
      throw new TypeError('Failed to fetch');
    });
    const result = await searchGeocoding('Helsinki', { fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('network');
  });

  it('classifies a TimeoutError DOMException as kind:timeout', async () => {
    const fetchImpl = vi.fn<FetchFn>(async () => {
      throw new DOMException('timeout', 'TimeoutError');
    });
    const result = await searchGeocoding('Helsinki', { fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('timeout');
  });

  it('classifies an AbortError DOMException as kind:aborted when external signal NOT aborted', async () => {
    const fetchImpl = vi.fn<FetchFn>(async () => {
      throw new DOMException('aborted', 'AbortError');
    });
    const result = await searchGeocoding('Helsinki', { fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('aborted');
  });

  it('classifies as kind:aborted when external signal is aborted (regardless of error name)', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn<FetchFn>(async () => {
      throw new DOMException('aborted by caller', 'AbortError');
    });
    const result = await searchGeocoding('Helsinki', { fetchImpl, signal: controller.signal });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('aborted');
  });
});

describe('parseGeocoding — direct unit tests', () => {
  it('rejects null with kind:parse', () => {
    const result = parseGeocoding(null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('parse');
  });

  it('rejects a string with kind:parse', () => {
    const result = parseGeocoding('not an object');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('parse');
  });

  it('treats an object with no results key as ok:[]', () => {
    const result = parseGeocoding({ generationtime_ms: 0.4 });
    expect(result).toEqual({ ok: true, data: [] });
  });

  it('rejects results with the wrong type', () => {
    const result = parseGeocoding({ results: 'oops' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('parse');
      expect(result.error.message).toContain('results');
    }
  });

  it('rejects an entry with missing name', () => {
    const result = parseGeocoding({ results: [{ latitude: 60, longitude: 24 }] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('parse');
      expect(result.error.message).toContain('result 0');
      expect(result.error.message).toContain('name');
    }
  });

  it('rejects an entry with out-of-range latitude', () => {
    const result = parseGeocoding({ results: [{ name: 'X', latitude: 91, longitude: 0 }] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('latitude');
      expect(result.error.message).toContain('range');
    }
  });

  it('rejects an entry with out-of-range longitude', () => {
    const result = parseGeocoding({ results: [{ name: 'X', latitude: 0, longitude: -181 }] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('longitude');
    }
  });

  it('accepts a minimal entry without country/admin1', () => {
    const result = parseGeocoding({ results: [{ name: 'X', latitude: 60, longitude: 24 }] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toEqual({ name: 'X', latitude: 60, longitude: 24 });
      expect(result.data[0]?.country).toBeUndefined();
      expect(result.data[0]?.admin1).toBeUndefined();
    }
  });

  it('drops empty/whitespace country and admin1', () => {
    const result = parseGeocoding({
      results: [{ name: 'X', latitude: 60, longitude: 24, country: '  ', admin1: '' }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data[0]?.country).toBeUndefined();
      expect(result.data[0]?.admin1).toBeUndefined();
    }
  });

  it('parses the recorded fixture into the expected shape', () => {
    const result = parseGeocoding(SAMPLE_HITS_RAW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(SAMPLE_HITS_PARSED);
    }
  });

  it('caps the returned array at DEFAULT_GEOCODING_COUNT entries', () => {
    const big = {
      results: Array.from({ length: 20 }, (_, i) => ({
        name: `City ${i}`,
        latitude: 0,
        longitude: 0,
      })),
    };
    const result = parseGeocoding(big);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(DEFAULT_GEOCODING_COUNT);
    }
  });
});
