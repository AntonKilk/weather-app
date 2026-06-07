# Implementation Report

**Plan**: `.agents/plans/geocoding-autocomplete.plan.md`
**Branch**: `claude/issue-8-geocoding-autocomplete`
**Status**: COMPLETE

## Summary

Implemented the Open-Meteo geocoding autocomplete (issue #8). New code lives under `src/locations/` (typed client + debounce + DOM-free controller) and a minimal widget under `src/ui/location-search.ts`. The widget is wired into `src/main.ts` so the owner can demo the search box immediately; selecting a suggestion logs and displays `{name, lat, lon}` — the typed hand-off that STORY-009 will consume.

Design highlights:

- Mirrors the `Result<T> = { ok: true, data } | { ok: false, error }` contract from `src/weather/types.ts`. Geocoding adds a soft `aborted` error kind to model "the next keystroke cancelled this".
- Geocoding **does not retry** — that is the story's explicit contract (stale requests are aborted, not retried).
- Debounce is 300 ms; every new debounced query aborts the previous in-flight fetch via `AbortController`.
- Suggestion strings (name, country, admin1) are rendered with `textContent` only — XSS-safe by construction. UI error copy is a fixed local string set; no API/network error text is ever surfaced to the user.

## Tasks Completed

| # | Task | File | Status |
|---|------|------|--------|
| 1 | Domain types (LocationSelection, GeocodingResult, GeocodingResponse, GeocodingError, Result, AutocompleteState, toSelection) | `src/locations/types.ts` | done |
| 2 | Typed geocoding client (`searchLocations`) — timeout, abort, no retry, 2-char floor, narrow | `src/locations/open-meteo-geocoding-client.ts` | done |
| 3 | Recorded fixtures (Helsinki + empty) | `src/locations/__fixtures__/*.json` | done |
| 4 | Geocoding client tests (16 tests across happy path, short query, empty response, abort, timeout, HTTP 4xx/5xx, parse, network) | `src/locations/open-meteo-geocoding-client.test.ts` | done |
| 5 | Generic `debounce` helper | `src/locations/debounce.ts` | done |
| 6 | Debounce tests | `src/locations/debounce.test.ts` | done |
| 7 | Autocomplete controller (DOM-free; debounce + abort + state stream) | `src/locations/geocoding-autocomplete.ts` | done |
| 8 | Controller tests (17 tests: debounce, state sequences, offline/error classification, abort-on-new-query, select, destroy) | `src/locations/geocoding-autocomplete.test.ts` | done |
| 9 | DOM widget (input + status + suggestions, textContent-only) | `src/ui/location-search.ts` | done |
| 10 | Widget tests (8 tests incl. XSS/textContent + selection shape) | `src/ui/location-search.test.ts` | done |
| 11 | Wire widget into `src/main.ts` (additive, minimal hotspot edit) | `src/main.ts` | done |
| 12 | Full validation (lint + tsc + tests) | — | done |

## Validation Evidence

| Check | Command | Result |
|-------|---------|--------|
| Lint | `npm run lint` | exit 0 — no findings |
| Type check | `npx tsc --noEmit` | exit 0 — clean |
| Tests | `npm test` | exit 0 — 6 test files, 67 tests passed |

Key tail of `npm test`:

```
 Test Files  6 passed (6)
      Tests  67 passed (67)
   Duration  1.98s
```

## Independent Verification

**Verdict**: CONFIRMED (round 1 of max 3; performed inline because the Task/Agent dispatch tool is not available in this worktree)

EVIDENCE (commands re-run from a clean state):
- `npm run lint` → exit 0
- `npx tsc --noEmit` → exit 0
- `npm test` → exit 0; 67 tests in 6 files passed
- `git diff --cached --stat` shows 14 files matching the plan's CREATE/UPDATE list
- Each of acceptance criteria AC1–AC6 maps to at least one passing test:
  - AC1 (≥2 chars) → client tests "short query" group + widget test "typing triggers search"
  - AC2 (300 ms debounce + AbortController) → controller test "debounce" + "abort in-flight on new query"
  - AC3 (No results) → widget test "empty results"
  - AC4 (Search needs a connection) → widget test "offline state"
  - AC5 (textContent only) → widget test "textContent only (AC5)" — uses a malicious row with `<img onerror=...>`, `<script>`, `<b>` and verifies none of those tags exist in the DOM and `innerHTML` shows the escaped form
  - AC6 (`{name, lat, lon}` shape) → controller test "select" + widget test "selection callback" both assert `Object.keys(sel).sort() === ['lat','lon','name']`

UNVERIFIABLE:
- Live `curl https://geocoding-api.open-meteo.com/v1/search?...` — sandbox blocks outbound HTTP (host not in allowlist). Per CLAUDE.md › Validate Before Implementing › defer-and-record, the fixtures used are structurally identical to the PRD-recorded spike of 2026-06-07. Owner can re-verify post-merge.
- Real-iPhone PWA / airplane-mode test — out of scope (PWA wiring is Phase 3 / STORY-006) and listed as a sandbox-blocked defer-and-record check.

## E2E Evidence

| Test | Action performed | Observed result |
|------|------------------|-----------------|
| E1 ≥2 chars surface suggestions | Widget test simulates `input` event with `'Hel'` + advance 300 ms timers | Two `<li role="option">` items render; `.location-search__suggestion-name` text = `'Helsinki'`, region text = `'Uusimaa, Finland'` |
| E2 Debounce + abort | Two `query()` calls (`Helsinki`, then `Tallinn`) while first fetch hangs | Search called twice with the LAST args; first AbortSignal observed as `aborted=true`; final emitted state is the second call's result (stale-seq guard drops the late first response) |
| E3 XSS-safe rendering | Suggestion row with `name='<img src=x onerror=…>'`, region with `<script>` and `<b>` | `textContent` preserves the raw string; `widget.element.querySelector('img'/'script'/'b')` all return `null`; `innerHTML` contains `&lt;img` (escaped) |
| E4 Offline state | Search returns `{ ok: false, error: 'network' }` with `isOnline=() => false` | Status text = `'Search needs a connection'`; suggestion list empty |
| E5 Empty results | Search returns `{ ok: true, data: { results: [] } }` | Status text = `'No results'`; suggestion list empty |
| E6 Selection emits `{name,lat,lon}` | Click second suggestion in a 2-row list | `onSelect` called once with `Object.keys() === ['lat','lon','name']`, name `'Tallinn'`, lat `≈ 59.43696`, lon `≈ 24.75353` |
| E7 (DEFER) Live Open-Meteo call | `curl https://geocoding-api.open-meteo.com/v1/search?name=Helsinki&count=5&language=en` | Sandbox blocks outbound HTTP. Defer-and-record per CLAUDE.md. |

## Files Changed

| File | Action | Lines |
|------|--------|-------|
| `.agents/plans/geocoding-autocomplete.plan.md` | CREATE | +379 |
| `src/locations/types.ts` | CREATE | +129 |
| `src/locations/open-meteo-geocoding-client.ts` | CREATE | +315 |
| `src/locations/open-meteo-geocoding-client.test.ts` | CREATE | +343 |
| `src/locations/__fixtures__/geocoding-helsinki.json` | CREATE | +54 |
| `src/locations/__fixtures__/geocoding-empty.json` | CREATE | +3 |
| `src/locations/debounce.ts` | CREATE | +75 |
| `src/locations/debounce.test.ts` | CREATE | +110 |
| `src/locations/geocoding-autocomplete.ts` | CREATE | +217 |
| `src/locations/geocoding-autocomplete.test.ts` | CREATE | +380 |
| `src/ui/location-search.ts` | CREATE | +209 |
| `src/ui/location-search.test.ts` | CREATE | +279 |
| `src/main.ts` | UPDATE | +18/-1 |
| `src/locations/.gitkeep` | DELETE | -1 |
| `src/ui/.gitkeep` | DELETE | -1 |

## Deviations from Plan

None of substance.

- Tests grew slightly beyond the count specified in the plan (16 client tests vs the 10 listed) because additional small assertions made the contracts easier to verify (e.g. URL trim, count/language overrides, body-not-object parse error). No tests were removed or weakened.
- The independent verifier was run **inline** (commands re-executed from a clean prompt) because no `Agent`/`Task` dispatch tool is available in this worktree. The check itself is the same — re-run lint + tsc + tests; inspect diff vs plan; map ACs to tests. Verdict: CONFIRMED.

## Tests Written

| Test File | Test Cases |
|-----------|------------|
| `src/locations/open-meteo-geocoding-client.test.ts` | happy path + URL params; count/language overrides; short query → no fetch (3 variants); empty response (no `results` key); caller abort → `aborted`; timeout (single attempt); HTTP 400 retried=false; HTTP 503 retried=false (NO retry); parse missing latitude; parse missing name; parse `results` not array; parse body-not-object; network error → single call |
| `src/locations/debounce.test.ts` | no fire before ms; fires once after ms with last args; coalesces 3 rapid calls into one; `cancel()` prevents pending; `cancel()` is idempotent; multi-cycle; multi-argument signature |
| `src/locations/geocoding-autocomplete.test.ts` | debounce coalescing; happy-path state sequence; empty state; offline classification; error classification (network when online; timeout; http); `aborted` is silent; abort-on-new-query (signal flips to aborted; stale-seq guard); `query('')` → idle, no fetch; 1-char → idle, no fetch; `select(row)` shape; `destroy()` cancels debounce; `destroy()` idempotent; post-destroy `select()` no-op; post-destroy `query()` no-op; search throws → error |
| `src/ui/location-search.test.ts` | ≥2 chars triggers search after debounce; AC5 XSS-safe rendering (img/script/b never parsed); AC3 No results; AC4 offline state; generic error copy; AC6 selection shape on click; clearing input resets; `destroy()` detaches input listener |

## Sandbox-blocked / Defer-and-record

- **Live Open-Meteo geocoding call**: blocked by sandbox host allowlist. Recorded fixtures are structurally identical to the PRD's 2026-06-07 spike. Owner can re-verify with `curl 'https://geocoding-api.open-meteo.com/v1/search?name=Helsinki&count=5&language=en'` post-merge.
- **Real-iPhone PWA / airplane-mode test**: out of scope for this story (PWA wiring is STORY-006) and listed as sandbox-blocked in CLAUDE.md.
