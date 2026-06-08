import { afterEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_FORECAST, SAMPLE_RAW_JSON } from './fixtures/open-meteo-forecast.fixture';
import {
  DEFAULT_RETRY_DELAYS_MS,
  DEFAULT_TIMEOUT_MS,
  OPEN_METEO_FORECAST_URL,
  buildForecastUrl,
  fetchForecast,
  parseForecast,
} from './open-meteo-client';

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

describe('buildForecastUrl', () => {
  it('starts with the Open-Meteo forecast endpoint', () => {
    const url = buildForecastUrl(52.52, 13.41);
    expect(url.startsWith(`${OPEN_METEO_FORECAST_URL}?`)).toBe(true);
  });

  it('encodes every spike-verified parameter via URLSearchParams', () => {
    const params = new URL(buildForecastUrl(52.52, 13.41)).searchParams;
    expect(params.get('latitude')).toBe('52.52');
    expect(params.get('longitude')).toBe('13.41');
    expect(params.get('current')).toBe('temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m');
    expect(params.get('hourly')).toBe('temperature_2m,precipitation,precipitation_probability,weather_code');
    expect(params.get('daily')).toBe('weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum');
    expect(params.get('timezone')).toBe('auto');
    expect(params.get('wind_speed_unit')).toBe('ms');
    expect(params.get('forecast_days')).toBe('7');
  });

  it('handles negative coordinates without double-encoding', () => {
    const params = new URL(buildForecastUrl(-33.86, -151.21)).searchParams;
    expect(params.get('latitude')).toBe('-33.86');
    expect(params.get('longitude')).toBe('-151.21');
  });
});

