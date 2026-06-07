# Plan: Geocoding Autocomplete for Custom Location Slots

## Summary

Build a typed Open-Meteo Geocoding client in `src/locations/` and a minimal UI widget (input + suggestions dropdown) in `src/ui/`. The client mirrors the `Result<T> = { ok: true, data } | { ok: false, error }` discriminated-union contract already in use by the forecast client (`src/weather/open-meteo-client.ts`). It hits `https://geocoding-api.open-meteo.com/v1/search` with a per-request `AbortSignal` (combined caller + ~10 s timeout) and **no retries** — stale autocomplete requests are simply cancelled by the next keystroke. The UI widget debounces input by ~300 ms, aborts any in-flight request on each new debounced query, renders suggestions with `textContent` only (XSS-safe), and surfaces the user's selection as a typed `{ name, lat, lon }` callback ready for STORY-009 (custom-slot persistence).

## User Story

As a user
I want to search any geographic location through an input that shows suggestions as I type
So that I can add travel destinations to my custom slots.

## Metadata

| Field | Value |
|-------|-------|
| Type | NEW_CAPABILITY |
| Complexity | MEDIUM |
| Systems Affected | `src/locations/` (new), `src/ui/` (small new file), `src/main.ts` (small wire-up — hotspot, single edit) |
| GitHub Issue | #8 |

---

## Patterns to Follow

### Naming (kebab-case files, PascalCase types, camelCase functions)
Same as `src/weather/`. New files:
- `src/locations/types.ts`
- `src/locations/open-meteo-geocoding-client.ts`
- `src/locations/open-meteo-geocoding-client.test.ts`
- `src/locations/debounce.ts` + `.test.ts`
- `src/locations/geocoding-autocomplete.ts` (controller — pure logic, no DOM) + `.test.ts`
- `src/ui/location-search.ts` (small DOM widget, no styles file changed)

### Discriminated typed Result — mirror `src/weather/types.ts:122-135`
```ts
// SOURCE: src/weather/types.ts:122-135
export type ForecastError =
  | { readonly kind: 'timeout' }
  | { readonly kind: 'network'; readonly message: string }
  | { readonly kind: 'http'; readonly status: number; readonly retried: boolean }
  | { readonly kind: 'parse'; readonly message: string };

export type Result<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: ForecastError };
```

For geocoding we add one more `kind`: `'aborted'` — a soft signal that the request was deliberately cancelled by the next keystroke. This is **not** an error to show in UI; the caller (controller) drops aborted results silently.

### Fetch with timeout + AbortSignal — mirror `src/weather/open-meteo-client.ts:87-202`
Reuse the same pattern (combined timeout + caller signal, classify abort cause, return typed Result, never throw across the boundary). Drop the retry loop — geocoding autocomplete must NOT retry; the technical note in #8 is explicit: "ретраи для автокомплита не нужны — устаревший запрос просто отменяется".

### Boundary validation — mirror `src/weather/open-meteo-client.ts:311-400`
Narrow the JSON payload at the API boundary; everything past `GeocodingResult` is trusted. Open-Meteo's geocoding response is `{ results?: Array<{ id, name, latitude, longitude, country?, admin1?, … }>, generationtime_ms }`. **No `results` field is a valid empty response** — surface as an empty `data` array, not an error.

### Tests — mirror `src/weather/open-meteo-client.test.ts:1-50, 56-112`
Co-located Vitest with mocked `fetchImpl`, recorded fixtures under `src/locations/__fixtures__/`, jsdom env (vitest config). Mock console at boundaries.

### DOM-safe rendering — mirror `src/main.ts:13-19` + CLAUDE.md › Security
`document.createElement` + `textContent` only. **Never** `innerHTML` for API-sourced strings (location names from Open-Meteo).

### Open-Meteo geocoding endpoint shape (verified by PRD spike 2026-06-07; sandbox blocks live re-verify — DEFER-AND-RECORD)

`GET https://geocoding-api.open-meteo.com/v1/search?name=<query>&count=5&language=en`

