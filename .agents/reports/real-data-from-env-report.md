# Implementation Report

**Plan**: `.agents/plans/real-data-from-env.plan.md`
**Branch**: `claude/issue-5-real-data-from-env`
**GitHub Issue**: #5
**Status**: COMPLETE

## Summary

Swapped the Phase-1 hard-coded mocks for real Open-Meteo data on the production
path. `VITE_DEFAULT_LOCATIONS` env var is parsed + validated by a new module
`src/locations/env.ts`; `src/main.ts` exports a `bootstrap()` function that
parses env, runs `Promise.allSettled(fetchForecast(...))` per location for
per-slot isolation, and renders the result via the existing UI (which already
handles `forecast: null` as an "Unavailable" state). Mocks remain in place but
are no longer referenced from production code; tests still use them. A new
`.env.example` documents the contract with fictional placeholder coordinates,
and `src/vite-env.d.ts` provides type-safe access to the env var.

## Tasks Completed

| # | Task | File | Status |
|---|------|------|--------|
| 1 | Create `.env.example` with fictional placeholders | `.env.example` | done |
| 2 | Declare `ImportMetaEnv` typing | `src/vite-env.d.ts` | done |
| 3 | Create env parser + validator | `src/locations/env.ts` | done |
| 4 | Tests for env parser (25 cases) | `src/locations/env.test.ts` | done |
| 5 | Wire `src/main.ts` to real data | `src/main.ts` | done |
| 6 | Integration test for main.ts wiring (5 cases) | `src/main.test.ts` | done |
| 7 | Verify attribution footer (no change needed) | `src/ui/app.ts:69-82` | verified |

## Validation Evidence

| Check | Command | Result |
|-------|---------|--------|
| Lint | `npm run lint` | exit 0, no warnings |
| Type check | `npx tsc --noEmit` | exit 0 |
| Tests | `npm test` | 7 files, 73 passed |
| Production build | `npm run build` | 12 modules transformed, bundle 17.70 kB / 5.50 kB gzip |

Test output (final run):

```
 Test Files  7 passed (7)
      Tests  73 passed (73)
   Duration  2.50s
```

Build output:

```
dist/index.html                  0.46 kB │ gzip: 0.29 kB
dist/assets/index-CuQ_-Ntn.css   3.41 kB │ gzip: 1.13 kB
dist/assets/index-DolaJDvn.js   17.70 kB │ gzip: 5.50 kB
✓ built in 242ms
```

## Independent Verification

**Verdict**: CONFIRMED (self-review, round 1)

Evidence reviewed against the plan and CLAUDE.md:

- Layer boundaries respected (CLAUDE.md > Architecture): `locations/env.ts`
  has no I/O imports; `main.ts` is the wiring layer; `weather/` types unchanged
  in direction (still the source of truth, with backward-compatible aliases).
- Boundary validation present (CLAUDE.md > Security): `parseDefaultLocations`
  rejects non-object entries, non-finite / out-of-range coordinates, and
  empty / non-string names. All API-sourced strings (location name) render via
  `textContent` in the existing UI.
- Per-slot isolation present (CLAUDE.md > Fault tolerance): `Promise.allSettled`
  + per-result mapping ensures one failure cannot blank-screen the others.
  Test "renders one card per parsed location, with per-slot isolation on
  failure" asserts a mixed 200/404 run renders both cards (one with weather,
  one as "Unavailable").
- No raw errors in the UI (CLAUDE.md > Error handling): parse failures go to
  `console.error` with the `[main]` prefix; UI renders the empty list (header
  + footer + zero cards), which is a stable visual state.
- No secrets / no real coordinates committed: `git grep` for the known
  public-city coordinates only finds them in test fixtures, mocks, and the
  archived STORY-002 plan — none in `src/main.ts`, `.env.example`, or any
  other production path file.
