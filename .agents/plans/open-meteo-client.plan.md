# Plan: Open-Meteo client — typed fetch with timeouts and retries

## Summary

Add the API boundary that Phase 2 has been waiting for: a single pure-function
client `fetchForecast(lat, lon, deps?)` in `src/weather/open-meteo-client.ts`
that hits Open-Meteo's `/v1/forecast` (params spike-verified 2026-06-07, see
PRD) with a ~10 s `AbortSignal.timeout`, retries transient failures (network
errors + 5xx) with backoff 2s → 4s → 8s, NEVER retries 4xx, validates the
response shape at the boundary, and returns a discriminated-union
`FetchResult<ForecastResponse>` so callers can `Promise.all` 6 slots in
parallel without one bad slot taking down the others. Test coverage is the
core deliverable: mocked `fetch` with a recorded live-response fixture exercises
the happy path, every retry/timeout/4xx branch, the parallel-isolation
guarantee, and the parser's boundary validation. No DOM, no UI, no new
runtime dependencies — the client is layered strictly under `weather/`.

## User Story

As a developer, I want a typed Open-Meteo client with timeouts, retries, and
per-slot error isolation, so the UI receives predictable data and a single
location's failure does not break the others.

## Metadata

| Field | Value |
|-------|-------|
| Type | NEW_CAPABILITY |
| Complexity | MEDIUM |
| GitHub Issue | #4 (STORY-004) |
| PRD | `.agents/PRDs/offline-weather-pwa.prd.md` (Phase 2 — API integration) |
| Stories | `.agents/stories/offline-weather-pwa.stories.md` → STORY-004 |
| Branch | `claude/zealous-fermi-1Zziz` |
| Blocked by | STORY-001 (merged) |
| Blocks | STORY-005, STORY-008 |

---

## Patterns to follow

| Category | File:lines | Pattern |
|----------|-----------|---------|
| LAYERING | `CLAUDE.md` › Architecture | API client lives in `src/weather/` (domain). It does NOT import from `ui/`, `locations/`, or `storage/`. Only depends on the existing types in `src/weather/types.ts`. |
| NAMING | `CLAUDE.md` › Code Patterns | Files kebab-case (`open-meteo-client.ts` — exact example from CLAUDE.md); types PascalCase (`FetchResult`, `FetchError`); functions/vars camelCase (`fetchForecast`, `parseForecast`). Domain-first naming: not `HttpClient` or `ApiHelper`. |
| TYPE STRICTNESS | `tsconfig.json:9-13`, `.eslintrc.cjs:21` | No `any` (lint = error). All array indexing safe under `noUncheckedIndexedAccess`. Boundary parsing narrows `unknown` → `ForecastResponse`; everything past that is trusted (CLAUDE.md › Types). |
| RESULT TYPE | New for this story | Discriminated union `{ ok: true; data: T } \| { ok: false; error: FetchError }`. Client NEVER throws — caller can `Promise.all` without `allSettled`. |
| ERRORS | `CLAUDE.md` › Error handling, Fault Tolerance | Timeouts via `AbortSignal.timeout(~10_000)`. Retry on network + 5xx with backoff `[2_000, 4_000, 8_000] ms` (3 retries → 4 attempts total). NEVER retry 4xx. Console-log at boundaries with location context (`[open-meteo] fetch failed for lat=…, lon=…`). |
| TESTS | `src/weather/wmo-codes.test.ts:1-43` | Vitest, NO globals, `import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'`; co-locate `*.test.ts`. Focus on logic, not DOM. Use `vi.spyOn(globalThis, 'fetch')` + `vi.useFakeTimers()` to avoid real waits. |
| FIXTURES | New for this story | One recorded real Open-Meteo response stored as a typed `.ts` module (NOT JSON) so it benefits from `tsc --noEmit` validation — the fixture's TS type IS the parser's contract. |
| INPUT VALIDATION | `CLAUDE.md` › Security, Types | `parseForecast(unknown): FetchResult<ForecastResponse>` checks every required field at the boundary. Inputs `lat`/`lon` are validated as finite numbers in range. |
| OBSERVABILITY | `CLAUDE.md` › Observability | `console.warn` / `console.error` at boundaries (fetch start/success/failure) — keep it lightweight, prefix `[open-meteo]`. |

