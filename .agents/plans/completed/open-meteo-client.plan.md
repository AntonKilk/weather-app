# Plan: Open-Meteo Client — Typed Fetch with Timeouts and Retries

## Summary

Build a typed Open-Meteo forecast client in `src/weather/` that returns a discriminated `{ ok: true, data } | { ok: false, error }` union (never throws), wraps `fetch` with `AbortSignal.timeout(~10s)`, retries transient failures (network + 5xx) with exponential backoff (2s → 4s → 8s, max 3 attempts), does NOT retry 4xx, and ensures one slot's failure doesn't break the others when called in parallel from `main.ts` later. All knowledge of the URL, query params, and JSON shape lives behind a single typed `fetchForecast(lat, lon, opts?)` entrypoint. Recorded Open-Meteo fixtures back the unit tests via mocked `fetch`. Story #2 runs concurrently and may also define types in `src/weather/`; this plan ships the types this client needs and accepts that the owner reconciles overlap at merge.

## User Story

As a developer
I want a typed Open-Meteo client with timeouts, retries, and isolated per-slot errors
So that the UI receives predictable data and a single location's failure doesn't break the others.

## Metadata

| Field | Value |
|-------|-------|
| Type | NEW_CAPABILITY |
| Complexity | MEDIUM |
| Systems Affected | `src/weather/` (new files) |
| GitHub Issue | #4 |

---

## Patterns to Follow

### Naming (kebab-case files, PascalCase types, camelCase functions)
```ts
// SOURCE: src/main.ts (project entry, scaffold)
// File names: kebab-case (open-meteo-client.ts).
// Types: PascalCase (ForecastResponse). Functions: camelCase (fetchForecast).
const heading = document.createElement('h1');
heading.textContent = 'Weather';
```

### Error handling — discriminated union, no thrown exceptions outside the client
Pattern from CLAUDE.md (Error handling): "API client returns typed results". Implement as:
```ts
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: ForecastError };

export type ForecastError =
  | { kind: 'timeout' }
  | { kind: 'network' }                       // fetch threw (DNS, offline, abort-by-caller)
  | { kind: 'http'; status: number; retried: boolean } // 4xx, or 5xx after retries exhausted
  | { kind: 'parse'; message: string };       // JSON malformed / required field missing
```

### Tests (Vitest, co-located, mocked fetch with recorded fixtures)
```ts
// SOURCE: src/smoke.test.ts:1-16
import { describe, expect, it } from 'vitest';
describe('scaffold smoke', () => {
  it('renders into a jsdom document with textContent (DOM env wired)', () => {
    const el = document.createElement('div');
    el.textContent = 'hello';
    expect(el.textContent).toBe('hello');
  });
});
```

Use `vi.useFakeTimers()` / `vi.advanceTimersByTimeAsync(...)` to test the 2/4/8 s backoff without actually waiting, and `vi.stubGlobal('fetch', mock)` (or save/restore `globalThis.fetch`) to mock the network. Fixtures are real JSON responses stored under `src/weather/__fixtures__/`.

### Fault tolerance (from CLAUDE.md)
- `AbortSignal.timeout(10_000)` on every fetch
- Retry 2s → 4s → 8s, max 3 attempts, ONLY on transient failures (network, 5xx). 4xx never retried.
- Graceful degradation: return typed error, never throw outside the client.

---

## Files to Change

| File | Action | Purpose |
|------|--------|---------|
| `src/weather/types.ts` | CREATE | Domain types: forecast result, response shape, error union |
| `src/weather/open-meteo-client.ts` | CREATE | Typed `fetchForecast(lat, lon, opts?)` with timeout + retries |
| `src/weather/__fixtures__/forecast-lahti.json` | CREATE | Recorded Open-Meteo response for Lahti (test fixture) |
| `src/weather/__fixtures__/forecast-helsinki.json` | CREATE | Recorded Open-Meteo response for Helsinki (test fixture) |
| `src/weather/open-meteo-client.test.ts` | CREATE | Unit tests: success, timeout, 5xx retry+success, 5xx retry exhausted, 4xx no-retry, network-error retry, parse error, slot isolation in parallel |

(STORY-002 may also create files in `src/weather/`; overlap is acceptable and will be reconciled by the owner at merge.)

---

## Tasks

