# Implementation Report

**Plan**: `.agents/plans/open-meteo-client.plan.md`
**Branch**: `claude/issue-4-open-meteo-client`
**Status**: COMPLETE

## Summary

Implemented a typed Open-Meteo forecast client in `src/weather/`:

- Single public entrypoint `fetchForecast(coords, opts?)` returning a discriminated `Result<ForecastResponse>` (`{ ok: true, data } | { ok: false, error }`) — never throws.
- Per-attempt timeout of 10 s via `AbortSignal.timeout`, composed with the caller's signal via `AbortSignal.any`.
- Exponential backoff retry schedule of 2 s → 4 s, 3 attempts total (8 s is documented as the next-tier wait but no 4th attempt is taken — matches "макс. 3 попытки").
- 4xx returns immediately with `retried: false`; 5xx and network errors retry; caller abort short-circuits without retry.
- Boundary validation of the JSON response (every required block + numeric array contents) — produces a typed `parse` error if shape rejected.
- All knowledge of the URL, query params, and JSON shape stays inside `src/weather/`.

## Tasks Completed

| # | Task | File | Status |
|---|------|------|--------|
| 1 | Define typed result and response shape | `src/weather/types.ts` | DONE |
| 2 | Implement `fetchForecast` with timeout + retries | `src/weather/open-meteo-client.ts` | DONE |
| 3 | Record Open-Meteo fixtures | `src/weather/__fixtures__/forecast-lahti.json`, `…/forecast-helsinki.json` | DONE (see deviations) |
| 4 | Write tests (mocked fetch + fake-sleep) | `src/weather/open-meteo-client.test.ts` | DONE |
| 5 | Run full validation suite + commit | n/a | DONE |

## Validation Evidence

| Check | Command | Result |
|-------|---------|--------|
| Lint | `npm run lint` | exit 0, no output |
| Type check | `npx tsc --noEmit` | exit 0, no output |
| Tests | `npm test` | 19 passed / 19 total, 2 files |
| Build | `npm run build` | exit 0, `dist/` produced |

```
> weather-app@0.0.0 test
> vitest run

 RUN  v4.1.8 /home/user/weather-app/.claude/worktrees/agent-a9721d937b641617a

 Test Files  2 passed (2)
      Tests  19 passed (19)
```

```
> weather-app@0.0.0 build
> tsc --noEmit && vite build

vite v7.3.5 building client environment for production...
transforming...
✓ 3 modules transformed.
✓ built in 107ms
```

## Independent Verification

**Verdict**: UNVERIFIABLE in this environment.

Reason: this run is itself a sub-agent dispatch (the orchestrator runs me as
the implementer). Recursive `Agent`/`Task` subagent dispatch is not available
inside this nested run, so a fresh-context `verifier` agent could not be
spawned. Per CLAUDE.md › Sandbox-blocked checks, this is recorded as
defer-and-record, not as a failure.

In place of an external verifier I re-ran the full validation suite from a
clean state and audited each acceptance criterion against the tests (below).
The hard gate "never report COMPLETE over a REFUTED verdict" is satisfied:
there is no REFUTED verdict — only the absence of an external second opinion.
The owner-side review on the eventual PR closes this gap.

EVIDENCE (commands re-run after all edits):
- `npm run lint` → exit 0
- `npx tsc --noEmit` → exit 0
- `npm test` → exit 0, 19/19 passed
- `npm run build` → exit 0

UNVERIFIABLE:
- Recursive subagent dispatch — harness limitation in nested context.
- Live Open-Meteo HTTP call — sandbox blocks outbound; PRD records a spike
  performed by the owner on 2026-06-07 (same day).

## E2E Evidence

The plan has no application-level E2E test (no UI consumes this client yet —
that lands in STORY-005 per the PRD dependency graph). The unit suite IS the
end-to-end behavior of the client in isolation: it exercises every external
boundary (fetch + JSON) through the public `fetchForecast` API.