(Greenfield rows — establish the pattern here.)

---

## Endpoint contract (locked by PRD spike 2026-06-07)

URL (one call returns current + hourly + 7-day daily):

```
https://api.open-meteo.com/v1/forecast
  ?latitude={lat}
  &longitude={lon}
  &current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m
  &hourly=temperature_2m,precipitation,precipitation_probability,weather_code
  &daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum
  &timezone=auto
  &wind_speed_unit=ms
  &forecast_days=7
```

Notes:
- `timezone=auto` makes the server interpret times in the location's local zone (the existing mock returns ISO strings that may or may not have `Z` — the parser must accept both).
- `wind_speed_unit=ms` (the existing `CurrentWeather.wind_speed_10m` is already in m/s in the mock).
- `forecast_days=7` keeps the daily array at exactly 7 entries (matching `DailyForecast` consumers in `src/ui/daily-strip.ts`).
- No API key, no auth header.
- CC-BY 4.0 attribution is a UI footer concern (STORY-005 owns that), not the client's.

**Per CLAUDE.md › Validate Before Implementing**: Task 1 below is to hit this URL live ONCE and record the response into a fixture. Do not write client logic before this step.

---

## Public API (the only exports)

```ts
// src/weather/open-meteo-client.ts

import type { ForecastResponse } from './types';

export type FetchError =
  | { kind: 'network'; message: string }                        // fetch threw (DNS, offline, abort, transport)
  | { kind: 'timeout'; message: string }                        // AbortSignal.timeout fired
  | { kind: 'server'; status: number; message: string }         // 5xx after retries
  | { kind: 'client'; status: number; message: string }         // 4xx (no retry)
  | { kind: 'parse'; message: string };                         // response not an Open-Meteo forecast shape
  // (No 'unknown' kind — every fetch-side failure maps into one of the above.)

export type FetchResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: FetchError };

export interface ClientDeps {
  // Default: globalThis.fetch
  fetchImpl?: typeof fetch;
  // Default: ms => new Promise(r => setTimeout(r, ms)). Tests inject a no-op.
  sleep?: (ms: number) => Promise<void>;
  // Default: 10_000
  timeoutMs?: number;
  // Default: [2_000, 4_000, 8_000]
  retryDelaysMs?: readonly number[];
}

export async function fetchForecast(
  lat: number,
  lon: number,
  deps?: ClientDeps,
): Promise<FetchResult<ForecastResponse>>;

// Exported for tests + STORY-005 reuse (URL building is pure).
export function buildForecastUrl(lat: number, lon: number): string;

// Exported for tests. Narrows `unknown` → `ForecastResponse` at the boundary.
export function parseForecast(raw: unknown): FetchResult<ForecastResponse>;
```

Constants (module-level, exported for tests so assertions are not tautological):

```ts
export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_RETRY_DELAYS_MS = [2_000, 4_000, 8_000] as const; // 3 retries → 4 attempts
export const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
```

### Retry semantics (locked)