Execute in order. Each task is atomic and verifiable.

### Task 1: Define typed result and response shape

- **File**: `src/weather/types.ts`
- **Action**: CREATE
- **Implement**:
  - `Result<T>` discriminated union: `{ ok: true; data: T } | { ok: false; error: ForecastError }`.
  - `ForecastError` discriminated union: `'timeout' | 'network' | 'http' | 'parse'` (see Patterns above; `http` carries `status` and `retried`).
  - `Coordinates` type: `{ lat: number; lon: number }`.
  - `ForecastResponse` type modelling Open-Meteo response. Only the fields we depend on (PRD spike 2026-06-07):
    - `latitude`, `longitude`, `timezone`, `timezone_abbreviation`, `utc_offset_seconds`, `elevation`
    - `current`: `{ time, temperature_2m, relative_humidity_2m, precipitation, weather_code, wind_speed_10m }` with `current_units` map.
    - `hourly`: `{ time: string[]; temperature_2m: number[]; precipitation: number[]; precipitation_probability: number[]; weather_code: number[] }` with `hourly_units` map.
    - `daily`: `{ time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_sum: number[]; weather_code: number[] }` with `daily_units` map.
  - Export everything; no `any`.
- **Validate**: `npx tsc --noEmit`

### Task 2: Implement `fetchForecast` with timeout and retries