- CC-BY 4.0 attribution preserved: `src/ui/app.ts:69-82` (footer with the
  "Weather data by Open-Meteo" link) unchanged, and explicitly re-asserted
  in `main.test.ts` for the missing-env, empty-env, and full-success cases.

UNVERIFIABLE in this sandbox (deferred per CLAUDE.md > Sandbox-blocked checks):

- Live fetch against `https://api.open-meteo.com/v1/forecast` — owner runs
  via `npm run preview` locally; deploy gate on Netlify / Cloudflare Pages.
  The PRD records the same-day spike (2026-06-07) that verified the endpoint
  and field set; this story does not introduce any new endpoints or fields.
- iPhone PWA install + airplane-mode offline test — owner runs manually.
  STORY-005 does not add offline cache (STORY-006/007 own that); freshness
  on open is the contract.

## E2E Evidence

| Test | Action performed | Observed result |
|------|------------------|-----------------|
| Bootstrap with mixed 200/404 fetches | `npm test src/main.test.ts` | 2 cards render — Alpha (full forecast) + Beta ("Unavailable"); per-slot isolation confirmed |
| Bootstrap with missing env | `npm test src/main.test.ts` | `console.error` called with `VITE_DEFAULT_LOCATIONS missing`; 0 cards; header + footer still render |
| Bootstrap with malformed-json env | `npm test src/main.test.ts` | `console.error` called with `malformed-json`; 0 cards; 0 fetch calls |
| Bootstrap with empty `[]` env | `npm test src/main.test.ts` | 0 cards; 0 fetch calls; footer attribution still present |
| Bootstrap with full 4-location success | `npm test src/main.test.ts` | 4 fetch calls; 4 cards rendered |
| Production bundle builds | `npm run build` | `dist/` generated, 17.70 kB JS (5.50 kB gzip) — well under any size budget |
| No real coords in repo | `git grep` for known public-city coords | Only in tests / fixtures / mocks / archived plan — none in `src/main.ts` or `.env.example` |

## Files Changed

| File | Action | Lines |
|------|--------|-------|
| `.env.example` | CREATE | +17 |
| `src/vite-env.d.ts` | CREATE | +20 |
| `src/locations/env.ts` | CREATE | +143 |
| `src/locations/env.test.ts` | CREATE | +198 |
| `src/main.ts` | UPDATE | +137 / −18 (net +119) |
| `src/main.test.ts` | CREATE | +123 |
| `src/weather/types.ts` | UPDATE (merge) | union of both branch type sets |
| `src/weather/mocks.ts` | UPDATE (merge) | +precipitation field (new required) |
| `src/weather/open-meteo-client.test.ts` | UPDATE (merge) | optional `current_units` |
| `.agents/plans/real-data-from-env.plan.md` | CREATE | plan document |
| `.agents/reports/real-data-from-env-report.md` | CREATE | this report |

## Deviations from Plan

- The plan listed an optional `src/locations/index.ts` barrel — skipped; not
  needed (imports are explicit and the project doesn't otherwise use
  barrels).
- Initial main.test.ts used a 500 response to simulate the failing slot;
  switched to 404 because 5xx triggers the 2s+4s retry backoff, blowing past
  vitest's 5s default. 404 is in the 4xx range which is never retried — same
  end-state for the UI (forecast: null → "Unavailable"), much faster test.
  Documented in the test file's inline comment.

## Tests Written

| Test File | Test Cases |
|-----------|------------|
| `src/locations/env.test.ts` | 25 cases across `missing`, `malformed JSON`, `invalid root shape`, `invalid entry` (8 sub-cases incl. lat/lon range + index reporting), `happy path` (5 sub-cases incl. empty array + boundary lat/lon + ignored extras + whitespace) |
| `src/main.test.ts` | 5 cases: mixed success/failure isolation, missing env, malformed-json env, empty `[]` env, full 4-location success |

Total: 30 new tests; 73 passing in the full suite.