| Test (in suite) | Action performed | Observed result |
|------|------------------|-----------------|
| happy path | `fetchForecast(LAHTI, { fetchImpl: mockReturning200 })` | `{ ok: true, data }`; URL has every required query param |
| 5xx then success | mock returns 503, 200 | `{ ok: true }`; sleep called once with 2000 |
| 5xx three times | mock returns 502 × 3 | `{ ok: false, error: { kind:'http', status:502, retried:true } }`; sleep called with [2000, 4000] |
| 4xx | mock returns 400 / 404 | `{ ok: false, error: { kind:'http', retried:false } }`; sleep never called; 1 fetch |
| network retry | mock throws TypeError, then 200 | `{ ok: true }` after 1 retry |
| network exhausted | mock always throws | `{ ok: false, error: { kind:'network' } }`, 3 attempts, sleeps [2000, 4000] |
| timeout | mock hangs forever, timeoutMs=5 | `{ ok: false, error: { kind:'timeout' } }`, 3 attempts |
| caller abort | mock hangs, caller aborts mid-flight | `{ ok: false, error: { kind:'network', message:'aborted by caller' } }`, no retry |
| parse error (empty body) | mock returns 200 + `{}` | `{ ok: false, error: { kind:'parse' } }`, no retry |
| parse error (missing latitude) | mock returns mutated fixture | `parse` error mentions `latitude` |
| parse error (non-number in hourly array) | mock returns mutated fixture | `parse` error mentions `temperature_2m` |
| invalid coordinates (NaN) | `fetchForecast({ lat:NaN, lon:0 })` | `parse` error, fetch never called |
| out-of-range latitude | `fetchForecast({ lat:200, lon:0 })` | `{ ok: false }`, fetch never called |
| slot isolation (Promise.all) | three parallel calls, middle one 500 | outer two `{ ok:true }`, middle one `{ ok:false }` — independent |
| slot isolation (Promise.allSettled) | one mock throws synchronously | both promises FULFIL; client never rejects |
| backoff schedule constants | `__internals.WAIT_MS` | `[2000, 4000, 8000]` |

### Sandbox-blocked checks (defer-and-record per CLAUDE.md)

| Check | Why blocked | Where it gets verified |
|-------|-------------|------------------------|
| Live `curl https://api.open-meteo.com/v1/forecast?...` | sandbox `Host not in allowlist` (curl), HTTP 403 (WebFetch) | PRD spike 2026-06-07 (same day) verified the endpoint, fields, units, and 7-day daily block; re-confirm on first staging deploy. |
| iPhone airplane-mode / PWA install / service worker | not applicable to this story (PWA lands in Phase 3) | Owner runs manually after Phase 3. |

## Files Changed

| File | Action | Lines |
|------|--------|-------|
| `src/weather/types.ts` | CREATE | +136 |
| `src/weather/open-meteo-client.ts` | CREATE | +315 |
| `src/weather/__fixtures__/forecast-lahti.json` | CREATE | +95 |
| `src/weather/__fixtures__/forecast-helsinki.json` | CREATE | +66 |
| `src/weather/open-meteo-client.test.ts` | CREATE | +362 |
| `.agents/plans/open-meteo-client.plan.md` | CREATE | +220 |

## Deviations from Plan

1. **Fixtures**: the plan called for "recorded real Open-Meteo responses". The sandbox blocks outbound HTTP (curl and WebFetch both refused), so the fixtures are hand-authored to match the exact response shape spike-verified by the owner on 2026-06-07 (same day as this work) — same fields, same units, plausible numbers consistent with the Lahti reading captured in the PRD (19.0 °C current, 57 % humidity, 4.5 m/s wind). They are sufficient as test fixtures because their job is to exercise the CLIENT (parser, retry, timeout) — not to cross-validate Open-Meteo correctness. This is the defer-and-record path explicitly endorsed by CLAUDE.md › "Sandbox-blocked checks".

2. **Independent verifier**: the implementation pipeline asks for a fresh-context `verifier` subagent dispatch in Phase 4.5. Recursive subagent dispatch is not available in this nested run; recorded as UNVERIFIABLE per CLAUDE.md's defer-and-record policy. Self-audit performed instead.

3. **`AbortSignal.any` polyfill discussion**: confirmed `AbortSignal.any` is available on the project's Node 22 toolchain and modern Safari — no fallback needed. (Plan noted this as a risk.)

## Tests Written

| Test File | Test Cases |
|-----------|------------|
| `src/weather/open-meteo-client.test.ts` | 19 tests across 7 describe blocks: happy path + URL params, 4× retry behavior, 2× 4xx no-retry, 2× timeout/caller-abort, 5× parse/input validation, 2× slot isolation, 1× backoff constants |

## Acceptance Criteria — coverage map

- [x] AC1 — typed current + hourly + daily 7 days, `timezone=auto`, `wind_speed_unit=ms` → covered by **happy path** test (URL assertions + data shape assertions).
- [x] AC2 — retry on transient (network/5xx) with 2-4-8 schedule, max 3 attempts, typed error not thrown → covered by **5xx then success**, **5xx three times**, **network retry**, **network exhausted**.
- [x] AC3 — 4xx not retried, typed error → covered by **400** and **404** tests.
- [x] AC4 — ~10 s timeout via `AbortSignal.timeout` → covered by **timeout** test (and the `DEFAULT_TIMEOUT_MS` constant asserted in **backoff schedule**).
- [x] AC5 — per-slot isolation in parallel → covered by **Promise.all (one 500)** and **Promise.allSettled (one throws)** tests.
- [x] AC6 — tests with mocked fetch + recorded fixtures → fixtures present under `__fixtures__/`; every test uses `vi.fn`-mocked `fetchImpl`.
