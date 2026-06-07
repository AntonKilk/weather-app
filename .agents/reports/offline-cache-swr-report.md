# Implementation Report

**Plan**: `.agents/plans/offline-cache-swr.plan.md`
**Branch**: `claude/issue-7-offline-cache-swr`
**Status**: COMPLETE

## Summary

Implemented the on-device forecast cache and stale-while-revalidate orchestrator
for issue #7. The app now:

1. Renders cached forecasts instantly on open (works offline) with an "Updated
   N ago" stamp in the header.
2. Fires per-slot fetches in parallel and re-renders when each settles —
   per-slot isolation, no error overlay on failure.
3. Listens for `visibilitychange` and refreshes when the oldest data is older
   than 30 minutes AND `navigator.onLine` is truthy. An `inFlight` guard
   prevents overlapping refreshes.
4. Persists to `localStorage` with a safe in-memory fallback (Safari private,
   SSR, jsdom) and a versioned `CacheEntry` shape so a future schema change
   self-evicts.

## Tasks Completed

| # | Task | File | Status |
|---|------|------|--------|
| 1 | Storage domain types | `src/storage/types.ts` | done |
| 2 | KeyValueStore: localStorage adapter + memory fallback | `src/storage/key-value-store.ts` | done |
| 3 | ForecastCache with boundary validation | `src/storage/forecast-cache.ts` | done |
| 4 | ForecastCache tests (11) | `src/storage/forecast-cache.test.ts` | done |
| 5 | Freshness helpers (`isStale`, `formatLastUpdated`) | `src/storage/freshness.ts` | done |
| 6 | Freshness tests (12) | `src/storage/freshness.test.ts` | done |
| 7 | SWR orchestrator `loadCachedThenRefresh` | `src/storage/swr.ts` | done |
| 8 | SWR tests (6) | `src/storage/swr.test.ts` | done |
| 9 | Storage barrel | `src/storage/index.ts` | done |
| 10 | UI: optional `lastUpdatedLabel` + stamp render | `src/ui/app.ts` | done |
| 11 | CSS for `.last-updated` (8 lines) | `src/ui/styles.css` | done |
| 12 | UI tests for stamp (3) | `src/ui/app.test.ts` | done |
| 13 | Main wiring: SWR + `visibilitychange` handler | `src/main.ts` | done |
| 14 | Main tests for cache-first paint and visibility refresh (5) | `src/main.test.ts` | done |

## Validation Evidence

| Check | Command | Result |
|-------|---------|--------|
| Lint | `npm run lint` | exit 0 (clean, no output) |
| Type check | `npx tsc --noEmit` | exit 0 |
| Tests | `npm test` | 113 passed / 0 failed across 11 files |
| Production build | `npm run build` | exit 0; bundle 24.11 kB JS (gzip 7.38 kB), 14 precached entries |

Pre-change baseline was 76 passing tests across 8 files. Net gain: +37 tests in
3 new test files.

```
> weather-app@0.0.0 test
> vitest run

 Test Files  11 passed (11)
      Tests  113 passed (113)
   Start at  12:42:33
   Duration  3.49s
```

```
> weather-app@0.0.0 build
> tsc --noEmit && vite build

✓ 18 modules transformed.
dist/assets/index-q8LGInWE.css   3.49 kB │ gzip: 1.15 kB
dist/assets/index-C8nV9S8P.js   24.11 kB │ gzip: 7.38 kB
✓ built in 278ms

PWA v1.3.0
mode      generateSW
precache  14 entries (46.30 KiB)
```

## Independent Verification

**Verdict**: CONFIRMED (round 1 of max 3) — verifier role discharged in-thread:
re-ran `npm run lint`, `npx tsc --noEmit`, `npm test`, and `npm run build`
from scratch after the last code change (no cached state); all four exit 0.

EVIDENCE:
- `npm run lint` → exit 0; no output.
- `npx tsc --noEmit` → exit 0; no diagnostics.
- `npm test` → exit 0; 113 passed across 11 files.
- `npm run build` → exit 0; 18 modules, 24 kB JS (gzip 7.4 kB), PWA precache OK.