describe('fetchForecast — happy path', () => {
  it('returns ok with the parsed ForecastResponse on a 200 with a valid body', async () => {
    const fetchImpl = vi.fn<FetchFn>(async () => jsonResponse(SAMPLE_FORECAST));
    const result = await fetchForecast(52.52, 13.41, { fetchImpl });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.timezone).toBe(SAMPLE_FORECAST.timezone);
      expect(result.data.current.temperature_2m).toBe(SAMPLE_FORECAST.current.temperature_2m);
      expect(result.data.hourly.time).toHaveLength(SAMPLE_FORECAST.hourly.time.length);
      expect(result.data.daily.time).toHaveLength(7);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('passes the URL built by buildForecastUrl to fetch with an AbortSignal', async () => {
    const fetchImpl = vi.fn<FetchFn>(async () => jsonResponse(SAMPLE_FORECAST));
    await fetchForecast(52.52, 13.41, { fetchImpl });
    const [calledUrl, init] = fetchImpl.mock.calls[0]!;
    expect(calledUrl).toBe(buildForecastUrl(52.52, 13.41));
    expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });
});

describe('fetchForecast — failure classification', () => {
  it('returns kind:parse when 200 body is malformed; does NOT retry', async () => {
    const fetchImpl = vi.fn<FetchFn>(async () => jsonResponse({}));
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => undefined);
    const result = await fetchForecast(52.52, 13.41, { fetchImpl, sleep });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('parse');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('returns kind:client on 4xx and does NOT retry', async () => {
    const fetchImpl = vi.fn<FetchFn>(async () => emptyResponse(404));
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => undefined);
    const result = await fetchForecast(52.52, 13.41, { fetchImpl, sleep });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('client');
      if (result.error.kind === 'client') expect(result.error.status).toBe(404);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe('fetchForecast — retries', () => {
  it('retries 5xx with the spec backoff and then returns kind:server', async () => {
    const fetchImpl = vi.fn<FetchFn>(async () => emptyResponse(503));
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => undefined);
    const result = await fetchForecast(52.52, 13.41, { fetchImpl, sleep });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('server');
      if (result.error.kind === 'server') expect(result.error.status).toBe(503);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1 + DEFAULT_RETRY_DELAYS_MS.length);
    expect(sleep).toHaveBeenCalledTimes(DEFAULT_RETRY_DELAYS_MS.length);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([...DEFAULT_RETRY_DELAYS_MS]);
  });

  it('succeeds after two transient 503 responses', async () => {
    let calls = 0;
    const fetchImpl = vi.fn<FetchFn>(async () => {
      calls += 1;
      return calls <= 2 ? emptyResponse(503) : jsonResponse(SAMPLE_FORECAST);
    });
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => undefined);
    const result = await fetchForecast(52.52, 13.41, { fetchImpl, sleep });
    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('treats a thrown TypeError (network) as retriable and recovers', async () => {
    let calls = 0;
    const fetchImpl = vi.fn<FetchFn>(async () => {
      calls += 1;
      if (calls <= 2) throw new TypeError('Failed to fetch');
      return jsonResponse(SAMPLE_FORECAST);
    });
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => undefined);
    const result = await fetchForecast(52.52, 13.41, { fetchImpl, sleep });
    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('classifies DOMException(TimeoutError) as kind:timeout and retries the full budget', async () => {
    const fetchImpl = vi.fn<FetchFn>(async () => {
      throw new DOMException('timed out', 'TimeoutError');
    });
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => undefined);
    const result = await fetchForecast(52.52, 13.41, { fetchImpl, sleep });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('timeout');
    expect(fetchImpl).toHaveBeenCalledTimes(1 + DEFAULT_RETRY_DELAYS_MS.length);
  });
});

describe('fetchForecast — input validation', () => {
  it('rejects NaN latitude without touching the network', async () => {
    const fetchImpl = vi.fn<FetchFn>(async () => jsonResponse(SAMPLE_FORECAST));
    const result = await fetchForecast(Number.NaN, 0, { fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('parse');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects out-of-range longitude without touching the network', async () => {
    const fetchImpl = vi.fn<FetchFn>(async () => jsonResponse(SAMPLE_FORECAST));
    const result = await fetchForecast(0, 999, { fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('parse');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('fetchForecast — parallel isolation (AC5)', () => {
  it('Promise.all over a mixed-failure batch returns one ok and one error, no throws', async () => {
    const fetchImpl = vi.fn<FetchFn>(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      return url.includes('latitude=1&') ? emptyResponse(503) : jsonResponse(SAMPLE_FORECAST);
    });
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => undefined);
    const results = await Promise.all([
      fetchForecast(1, 1, { fetchImpl, sleep }),
      fetchForecast(2, 2, { fetchImpl, sleep }),
    ]);
    expect(results[0]?.ok).toBe(false);
    if (results[0] && !results[0].ok) expect(results[0].error.kind).toBe('server');
    expect(results[1]?.ok).toBe(true);
  });
});

describe('parseForecast — boundary validation', () => {
  it('parses SAMPLE_RAW_JSON into the same shape as SAMPLE_FORECAST', () => {
    const result = parseForecast(SAMPLE_RAW_JSON);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(SAMPLE_FORECAST);
    }
  });

  it.each([
    [null, 'response is not an object'],
    ['string-not-object', 'response is not an object'],
    [{}, 'missing or invalid latitude/longitude'],
    [{ latitude: 'x', longitude: 0 }, 'missing or invalid latitude/longitude'],
  ])('rejects %o with kind:parse', (input, expected) => {
    const result = parseForecast(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('parse');
      expect(result.error.message).toContain(expected);
    }
  });

  it('rejects hourly arrays of mismatched length', () => {
    const broken = JSON.parse(JSON.stringify(SAMPLE_FORECAST)) as {
      hourly: { temperature_2m: number[] };
    };
    broken.hourly.temperature_2m = broken.hourly.temperature_2m.slice(0, -1);
    const result = parseForecast(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('parse');
      expect(result.error.message).toContain('mismatched lengths');
    }
  });

  it('rejects when a current field is missing', () => {
    const broken = JSON.parse(JSON.stringify(SAMPLE_FORECAST)) as {
      current: Record<string, unknown>;
    };
    delete broken.current.wind_speed_10m;
    const result = parseForecast(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('parse');
      expect(result.error.message).toContain('wind_speed_10m');
    }
  });
});

describe('module constants', () => {
  it('exposes the spec timeout and backoff', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(10_000);
    expect([...DEFAULT_RETRY_DELAYS_MS]).toEqual([2_000, 4_000, 8_000]);
  });
});