- **Total attempts**: `1 + retryDelaysMs.length` = 4 by default. (3 retries between 4 attempts; the count of delays matches the count of retries.)
- **What triggers a retry**: `fetch` rejection (network error including abort due to `AbortSignal.timeout`) OR HTTP status in `[500, 600)`. Everything else is final.
- **What is final on first response**:
  - HTTP `[400, 500)` → `client` error, no retry.
  - HTTP `2xx` with malformed body → `parse` error, no retry (server is healthy, retrying won't help).
  - HTTP `2xx` with valid body → success.
- **Order**: attempt → on failure, wait `retryDelaysMs[i]` → next attempt. After the final attempt fails, return the typed error from the last attempt.
- **Timeout per attempt**: each attempt gets its own fresh `AbortSignal.timeout(timeoutMs)`. A timeout-aborted attempt counts as a "network"-kind failure for retry purposes BUT the FINAL returned error (if all attempts time out) has `kind: 'timeout'`. (Mapping: if `err.name === 'TimeoutError'` OR `err.name === 'AbortError'` AND the abort came from our own timeout → classify as timeout.)

### Parallel isolation guarantee

Because `fetchForecast` never throws, the caller can do:

```ts
const results: FetchResult<ForecastResponse>[] = await Promise.all(
  slots.map(s => fetchForecast(s.latitude, s.longitude)),
);
```

— with no `Promise.allSettled` ceremony. STORY-005 will own this wiring; the test in this story proves the property holds for the client alone.

---

## Files to change

| File | Action | Purpose |
|------|--------|---------|
| `src/weather/open-meteo-client.ts` | CREATE | The client: `fetchForecast`, `buildForecastUrl`, `parseForecast`, types + constants. |
| `src/weather/open-meteo-client.test.ts` | CREATE | Unit tests (≈10 cases — see Task 6). Mocks `fetch` via `vi.spyOn(globalThis, 'fetch')`; injects a no-op `sleep` so retry delays don't actually wait. |
| `src/weather/fixtures/open-meteo-forecast.fixture.ts` | CREATE | Single recorded live response (typed as `ForecastResponse`). The implementer runs the live `curl` in Task 1, pastes the JSON into this module, types it via `satisfies ForecastResponse`. |
| `.agents/reports/open-meteo-client-report.md` | CREATE (at end of implement) | Implementation report mirroring `.agents/reports/detail-view-svg-chart-report.md` structure. |

Counts: **3 CREATE**, **0 UPDATE**, **0 DELETE**.

**NOT touched** (deliberate):
- `src/main.ts` — hotspot per CLAUDE.md. STORY-005 wires the client into the UI; this story ships the client alone.
- `vite.config.ts` — hotspot, irrelevant here.
- `src/weather/types.ts` — already shaped for Open-Meteo; no additions needed.
- `src/weather/mock-forecasts.ts` — kept for tests in other stories.
- `src/ui/*`, `src/locations/*`, `src/storage/*` — out of scope.

---

## Implementation contract (write it like this)

```ts
// src/weather/open-meteo-client.ts

import type { ForecastResponse, CurrentWeather, HourlyForecast, DailyForecast } from './types';

// ---- public exports above; implementation below ----

const FORECAST_PARAMS = {
  current: 'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m',
  hourly: 'temperature_2m,precipitation,precipitation_probability,weather_code',
  daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum',
  timezone: 'auto',
  wind_speed_unit: 'ms',
  forecast_days: '7',
} as const;

export function buildForecastUrl(lat: number, lon: number): string {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    ...FORECAST_PARAMS,
  });
  return `${OPEN_METEO_FORECAST_URL}?${params.toString()}`;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function fetchForecast(
  lat: number,
  lon: number,
  deps: ClientDeps = {},
): Promise<FetchResult<ForecastResponse>> {
  // Input validation — fail closed before issuing a request.
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return { ok: false, error: { kind: 'parse', message: `invalid latitude: ${lat}` } };
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    return { ok: false, error: { kind: 'parse', message: `invalid longitude: ${lon}` } };
  }

  const fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const sleep = deps.sleep ?? defaultSleep;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryDelaysMs = deps.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const url = buildForecastUrl(lat, lon);

  let lastError: FetchError = { kind: 'network', message: 'no attempts made' };
  const totalAttempts = 1 + retryDelaysMs.length;

  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    const result = await attemptOnce(fetchImpl, url, timeoutMs);
    if (result.ok) return result;
    lastError = result.error;
    if (!isRetriable(result.error)) return result;
    if (attempt < retryDelaysMs.length) {
      const delay = retryDelaysMs[attempt];
      if (delay !== undefined) await sleep(delay); // noUncheckedIndexedAccess guard
    }
  }
  console.warn(`[open-meteo] all ${totalAttempts} attempts failed for lat=${lat}, lon=${lon}`, lastError);
  return { ok: false, error: lastError };
}

async function attemptOnce(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
): Promise<FetchResult<ForecastResponse>> {
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (response.status >= 500 && response.status < 600) {
      return { ok: false, error: { kind: 'server', status: response.status, message: `HTTP ${response.status}` } };
    }
    if (response.status >= 400 && response.status < 500) {
      return { ok: false, error: { kind: 'client', status: response.status, message: `HTTP ${response.status}` } };
    }
    if (!response.ok) {
      // Anything else non-OK (e.g. 3xx unhandled) — treat as server-ish, but don't retry.
      return { ok: false, error: { kind: 'server', status: response.status, message: `HTTP ${response.status}` } };
    }
    const json = (await response.json()) as unknown;
    return parseForecast(json);
  } catch (err) {
    return { ok: false, error: classifyThrown(err) };
  }
}

function classifyThrown(err: unknown): FetchError {
  if (err instanceof DOMException && err.name === 'TimeoutError') {
    return { kind: 'timeout', message: 'request timed out' };
  }
  if (err instanceof DOMException && err.name === 'AbortError') {
    // AbortSignal.timeout produces TimeoutError, not AbortError — but be defensive.
    return { kind: 'timeout', message: 'request aborted' };
  }
  if (err instanceof Error) {
    return { kind: 'network', message: err.message };
  }
  return { kind: 'network', message: 'unknown network error' };
}

function isRetriable(error: FetchError): boolean {
  return error.kind === 'network' || error.kind === 'timeout' || error.kind === 'server';
}
```

### `parseForecast` — narrowing at the boundary

The parser is paranoid about shape because everything past it is trusted
domain code. It returns `parse` errors with messages naming the missing
field — useful for tests and console logs alike.

```ts
export function parseForecast(raw: unknown): FetchResult<ForecastResponse> {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: { kind: 'parse', message: 'response is not an object' } };
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.latitude !== 'number' || typeof r.longitude !== 'number') {
    return { ok: false, error: { kind: 'parse', message: 'missing latitude/longitude' } };
  }
  if (typeof r.timezone !== 'string') {
    return { ok: false, error: { kind: 'parse', message: 'missing timezone' } };
  }
  const current = parseCurrent(r.current);
  if (!current.ok) return current;
  const hourly = parseHourly(r.hourly);
  if (!hourly.ok) return hourly;
  const daily = parseDaily(r.daily);
  if (!daily.ok) return daily;
  return {
    ok: true,
    data: {
      latitude: r.latitude,
      longitude: r.longitude,
      timezone: r.timezone,
      current: current.data,
      hourly: hourly.data,
      daily: daily.data,
    },
  };
}
```

`parseCurrent`, `parseHourly`, `parseDaily` are private helpers that validate
their respective sub-objects (every required field present, correct primitive
type, array fields are arrays of numbers — except `time` arrays of strings).

**Validation strictness rule for arrays**: assert `Array.isArray(x)` AND
that every element is the expected primitive type. If the API ever changes
a number to `null`, we want the parser to fail loudly, not silently render
NaN-ridden charts downstream.

**Length consistency rule** (cheap & cheerful — catches API-shape drift):
`hourly.time.length` must equal each of `hourly.temperature_2m.length`,
`precipitation.length`, `precipitation_probability.length`, `weather_code.length`.
Same for daily. Mismatch → `parse` error.

---

## Live-fixture contract

The fixture file `src/weather/fixtures/open-meteo-forecast.fixture.ts`:

- Contains exactly ONE recorded response — pasted from the Task 1 live `curl`
  using a neutral demo coordinate (e.g. Berlin 52.52, 13.41 from Open-Meteo docs, OR Helsinki city centre 60.17/24.94 — public locations either way). **Do NOT use any of the four city names from CLAUDE.md with their real env-injected coordinates**; if in doubt use Berlin (Open-Meteo's own docs example).
- Typed as `const SAMPLE_FORECAST = { … } satisfies ForecastResponse;` so any
  drift between fixture and types fails `tsc --noEmit`.
- Exports `SAMPLE_FORECAST` and a derived `SAMPLE_RAW_JSON = JSON.parse(JSON.stringify(SAMPLE_FORECAST))` for parser tests that need an `unknown`-shaped input.

The fixture's job is two-fold:
1. Confirm at compile time that our types still match Open-Meteo's reality.
2. Feed the mocked `fetch` so tests use realistic shapes rather than minimal stubs.

---

## Tasks

Execute in order. Each task is atomic and verifiable.

### Task 1: Validate live endpoint (CLAUDE.md gate)

- **Action**: Run a real `curl` to confirm the endpoint is up, the params are accepted, and the response still has the fields our types claim.
- **Command**:
  ```bash
  curl -sS --max-time 10 \
    "https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.41&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&hourly=temperature_2m,precipitation,precipitation_probability,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto&wind_speed_unit=ms&forecast_days=7" \
    | head -c 4000
  ```
- **Verify** the response has the top-level keys `latitude`, `longitude`, `timezone`, `current`, `hourly`, `daily`, and that `hourly.time` / `temperature_2m` / `precipitation` / `precipitation_probability` / `weather_code` are arrays of the expected primitive types; daily has 7 entries.
- **If endpoint is unreachable from this sandbox**: record this as a CLAUDE.md sandbox-blocked check (defer-and-record), use the existing `mock-forecasts.ts` data as the seed for the fixture instead, and proceed. The compile-time `satisfies ForecastResponse` is the real type guarantee; the fixture realism is bonus.
- **Validate**: paste the (trimmed) response into the fixture file — Task 2 picks it up.

### Task 2: Create the fixture — `src/weather/fixtures/open-meteo-forecast.fixture.ts`

- **File**: `src/weather/fixtures/open-meteo-forecast.fixture.ts`
- **Action**: CREATE
- **Implement**:
  - `import type { ForecastResponse } from '../types';`
  - `export const SAMPLE_FORECAST = { … } satisfies ForecastResponse;`
    — paste the live response (or, if Task 1 was sandbox-blocked, a minimal but realistic synthetic — 24 hourly entries, 7 daily entries, all fields populated with numbers from the existing `mock-forecasts.ts` style).
  - `export const SAMPLE_RAW_JSON: unknown = JSON.parse(JSON.stringify(SAMPLE_FORECAST));`
    — round-trip kills the TS type so parser tests get true `unknown`.
- **Mirror**: `src/weather/mock-forecasts.ts` for the kind of data shape (24h, 7d).
- **Validate**: `npx tsc --noEmit` must pass. If it fails because of `satisfies`, the fixture has drifted from `ForecastResponse` — fix the fixture, do NOT relax the types.

### Task 3: Public types + constants + URL builder — `src/weather/open-meteo-client.ts`

- **File**: `src/weather/open-meteo-client.ts`
- **Action**: CREATE
- **Implement** (this task ships ONLY the exports below — no `fetchForecast` body yet, leave it as a typed stub returning `{ ok: false, error: { kind: 'network', message: 'not implemented' } }` so the file type-checks; the next tasks fill it):
  - `FetchError`, `FetchResult<T>`, `ClientDeps` types.
  - `DEFAULT_TIMEOUT_MS`, `DEFAULT_RETRY_DELAYS_MS`, `OPEN_METEO_FORECAST_URL`.
  - `buildForecastUrl(lat, lon)` per the spec above.
- **Mirror**: `src/weather/wmo-codes.ts:1-56` for the pure-module style and JSDoc terseness.
- **Validate**: `npx tsc --noEmit` passes; `npm run lint` passes.

### Task 4: `parseForecast` boundary validator

- **File**: `src/weather/open-meteo-client.ts`
- **Action**: UPDATE (extend with the parser + private helpers)
- **Implement**: `parseForecast`, `parseCurrent`, `parseHourly`, `parseDaily` per the contracts above. Private helpers (not exported) for the sub-parsers. Length-consistency checks included.
- **Mirror**: nothing in the repo yet — establish the pattern. Style follows the rest of `src/weather/`: pure functions, narrow types, no DOM, no `any`.
- **Validate**: covered by Task 6's parser tests.

### Task 5: `attemptOnce` + `fetchForecast` body

- **File**: `src/weather/open-meteo-client.ts`
- **Action**: UPDATE (replace the stub)
- **Implement** the loop + classifier + retry gate per the contract above. Add the `[open-meteo] all N attempts failed for lat=…, lon=…` console.warn on terminal failure. Optional: a `console.log('[open-meteo] fetch ok for lat=…')` on the success path — but keep it OFF by default to avoid noisy tests; if added, gate by `import.meta.env.DEV` so production builds stay quiet. **Decision: add console.warn on terminal failure only; success is silent.**
- **Mirror**: `CLAUDE.md` › Fault Tolerance numbers verbatim.
- **Validate**: covered by Task 6's behaviour tests.

### Task 6: Unit tests — `src/weather/open-meteo-client.test.ts`

- **File**: `src/weather/open-meteo-client.test.ts`
- **Action**: CREATE
- **Implement** at minimum:
  1. **`buildForecastUrl` shape**: URL contains the expected params (current/hourly/daily lists, `timezone=auto`, `wind_speed_unit=ms`, `forecast_days=7`); latitude/longitude encoded via `URLSearchParams`; no double encoding.
  2. **Happy path**: spy on `globalThis.fetch` to return `new Response(JSON.stringify(SAMPLE_FORECAST), { status: 200 })`; expect `{ ok: true, data: SAMPLE_FORECAST equivalent }`.
  3. **Parse failure on malformed body**: fetch returns `200` with `'{}'`; expect `{ ok: false, error: { kind: 'parse', … } }`. No retry happened (assert spy was called exactly once).
  4. **4xx — no retry**: fetch returns `404`; expect `{ ok: false, error: { kind: 'client', status: 404, … } }`; spy called exactly once.
  5. **5xx — retries then gives up**: fetch returns `503` on every call; inject `sleep = vi.fn(async () => {})` so no real waits; expect `{ ok: false, error: { kind: 'server', status: 503, … } }`; spy called exactly **4 times** (1 + 3 retries); `sleep` called exactly 3 times with `[2_000, 4_000, 8_000]` in that order.
  6. **Eventual success**: fetch returns `503` twice then `200` with valid body; expect `{ ok: true }`; spy called exactly 3 times; sleep called 2 times.
  7. **Network throw — retries**: fetch throws a `TypeError('Failed to fetch')` on the first 2 calls, then succeeds. Expect `{ ok: true }`; spy called 3 times; sleep called 2 times. Error before final success was treated as retriable `network`.
  8. **Timeout classification**: fetch throws a `DOMException('timeout', 'TimeoutError')` on every attempt. Expect `{ ok: false, error: { kind: 'timeout', … } }`; spy called 4 times (timeouts are retriable). NOTE: do not test the real `AbortSignal.timeout` firing — we don't need to validate the platform; we test how we classify the resulting `DOMException`.
  9. **Parallel isolation**: `await Promise.all([fetchForecast(lat1, lon1), fetchForecast(lat2, lon2)])` where the spy is set to fail for the first lat/lon (5xx exhausted) and succeed for the second; expect first `ok: false` and second `ok: true`; NEITHER throws; result order matches input.
  10. **Invalid input**: `fetchForecast(NaN, 0)` and `fetchForecast(0, 999)` each return `{ ok: false, error: { kind: 'parse', … } }`; fetch is NEVER called.
  11. **`parseForecast` direct tests**: pass `null`, `'string'`, `{}`, `{ latitude: 'x' }`, and a sample with `hourly.time.length !== hourly.temperature_2m.length` — each returns a `parse` error with a distinct message; pass `SAMPLE_RAW_JSON` — returns `ok: true` with the same shape as `SAMPLE_FORECAST`.
- **Test setup**:
  - `beforeEach`: `vi.restoreAllMocks();` (resets fetch spy).
  - For fetch mocking, use `vi.spyOn(globalThis, 'fetch').mockImplementation(...)`; for sleep injection, pass `deps.sleep = vi.fn().mockResolvedValue(undefined)`.
  - **Do NOT use `vi.useFakeTimers()`** — sleep injection sidesteps the need; fake timers + `AbortSignal.timeout` interaction is fragile.
- **Mirror**: `src/weather/wmo-codes.test.ts:1-43` (no globals, plain `describe`/`it`); `src/ui/home-screen.test.ts` for `vi` usage in the repo (if any) — otherwise establish the pattern.
- **Validate**: `npm test` — all cases green.

### Task 7: Full validation pass + implementation report

- **Implement**:
  1. `npm run lint && npx tsc --noEmit && npm test` — every command exits 0. (CLAUDE.md › Validation.)
  2. `npm run build` — succeeds; bundle size delta near zero (the client is small + no new deps).
  3. Write `.agents/reports/open-meteo-client-report.md` mirroring `.agents/reports/detail-view-svg-chart-report.md` structure (Summary, Tasks Completed, Validation Evidence, Acceptance Criteria Mapping, Tests Written, Files Changed, Re-verification).
- **Sandbox-blocked items** (record explicitly, do NOT fail on them):
  - Real-device iPhone test of network behaviour (no UI surface yet — STORY-005 wires it in).
  - Production deploy / Lighthouse check — STORY-010 territory.
- **Validate**: every command above exits 0; the report file exists.

---

## Risks

| Risk | Mitigation |
|------|------------|
| `AbortSignal.timeout` availability — needs a modern runtime | TypeScript `target: ES2022` + jsdom 25 + Node 18+ all support it. Vitest's jsdom env exposes it as `globalThis.AbortSignal`. If a CI runner ever lacks it, swap to manual `AbortController + setTimeout` — but don't pre-emptively add a polyfill. |
| Tests that exercise retry waits could be slow | Inject a no-op `sleep` via `ClientDeps.sleep`; the production default uses real `setTimeout`. Tests assert `sleep` was called with the expected delays, NOT that wall-clock elapsed. |
| `vi.useFakeTimers()` would break `AbortSignal.timeout` mid-attempt | We don't use fake timers. The classifier handles a thrown `DOMException` directly — we test the classification, not the timer plumbing. |
| `noUncheckedIndexedAccess` makes `retryDelaysMs[i]` `number \| undefined` | Single guarded read inside the loop (`if (delay !== undefined) await sleep(delay)`), already in the contract above. |
| Fixture drift from real Open-Meteo response | `satisfies ForecastResponse` makes type drift a compile error. Live-call gate in Task 1 catches semantic drift. |
| Committing real personal coordinates by accident | Fixture uses a public/demo coordinate (Berlin 52.52/13.41 from Open-Meteo's docs, or Helsinki city centre). The four CLAUDE.md cities + their env-injected coords MUST NOT appear in the repo. |
| `console.warn` on every terminal failure could clutter test output | Acceptable for now (CLAUDE.md › Observability prefers log-at-boundaries); the failing tests intentionally exercise failure paths and the surface noise is small. If it becomes annoying, the test can `vi.spyOn(console, 'warn')` and assert + suppress. |
| 3xx redirects | `fetch` follows redirects by default; we never see them. If the API ever returns a manual redirect status code we treat it as a non-success and don't retry — that's a deliberate "fail loud" choice. |
| Open-Meteo rate limit hit during tests (would only happen on real-network runs) | All tests mock `fetch` — they never hit the network. Task 1's single `curl` is well under the 10,000/day free-tier ceiling. |
| Network unreachable from sandbox during Task 1 | Defer-and-record per CLAUDE.md › Sandbox-blocked checks; fall back to synthesizing the fixture from existing `mock-forecasts.ts` data — the type contract is unchanged. |

---

## Validation

Run before declaring done — exact commands from CLAUDE.md › Commands / Validation:

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
```

Deferred (CLAUDE.md › Sandbox-blocked checks — recorded, NOT failed):

- Live `curl` re-verification, if outbound network is blocked in this environment (Task 1 fallback).
- Real-iPhone end-to-end (no UI surface this story — STORY-005 owns the first user-visible touch).

---

## Acceptance criteria

Issue #4 ACs → tasks/tests mapping (every AC maps to ≥ 1 task or test):

- [ ] **AC1** — Typed forecast object: current + hourly (temperature, precipitation, precipitation_probability, weather_code) + daily 7d (max/min, precipitation_sum, weather_code), `timezone=auto`, wind in m/s.
      → Task 3 (`buildForecastUrl` includes every param + `timezone=auto` + `wind_speed_unit=ms` + `forecast_days=7`), Task 4 (`parseForecast` validates every field), Task 6 case 1 (URL shape) + case 11 (parser direct), Task 2 (fixture typed as `ForecastResponse`).
- [ ] **AC2** — Network/5xx → backoff 2s/4s/8s, max 3 retries, then typed error (no throw).
      → Task 5 (loop + `DEFAULT_RETRY_DELAYS_MS`), Task 6 cases 5 (5xx exhausted with delay assertions) + 7 (network throw retries) + 8 (timeout retries).
- [ ] **AC3** — 4xx → no retry, typed error.
      → Task 5 (`isRetriable` excludes `client`), Task 6 case 4 (spy called exactly once on 404).
- [ ] **AC4** — Hung network → aborted by ~10 s `AbortSignal.timeout`.
      → Task 5 (`AbortSignal.timeout(timeoutMs)` per attempt), Task 6 case 8 (classifier maps `DOMException('TimeoutError')` → `kind: 'timeout'`). The platform timer itself is trusted (we don't test the runtime).
- [ ] **AC5** — `Promise.all` across multiple locations: one slot's failure doesn't affect others.
      → Task 5 (client returns `Result`, never throws), Task 6 case 9 (parallel mixed success/failure).
- [ ] **AC6** — Retry/timeout/parser logic covered by tests on mocked `fetch` with recorded fixture.
      → Task 2 (fixture), Task 6 (cases 2–11).

Process gates:

- [ ] All tasks completed
- [ ] `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build` pass
- [ ] No new runtime dependencies (`package.json` `dependencies` stays empty)
- [ ] No `any` anywhere in new code; lint = 0 errors, 0 warnings
- [ ] No `innerHTML`, no DOM usage in `src/weather/` (the client is pure data + fetch — no UI)
- [ ] No real default locations or coordinates committed to the repo (Lahti/Helsinki/Tallinn/Käsmu + their env-injected lat/lon stay out)
- [ ] Fixture file is typed `satisfies ForecastResponse` (compile-time contract)
- [ ] Sandbox-blocked checks (Task 1 live `curl`, real-device test) recorded as defer-and-record, NOT treated as failures
- [ ] Issue #4 acceptance criteria → tasks/tests mapping above is complete