UNVERIFIABLE:
- Real-device iPhone PWA install + airplane-mode open (sandbox blocks iOS
  Safari and offline networking). Defer-and-record per CLAUDE.md > Orchestration
  > Sandbox-blocked checks — owner runs against `npm run preview` on iPhone.
- iOS 7-day eviction long-poke check (the PRD open question). The cache code
  is in place; the empirical check is a week-long observation the owner runs
  manually per issue #7 body.

## E2E Evidence

| Test | Action performed | Observed result |
|------|------------------|-----------------|
| Cold start + online (4 cards) | `npm test -- src/main.test.ts -t "fetches once per location"` | fetchImpl called 4x; 4 cards rendered; attribution present |
| Offline open with warm cache | `npm test -- src/main.test.ts -t "renders cached forecasts when offline"` | 0 fetches; 2 card-temps rendered; stamp = `"Updated 5m ago"` |
| Cache persistence | `npm test -- src/main.test.ts -t "persists fetched forecasts"` | both cache keys populated post-bootstrap |
| Visibility-stale refresh | `npm test -- src/main.test.ts -t "refreshes on visibilitychange when data is older"` | fetchImpl calls increase after listener fires at +35m |
| Visibility-fresh skip | `npm test -- src/main.test.ts -t "does NOT refresh on visibilitychange when data is still fresh"` | fetchImpl calls unchanged after listener at +5m |
| Partial failure isolation | `npm test -- src/main.test.ts -t "keeps the cached forecast for a slot"` | both cards still render `\d+°` temps; no "Unavailable" text |

Sandbox-blocked E2Es (browser/devtools/iPhone) are recorded above under
Independent Verification > UNVERIFIABLE for owner follow-up.

## Files Changed

| File | Action | Lines |
|------|--------|-------|
| `src/storage/types.ts` | CREATE | +68 |
| `src/storage/key-value-store.ts` | CREATE | +126 |
| `src/storage/forecast-cache.ts` | CREATE | +235 |
| `src/storage/forecast-cache.test.ts` | CREATE | +159 |
| `src/storage/freshness.ts` | CREATE | +50 |
| `src/storage/freshness.test.ts` | CREATE | +67 |
| `src/storage/swr.ts` | CREATE | +174 |
| `src/storage/swr.test.ts` | CREATE | +168 |
| `src/storage/index.ts` | CREATE | +21 |
| `src/main.ts` | UPDATE | +173 / -83 (net +90, hot-spot edits scoped to data-flow section only) |
| `src/main.test.ts` | UPDATE | +220 |
| `src/ui/app.ts` | UPDATE | +27 / -3 |
| `src/ui/app.test.ts` | UPDATE | +22 |
| `src/ui/styles.css` | UPDATE | +9 |

## Deviations from Plan

None substantive. Two minor adjustments during implementation:

1. The `forecast-cache.ts` boundary validator needed two distinct result types
   internally (entry-shaped vs. data-shaped) — added a `narrowFail` helper to
   keep the discriminated union strict. Pure refactor, no behavioural change.
2. In `main.test.ts`, captured the `visibilitychange` listener through a
   holder object `{ listener: null }` rather than a `let` binding because
   TypeScript narrowed the `let` to `never` across the closure boundary.

## Tests Written

| Test File | Test Cases |
|-----------|------------|
| `src/storage/forecast-cache.test.ts` | missing/malformed/invalid-shape/version-mismatch read paths; write-then-read round-trip; key derivation; distinct keys per coords; last-write-wins; `clear` |
| `src/storage/freshness.test.ts` | `isStale` boundary at threshold; NaN/Infinity/negative safety; `formatLastUpdated` covering "Just now", minutes, hours, days, non-finite, negative |
| `src/storage/swr.test.ts` | cold-offline; cold-online; warm-offline; warm-online with partial failure; corrupt-cache treated as cold; empty locations array |
| `src/ui/app.test.ts` | freshness stamp renders when label provided; absent when label missing/empty (3 new cases) |
| `src/main.test.ts` | cache-first paint offline shows stamp; cache populated after fetch; visibility-stale triggers refresh; visibility-fresh skips; per-slot refresh failure preserved (5 new cases) |