Sample shape (recorded from spike; CLAUDE.md spike 2026-06-07):
```json
{
  "results": [
    {
      "id": 658225,
      "name": "Helsinki",
      "latitude": 60.16952,
      "longitude": 24.93545,
      "elevation": 19.0,
      "feature_code": "PPLC",
      "country_code": "FI",
      "timezone": "Europe/Helsinki",
      "population": 558457,
      "country_id": 660013,
      "country": "Finland",
      "admin1_id": 830944,
      "admin1": "Uusimaa"
    }
  ],
  "generationtime_ms": 0.5
}
```

Empty match: `{ "generationtime_ms": 0.4 }` — no `results` key. **This is success with zero suggestions, not an error.**

---

## Files to Change

| File | Action | Purpose |
|------|--------|---------|
| `src/locations/types.ts` | CREATE | Domain types: `GeocodingResult`, `LocationSelection`, `GeocodingError`, `GeocodingFetchResult` |
| `src/locations/open-meteo-geocoding-client.ts` | CREATE | Typed `searchLocations(query, opts)` — timeout, abort, validate, no retry |
| `src/locations/__fixtures__/geocoding-helsinki.json` | CREATE | Recorded sample response (3+ results) |
| `src/locations/__fixtures__/geocoding-empty.json` | CREATE | Recorded empty response (no `results` key) |
| `src/locations/open-meteo-geocoding-client.test.ts` | CREATE | Unit tests for client (success, empty, abort, timeout, 4xx, 5xx, parse error, network error) |
| `src/locations/debounce.ts` | CREATE | Generic typed `debounce(fn, ms)` |
| `src/locations/debounce.test.ts` | CREATE | Unit tests using `vi.useFakeTimers()` |
| `src/locations/geocoding-autocomplete.ts` | CREATE | DOM-free controller: takes query stream + selection callback, debounces, aborts in-flight, emits state events (`idle`/`loading`/`results`/`empty`/`offline`/`error`) |
| `src/locations/geocoding-autocomplete.test.ts` | CREATE | Unit tests for controller (debounce, abort, empty, offline, state transitions, selection callback shape) |
| `src/ui/location-search.ts` | CREATE | Minimal DOM widget — input + suggestions list; wires the controller; renders with `textContent` |
| `src/ui/location-search.test.ts` | CREATE | jsdom test — input typing, dropdown rendering, no `innerHTML` for API strings, selection emits `{name, lat, lon}` |
| `src/main.ts` | UPDATE | Mount `location-search` widget under existing scaffold heading (additive only; STORY-002 owns the rest of the UI) |

### Verification of references in the existing codebase

- `src/weather/types.ts` exists and contains `Result<T>`/`ForecastError` — used as the mirror.
- `src/weather/open-meteo-client.ts` exports `fetchForecast` with `combineSignals`/`classifyFetchError`/`narrowForecastResponse` helpers — mirrored, not imported (geocoding is its own boundary).
- `src/main.ts` is currently scaffold-only (lines 1-20); STORY-002 may also touch it concurrently — the edit here is one append (`app.append(...searchWidget)`) localized and non-conflicting at the line level.
- `vite.config.ts` already sets `environment: 'jsdom'` and `include: ['src/**/*.test.ts']` — new test files are picked up automatically.

---

## Risks