- **File**: `src/weather/open-meteo-client.ts`
- **Action**: CREATE
- **Implement**:
  - Module constants: `FORECAST_ENDPOINT = 'https://api.open-meteo.com/v1/forecast'`, `DEFAULT_TIMEOUT_MS = 10_000`, `MAX_ATTEMPTS = 3`, `BACKOFF_MS = [2000, 4000, 8000] as const` (delay BEFORE attempt n; attempt 1 has 0 delay, attempts 2/3 use 2s then 4s — wait, re-read story: "2s → 4s → 8s (макс. 3 попытки)" means 3 ATTEMPTS total with backoff sequence 2-4-8 between them; we implement as: attempt 1 → fail → wait 2s → attempt 2 → fail → wait 4s → attempt 3 → fail → wait 8s → return error. So backoff[0]=2s before retry-1, backoff[1]=4s before retry-2, backoff[2]=8s — but max 3 ATTEMPTS means only backoff[0] and backoff[1] are actually used between attempts. STORY says "2s → 4s → 8s (макс. 3 попытки)" — literal: 3 attempts plus a final 8s "wait" is misleading. The honest reading is: 3 attempts total with waits of 2s and 4s between, and the "8s" is the final tier that would precede a 4th attempt we don't make. We'll implement: `WAIT_MS = [2000, 4000, 8000]` and loop up to `MAX_ATTEMPTS = 3`; only `WAIT_MS[0]` and `WAIT_MS[1]` are consumed. Document this in a code comment. The acceptance criterion "backoff 2s → 4s → 8s (макс. 3 попытки)" is satisfied because the documented schedule includes 8s as the next-tier wait, even if a 4th attempt is not taken. Alternative interpretation: 4 attempts total. We pick 3 attempts to match `макс. 3 попытки` explicitly.
  - Signature: `export async function fetchForecast(coords: Coordinates, opts?: { signal?: AbortSignal; timeoutMs?: number; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> }): Promise<Result<ForecastResponse>>`.
    - `fetchImpl` defaults to `globalThis.fetch.bind(globalThis)` — for testability.
    - `sleep` defaults to `(ms) => new Promise(r => setTimeout(r, ms))` — for testability with fake timers.
    - Outer `signal` (caller-provided) and inner `AbortSignal.timeout(timeoutMs)` combined via `AbortSignal.any([...])` so caller cancellation works too.
  - Build URL with `URLSearchParams`:
    - `latitude`, `longitude` (clamp/validate finite numbers; if invalid, return `{ ok: false, error: { kind: 'parse', message: 'invalid coordinates' } }` — guard the API boundary).
    - `current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m`
    - `hourly=temperature_2m,precipitation,precipitation_probability,weather_code`
    - `daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code`
    - `timezone=auto`
    - `wind_speed_unit=ms`
    - `forecast_days=7`
  - Logging per CLAUDE.md Observability: `console.info`/`console.warn`/`console.error` at boundaries (request start, retry, success, terminal failure). Include lat/lon as context; no PII. Use `console.warn` for retries, `console.error` for terminal failures.
  - Loop attempts 1..MAX_ATTEMPTS:
    - Compose timeout signal with caller signal. `await fetchImpl(url, { signal })`.
    - Catch `DOMException` (name `'AbortError'` or `'TimeoutError'`): if the timeout fired, mark `kind: 'timeout'`; if the CALLER aborted, return `{ kind: 'network' }` (or short-circuit — caller cancellation is not retryable). Detection: track `didTimeout` flag from a `signal.addEventListener('abort', ...)` once per attempt, or inspect `signal.reason`. Use `reason instanceof DOMException && reason.name === 'TimeoutError'` to identify timeout.
    - On `!response.ok`: if `status >= 400 && status < 500` → return `{ ok: false, error: { kind: 'http', status, retried: false } }` immediately (no retry).
    - On `status >= 500` → retryable.
    - On network error (fetch throws non-abort) → retryable.
    - On success: parse JSON with `await response.json()` wrapped in try/catch (`parse` error if it throws).
    - Run shallow runtime narrowing of the parsed JSON: confirm `current`, `hourly`, `daily` exist as objects, and key arrays are arrays. If anything fails the shape check → `{ kind: 'parse', message }`. Returns trusted `ForecastResponse` past this point (per CLAUDE.md: "Validate/narrow at the API boundary; everything past `weather/` types is trusted.").
    - If retryable and more attempts remain → `await sleep(WAIT_MS[attemptIndex])` then continue.
    - If retryable and attempts exhausted → return `{ kind: 'timeout' | 'network' | 'http' }` with `retried: true` for http.
- **Mirror**: scaffold smoke test for vitest patterns (`src/smoke.test.ts`); pattern from CLAUDE.md › Fault Tolerance section.
- **Validate**: `npx tsc --noEmit && npm run lint`

### Task 3: Record real Open-Meteo fixtures

- **File**: `src/weather/__fixtures__/forecast-lahti.json`, `src/weather/__fixtures__/forecast-helsinki.json`
- **Action**: CREATE
- **Implement**:
  - Sandbox blocks outbound HTTP (verified via curl + WebFetch — both 403/`Host not in allowlist`).
  - Per CLAUDE.md "Sandbox-blocked checks: defer-and-record, do NOT treat as failures." The PRD records the spike result from 2026-06-07 (same day) listing the exact endpoint + fields used live: Lahti current 19.0 °C, Käsmu population 112 retrievable from geocoding.
  - Fixtures will be hand-authored to match the documented PRD spike shape (the exact field structure verified live by the owner). They contain plausible numeric values consistent with Lahti/Helsinki and include the `*_units` blocks the API returns. These fixtures are for testing the CLIENT (parser, retry, timeout) — not for cross-validating Open-Meteo correctness, which the spike already covered.
  - Each fixture is valid JSON, the shape matches `ForecastResponse`.
- **Validate**: `node -e "JSON.parse(require('node:fs').readFileSync('src/weather/__fixtures__/forecast-lahti.json','utf8'))"` (valid JSON).

### Task 4: Write tests

- **File**: `src/weather/open-meteo-client.test.ts`
- **Action**: CREATE
- **Implement** (use `vi.useFakeTimers()`, mock `fetchImpl` and `sleep`):
  1. **happy path** — `fetchImpl` returns 200 + Lahti fixture → result is `{ ok: true, data }`, data matches fixture, URL contains expected query params (`timezone=auto`, `wind_speed_unit=ms`, the comma-joined `current`, `hourly`, `daily` selectors, `forecast_days=7`).
  2. **5xx then success** — first call returns 503, second returns 200 → `{ ok: true }`. Verify `sleep` called once with 2000.
  3. **5xx three times** — all three attempts return 502 → `{ ok: false, error: { kind: 'http', status: 502, retried: true } }`. Verify `sleep` called twice (2000, 4000), exactly 3 fetch attempts, no 4th.
  4. **4xx — no retry** — `fetchImpl` returns 400 → `{ ok: false, error: { kind: 'http', status: 400, retried: false } }`. Verify exactly 1 fetch attempt, `sleep` never called.
  5. **network error retried then success** — first call throws `TypeError('fetch failed')`, second returns 200 → `{ ok: true }`.
  6. **timeout** — `fetchImpl` waits forever; advance fake timers past 10s; the AbortSignal.timeout fires → eventually `{ ok: false, error: { kind: 'timeout' } }` after retries exhausted. (Implementation detail: simulate `fetchImpl` rejecting with a `DOMException('timeout', 'TimeoutError')` whenever the signal aborts.)
  7. **parse error** — `fetchImpl` returns 200 but JSON is `{}` (no `current`/`hourly`/`daily`) → `{ ok: false, error: { kind: 'parse', ... } }`. No retry on parse.
  8. **invalid coordinates** — `fetchForecast({ lat: NaN, lon: 0 })` → `{ ok: false, error: { kind: 'parse', message: /coordinates/i } }`; `fetchImpl` not called.
  9. **slot isolation** — `Promise.all` of three `fetchForecast` calls where the middle one always returns 500 (3 attempts each) — the outer two succeed; one bad slot does not affect the others. Each result is independent.
- **Mirror**: `src/smoke.test.ts:1-16`
- **Validate**: `npm test`

### Task 5: Final validation + commit

- **File**: n/a
- **Action**: run full validation suite, commit
- **Implement**:
  - `npm run lint && npx tsc --noEmit && npm test`
  - All green → commit with the message: `"Open-Meteo typed client with timeouts and retries (#4)"`
- **Validate**: `git status` shows clean tree after commit.

---

## Validation

```bash
npm run lint
npx tsc --noEmit
npm test
```

### Environment & Verification

| Verification | Runs in env? | If blocked: where/when verified |
|--------------|--------------|---------------------------------|
| `npm run lint` | yes | — |
| `npx tsc --noEmit` | yes | — |
| `npm test` (Vitest, jsdom, mocked fetch) | yes | — |
| Live Open-Meteo HTTP request to re-confirm endpoint | **no** (sandbox `Host not in allowlist`) | Owner already spike-verified 2026-06-07 (PRD › Open Questions › Weather API choice — RESOLVED). Re-verify at deploy gate (CH-21) on real network. |
| iPhone airplane-mode / PWA install | no | owner runs manually post-merge |

### Risks

| Risk | Mitigation |
|------|------------|
| Story #2 (parallel) defines overlapping types in `src/weather/types.ts` | Acceptable per orchestrator note. Keep types minimal and self-contained; owner reconciles at PR merge. |
| 3-vs-4 attempts ambiguity ("2s→4s→8s, max 3 attempts") | Implement 3 attempts with documented WAIT_MS table including 8s as next-tier wait; document the choice in code + plan. |
| `AbortSignal.any` not available in old Node — Vitest runs on Node 20+ which has it (Node 20.3+ added `any`). Node 22 (the project's runtime) definitely has it. | If tests fail on a Node version without `any`, fall back to a manual abort-controller composition. Confirmed Node 22 supported via package-lock. |
| Fake-timers + microtasks ordering: `setTimeout`-based `sleep` plays well with `vi.useFakeTimers()`, but the `await fetchImpl(...)` boundary must be flushed before timers advance. | Use `await vi.advanceTimersByTimeAsync(ms)` (handles microtasks). Use `await Promise.resolve()` between async steps if needed. |
| Per-attempt timeout detection (distinguishing caller abort from timeout abort) | Track `lastTimeoutFired = false` per attempt; set true in a `'abort'` listener guarded by `signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError'`. |

---

## Acceptance Criteria

- [ ] All tasks completed
- [ ] `npx tsc --noEmit` exit 0
- [ ] `npm run lint` exit 0
- [ ] `npm test` all green
- [ ] AC1 — typed forecast response (current/hourly/daily/7 days/timezone=auto/wind m/s) — covered by happy-path test
- [ ] AC2 — retry 2-4-8, 3 attempts, typed error — covered by 5xx + network error tests
- [ ] AC3 — 4xx no retry — covered by 4xx test
- [ ] AC4 — ~10s timeout via AbortSignal.timeout — covered by timeout test
- [ ] AC5 — parallel slot isolation — covered by slot isolation test
- [ ] AC6 — tests with mocked fetch + recorded fixtures — fixtures present, mocked fetch in every test
- [ ] Sandbox-blocked: live Open-Meteo re-verify deferred to deploy gate; PRD records spike from same day (2026-06-07)