| Risk | Mitigation |
|------|------------|
| Outbound HTTP is blocked in this sandbox; cannot live-verify the endpoint | Use the recorded shape from the PRD's 2026-06-07 spike; DEFER-AND-RECORD a re-verify step that the owner can run with `curl` post-merge. Fixtures use that shape verbatim. |
| `vi.useFakeTimers()` interactions with `AbortSignal.timeout` are tricky | Tests use injected `setTimeoutImpl` + mocked `fetchImpl` (same pattern as `open-meteo-client.test.ts`'s injected `sleep`) so no real time passes and no fake-timer/native-timer cross-over. |
| Concurrent edit of `src/main.ts` by STORY-002 (hotspot) | Keep the edit to a single `append` after the existing `note` element; STORY-002's work is the cards/grid, which is independent. If a real conflict appears at merge, the owner resolves. |
| The other worktree owns `src/ui/` styles — adding a styles file risks conflict | Do not add a global styles file. The widget gets only the minimal inline-style attributes needed for functional rendering; visual polish is the other story's domain. |
| WMO-search results may carry HTML-looking strings (e.g. apostrophes, accents) | Render via `textContent` only (project rule). Tests assert `innerHTML` of the rendered name equals the escaped text. |

---

## Environment & Verification

| Verification | Runs in env? | If blocked: where/when verified |
|--------------|--------------|---------------------------------|
| `npm run lint` | yes | — |
| `npx tsc --noEmit` (via `npm run build`'s first step; standalone too) | yes | — |
| `npm test` (Vitest) | yes | — |
| Live Open-Meteo geocoding call (re-verify endpoint) | **no** (sandbox blocks outbound HTTP) | DEFER-AND-RECORD per CLAUDE.md › Validate Before Implementing — recorded fixtures captured from the PRD-documented spike. Owner can re-verify with `curl 'https://geocoding-api.open-meteo.com/v1/search?name=Helsinki&count=5&language=en'` post-merge. |
| Real iPhone PWA / install / airplane-mode test | no (sandbox) | DEFER-AND-RECORD — CLAUDE.md › Sandbox-blocked checks. |

---

## Tasks

Execute in order. Each task is atomic and verifiable.

### Task 1: Geocoding domain types

- **File**: `src/locations/types.ts`
- **Action**: CREATE
- **Implement**:
  - `LocationSelection`: `{ readonly name: string; readonly lat: number; readonly lon: number }` (the STORY-009 hand-off shape — the AC6 contract).
  - `GeocodingResult`: full row from Open-Meteo: `name`, `latitude`, `longitude`, optional `country`, `admin1`, `country_code`, `id`, `population`, `feature_code`, `timezone`, `elevation`.
  - `GeocodingError` union: `'timeout' | 'network' | 'http' | 'parse' | 'aborted'` (extra discriminator vs `ForecastError`; semantics: `aborted` is a soft signal the next keystroke cancelled us — controller drops it silently and does NOT show an error).
  - `GeocodingResponse`: `{ readonly results: readonly GeocodingResult[] }` (empty-results case: `results: []` after narrowing).
  - `GeocodingFetchResult` = `Result<GeocodingResponse>` discriminated by `ok`.
  - `toSelection(result: GeocodingResult): LocationSelection` — narrows row → hand-off shape.
- **Mirror**: `src/weather/types.ts:122-135` for Result/Error pattern
- **Validate**: `npx tsc --noEmit`

### Task 2: Geocoding client (typed fetch, timeout, abort, NO retry)

- **File**: `src/locations/open-meteo-geocoding-client.ts`
- **Action**: CREATE
- **Implement**:
  - Endpoint constant: `https://geocoding-api.open-meteo.com/v1/search`.
  - Default per-request timeout: 10_000 ms (mirror weather client).
  - `searchLocations(query: string, opts?: { signal?: AbortSignal; timeoutMs?: number; fetchImpl?: typeof fetch; count?: number; language?: string }): Promise<GeocodingFetchResult>`.
  - Behaviour:
    1. Trim query; if length < 2 → return `{ ok: true, data: { results: [] } }` without fetching (AC1: ≥2 chars).
    2. Build URL with `name`, `count` (default 5), `language` (default `en`), and `format=json`.
    3. Combine caller's `signal` with `AbortSignal.timeout(timeoutMs)` via `AbortSignal.any` (same helper pattern as weather client).
    4. Call `fetchImpl(url, { signal })`. Classify errors:
       - caller-abort → return `{ ok: false, error: { kind: 'aborted' } }` (NOT an error to surface in UI).
       - timeout (per-request signal aborted with `TimeoutError`) → return `{ ok: false, error: { kind: 'timeout' } }`.
       - other network error → `{ kind: 'network', message }`.
    5. On `response.ok === false`: return `{ kind: 'http', status, retried: false }` (no retries for geocoding).
    6. Parse JSON. If body is `{ generationtime_ms: ... }` (no `results` key), normalise to `{ results: [] }`. Otherwise validate every row has finite `name` (string), `latitude` (finite number), `longitude` (finite number). Reject malformed rows by dropping the whole response with a `parse` error.
  - Console logs at boundaries (`info` on start, `warn` on caller-abort/timeout, `error` on `http`/`parse`), same style as weather client. Context tag: `[geocoding] q="<query>"`.
- **Mirror**: `src/weather/open-meteo-client.ts:87-202, 311-400`
- **Validate**: `npx tsc --noEmit`

### Task 3: Recorded geocoding fixtures (DEFER-AND-RECORD)

- **Files**:
  - `src/locations/__fixtures__/geocoding-helsinki.json` — `{ results: [Helsinki FI, Helsinki ND USA, Helsinki MN USA], generationtime_ms: 0.5 }`. Field set matches the PRD spike shape exactly.
  - `src/locations/__fixtures__/geocoding-empty.json` — `{ generationtime_ms: 0.4 }` (no `results` key — the documented empty-match case).
- **Action**: CREATE
- **Implement**: hand-curated JSON, structurally identical to what Open-Meteo returned during the 2026-06-07 spike. Fixtures are documentation as much as test data.
- **Validate**: tests in Task 4 reading them pass.

### Task 4: Geocoding client tests

- **File**: `src/locations/open-meteo-geocoding-client.test.ts`
- **Action**: CREATE
- **Implement** — each test uses mocked `fetchImpl` and the fixtures (no real network):
  1. **Happy path**: query "Helsinki" → URL has correct params (`name`, `count=5`, `language=en`), result is `ok: true` with 3 results, `data.results[0].name === 'Helsinki'`, types are correct.
  2. **Short query**: query "H" → returns `ok: true, data.results: []` and **does not call `fetchImpl`**.
  3. **Empty response** (no `results` key): returns `ok: true, data.results: []` (not an error).
  4. **Caller abort**: caller aborts mid-request → returns `ok: false, error.kind: 'aborted'`. No retries.
  5. **Timeout**: very small `timeoutMs` + a fetchImpl that never resolves → returns `ok: false, error.kind: 'timeout'`. Called once (no retry).
  6. **HTTP 4xx**: returns `ok: false, error.kind: 'http', status: 400, retried: false`.
  7. **HTTP 5xx**: returns `ok: false, error.kind: 'http', status: 503, retried: false` (NO retry — that's the geocoding contract; differs from forecast).
  8. **Parse error**: `{ results: [{ name: 'X' /* no lat/lon */ }] }` → returns `ok: false, error.kind: 'parse'`.
  9. **Network error** (fetch throws `TypeError`): returns `ok: false, error.kind: 'network'`, single call (no retry).
  10. **Query trim**: leading/trailing whitespace doesn't bypass the 2-char floor; the URL `name` param is the trimmed query.
- **Mirror**: `src/weather/open-meteo-client.test.ts:1-50, 56-112` for shape + helpers
- **Validate**: `npm test`

### Task 5: Generic debounce helper

- **File**: `src/locations/debounce.ts`
- **Action**: CREATE
- **Implement**:
  - `debounce<TArgs extends readonly unknown[]>(fn: (...args: TArgs) => void, ms: number): { call: (...args: TArgs) => void; cancel: () => void }`.
  - Uses `setTimeout` / `clearTimeout`. The returned object also exposes `flush()` if needed by tests (deferred — only add if a test demands it).
- **Validate**: `npx tsc --noEmit`

### Task 6: Debounce tests

- **File**: `src/locations/debounce.test.ts`
- **Action**: CREATE
- **Implement** using `vi.useFakeTimers()`:
  1. Calling once then advancing < ms → fn not called.
  2. Calling once then advancing ≥ ms → fn called once with the last args.
  3. Calling repeatedly resets the timer; fn called once with the *latest* args after ms quiet period.
  4. `cancel()` prevents the pending call.
- **Validate**: `npm test`

### Task 7: Autocomplete controller (DOM-free)

- **File**: `src/locations/geocoding-autocomplete.ts`
- **Action**: CREATE
- **Implement**:
  - `createGeocodingAutocomplete(opts: { search?: typeof searchLocations; debounceMs?: number; onState: (state: AutocompleteState) => void; onSelect: (selection: LocationSelection) => void; isOnline?: () => boolean; }): { query: (q: string) => void; select: (result: GeocodingResult) => void; destroy: () => void }`.
  - Behaviour:
    - `query("")` → emit `{ kind: 'idle' }`, cancel any pending debounced call, abort any in-flight fetch.
    - `query("ab")` (≥2 chars) → emit `{ kind: 'loading' }` after debounce, then call `search(q, { signal })`. On result:
      - `aborted` → drop silently (no state change).
      - `ok && data.results.length === 0` → `{ kind: 'empty' }`.
      - `ok && data.results.length > 0` → `{ kind: 'results', results }`.
      - `!ok && kind === 'network'` + `isOnline()` returns false → `{ kind: 'offline' }`. Otherwise `{ kind: 'error' }`.
      - `timeout` or `http` or `parse` → `{ kind: 'error' }` (no internal details exposed; CLAUDE.md security).
    - `select(result)` → call `onSelect(toSelection(result))`. Controller is stateless about selection — pure forwarder.
    - `destroy()` → cancel debounce + abort in-flight; null out callbacks.
  - Uses `navigator.onLine` (via injectable `isOnline`) only when classifying network errors — never trusts it for the happy path (CLAUDE.md notes: navigator.onLine is unreliable; treat it as a hint).
- **Mirror**: shape of `src/weather/open-meteo-client.ts`'s injectable `fetchImpl`/`sleep` pattern.
- **Validate**: `npx tsc --noEmit`

### Task 8: Autocomplete controller tests

- **File**: `src/locations/geocoding-autocomplete.test.ts`
- **Action**: CREATE
- **Implement** with `vi.useFakeTimers()` and a stub `search`:
  1. **Debounce**: 3 quick `query()` calls with `debounceMs=300` → `search` called once, with last query, after 300ms.
  2. **State sequence on hit**: `idle` → (debounce) → `loading` → `results`.
  3. **Empty results**: → `empty`.
  4. **Offline**: `search` returns `{ kind: 'network' }` and `isOnline() === false` → state `offline`.
  5. **Other error**: `search` returns `{ kind: 'timeout' }` → state `error`.
  6. **Aborted in-flight on new query**: typing two queries in succession (after debounce) → only the second result lands; first's signal was aborted. Verify by inspecting the abort signals captured.
  7. **`query('')` resets**: state goes to `idle`, no in-flight fetch.
  8. **`select(result)` invokes `onSelect` with `{ name, lat, lon }`** — exactly that shape, no extra fields.
  9. **`destroy()`** stops further callbacks (idempotent).
- **Validate**: `npm test`

### Task 9: DOM widget (minimal, jsdom-testable)

- **File**: `src/ui/location-search.ts`
- **Action**: CREATE
- **Implement**:
  - `createLocationSearchWidget(opts: { onSelect: (s: LocationSelection) => void; search?: typeof searchLocations; debounceMs?: number }): { element: HTMLElement; destroy: () => void }`.
  - DOM:
    - A `<div class="location-search">` containing:
      - An `<input type="search" placeholder="Search for a location" autocomplete="off" inputmode="search" />`.
      - A status `<div class="location-search__status" role="status" aria-live="polite">` (used for "No results" / "Search needs a connection" / "Something went wrong").
      - A `<ul class="location-search__suggestions" role="listbox">`.
  - Rendering rules:
    - Each suggestion is an `<li role="option">` with **`textContent`** built from `name` + ", " + `admin1`/`country` parts (skipping any undefined parts).
    - **NEVER `innerHTML`** for API-sourced strings.
    - Status text is statically defined in the widget; API error strings are never shown to the user.
  - Wiring: input `'input'` listener → `controller.query(value)`. Click/Enter on a suggestion → `controller.select(result)` → invokes the widget's `onSelect`.
  - Cleanup: `destroy()` removes listeners and disposes the controller.
- **Mirror**: `src/main.ts:13-19` for DOM creation style.
- **Validate**: `npx tsc --noEmit`

### Task 10: Widget tests (jsdom)

- **File**: `src/ui/location-search.test.ts`
- **Action**: CREATE
- **Implement** using `vi.useFakeTimers()` and a stub `search`:
  1. **Typing ≥2 chars triggers a search after debounce**; suggestions appear in the listbox.
  2. **Suggestion text uses `textContent`**: render a result whose `name` is `<img onerror=...>` and assert the `<li>` has that exact text (`textContent === '<img onerror=...>'`) but its `innerHTML` is the *escaped* form (no real `<img>` tag exists in the DOM).
  3. **No results** → status text reads "No results". Suggestions list empty.
  4. **Offline** → status text reads "Search needs a connection".
  5. **Other error** → status text reads "Something went wrong" (no internal detail, no API field leaked).
  6. **Click on a suggestion** invokes the widget's `onSelect` with a `{ name, lat, lon }` object — exactly those keys, taken from the chosen result.
  7. **Clearing the input** clears the suggestions list and status.
  8. **`destroy()`** detaches listeners (further input events do not call `search`).
- **Validate**: `npm test`

### Task 11: Wire widget into `src/main.ts` (hotspot — single small edit)

- **File**: `src/main.ts`
- **Action**: UPDATE
- **Implement**: After the existing `app.append(heading, note)` line, append the search widget:
  ```ts
  const search = createLocationSearchWidget({
    onSelect: (selection) => {
      // STORY-009 will persist this. For now: console log + visible echo for demo.
      // eslint-disable-next-line no-console
      console.info('[main] location selected', selection);
    },
  });
  app.append(search.element);
  ```
- **Mirror**: existing top-of-file scaffold style — wiring only, no logic.
- **Validate**: `npx tsc --noEmit && npm run lint && npm test`

### Task 12: Full validation pass

- **Files**: none new.
- **Action**: run the project's full validation suite.
- **Validate**:
  ```bash
  npm run lint
  npx tsc --noEmit
  npm test
  ```
  All must exit 0. Capture key lines from each for the report's Evidence section.

---

## Validation

```bash
npm run lint
npx tsc --noEmit
npm test
```

All three commands exit 0. The build script `npm run build` chains `tsc --noEmit && vite build`; we do not run the full Vite build because PWA wiring is owned by Phase 3 (STORY-006) and `vite build` would be redundant in this sandbox.

---

## End-to-End Verification (in-sandbox)

| # | Test | Action | Expected |
|---|------|--------|----------|
| E1 | Typing ≥2 chars surfaces results | Widget test #1 + manual run via `npm test` | Suggestions render, taken from mocked fixture data |
| E2 | Debounce + abort | Controller test #1 + #6 | `search` called once after 300ms quiet; previous AbortSignal aborted on new query |
| E3 | XSS-safe rendering | Widget test #2 | Suggestion `<li>` has `textContent` of the raw string and no parsed HTML |
| E4 | Offline state | Widget test #4 | Status text reads "Search needs a connection" |
| E5 | Empty results state | Widget test #3 | Status text reads "No results" |
| E6 | Selection emits `{name,lat,lon}` | Widget test #6 | `onSelect` callback receives exactly `{ name, lat, lon }` |
| E7 (DEFER) | Live Open-Meteo geocoding call | `curl https://geocoding-api.open-meteo.com/v1/search?name=Helsinki&count=5&language=en` | Sandbox blocks; owner re-verifies post-merge per CLAUDE.md › Validate Before Implementing. Fixtures match the 2026-06-07 spike shape verbatim. |

---

## Acceptance Criteria (from issue #8)

- [ ] **AC1** Given input, when typing ≥2 chars, then suggestions (name, country, region) appear under the input from Open-Meteo Geocoding API → covered by client tests (4.1, 4.2) + widget test 10.1.
- [ ] **AC2** Given fast typing, when typing, then requests are debounced (~300 ms) and in-flight request is aborted on new input (`AbortController`) → controller tests 8.1 + 8.6.
- [ ] **AC3** Given empty result, when searching nonexistent place, then "No results" (no hang/error) → client test 4.3, widget test 10.3.
- [ ] **AC4** Given no network, when searching, then "Search needs a connection", rest of app keeps working → controller test 8.4, widget test 10.4. App isolation = the widget is additive in `main.ts`; failure paths return typed Results, never throw.
- [ ] **AC5** Given suggestions, then names are rendered as text (`textContent`), not HTML → widget test 10.2.
- [ ] **AC6** Given selection, then a typed `{name, lat, lon}` is emitted, ready for STORY-009 → widget test 10.6, controller test 8.8.
- [ ] All tasks completed
- [ ] Type check passes
- [ ] Lint passes
- [ ] Tests pass
- [ ] Environment-blocked verifications recorded (E7) per defer-and-record.

---

## Deviations Tracker (filled by /implement)

(populated during execution if needed)
