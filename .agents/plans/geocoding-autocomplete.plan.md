# Plan: Geocoding autocomplete for location search

## Summary

Add the geocoding boundary and a tiny vanilla-DOM autocomplete component that
Phase 4 has been waiting for: a pure-function client `searchGeocoding(query,
deps?)` in `src/locations/geocoding-client.ts` that hits Open-Meteo's
`https://geocoding-api.open-meteo.com/v1/search` with `name`, `count=5`,
`language=en` under a ~10 s `AbortSignal.timeout`, accepts an external
`AbortSignal` from the caller so stale in-flight requests are cancelled on each
keystroke (no retries — staleness is solved by cancellation, not by waiting),
validates the response shape at the boundary, and returns a discriminated-union
`GeocodingResult` with a dedicated `aborted` kind that the UI can silently
discard. A new `renderSearchInput` component in `src/ui/search-input.ts` debounces
input ~300 ms, runs the search, renders suggestions as text (`textContent`
only — CLAUDE.md › Security), surfaces `No results` / `Search needs a connection`
/ generic-error states, and fires an `onSelect` callback with the typed
`{ name, latitude, longitude, country?, admin1? }` object that STORY-009 will
wire to the custom-slot list. STORY-008 ships the input, hooks it into
`main.ts` above the locations grid with a demo `onSelect` that just clears the
input (and `console.info`s the selection at the boundary, per CLAUDE.md ›
Observability); STORY-009 owns the slot-mgmt logic on top.

## User Story

As a user, I want a search input with live suggestions on every keystroke, so I
can find any geographic location to add to a travel slot.

## Metadata

| Field | Value |
|-------|-------|
| Type | NEW_CAPABILITY |
| Complexity | MEDIUM |
| GitHub Issue | #8 (STORY-008) |
| PRD | `.agents/PRDs/offline-weather-pwa.prd.md` (Phase 4 — Custom slots) |
| Stories | `.agents/stories/offline-weather-pwa.stories.md` → STORY-008 |
| Branch | `claude/lucid-darwin-qn0qgi` (per session instructions) |
| Blocked by | STORY-004 (merged: `src/weather/open-meteo-client.ts`) |
| Blocks | STORY-009 (custom slots add/remove/persist) |

---

## Patterns to follow

| Category | File:lines | Pattern |
|----------|-----------|---------|
| LAYERING | `CLAUDE.md` › Architecture | Geocoding client lives in `src/locations/` (peer domain to `weather/`). Never imports from `weather/`, `ui/`, or `storage/`. Re-uses its own discriminated-union result type — does NOT cross-import `FetchResult` from `weather/types.ts`. |
| NAMING | `CLAUDE.md` › Code Patterns | Files kebab-case (`geocoding-client.ts`, `search-input.ts`); types PascalCase (`GeocodingPlace`, `GeocodingResult`, `GeocodingError`); functions/vars camelCase (`searchGeocoding`, `buildGeocodingUrl`, `parseGeocoding`, `renderSearchInput`). Domain-first naming: not `ApiHelper` / `Autocomplete`. |
| RESULT TYPE | `src/weather/open-meteo-client.ts:17-23, 64-73` (its `FetchResult` from `weather/types`) | Mirror the discriminated-union shape exactly: `{ ok: true; data } \| { ok: false; error }`. Geocoding adds one kind the forecast client doesn't need: `aborted` (external `AbortController.abort()` from the next keystroke). The UI treats `aborted` as a silent no-op, not an error. |
| NETWORK CLIENT | `src/weather/open-meteo-client.ts:52-133` | Pure async function with `ClientDeps` injection (`fetchImpl`, `timeoutMs`), `AbortSignal.timeout` per call, classify thrown errors via a `classifyThrown` helper, boundary-validate response with `parseGeocoding(unknown): GeocodingResult`. **Key delta**: NO retry loop. Per the issue's Technical Notes: "ретраи для автокомплита не нужны — устаревший запрос просто отменяется". |
| PARSING | `src/weather/open-meteo-client.ts:143-296`, `src/locations/default-locations.ts:21-125` | Narrow `unknown` → typed array at the boundary. Reject if `results` is missing/not array, or any entry lacks `name`/`latitude`/`longitude` of the right primitive type. `country` and `admin1` are OPTIONAL (Open-Meteo omits them for some hits) — `string \| undefined`, never narrowed to `null`. Empty `results` is a SUCCESS (`{ ok: true, data: [] }`), not a parse error — AC3. |
| ERRORS | `CLAUDE.md` › Error handling, Fault Tolerance | Timeouts via `AbortSignal.timeout(10_000)`. Distinguish `aborted` (external abort, e.g. new keystroke) from `timeout` (our own timer fired) by inspecting `signal.aborted` and `err.name` (`'AbortError'` when the external signal aborted; `'TimeoutError'` when `AbortSignal.timeout` fired). UI never shows raw error messages — friendly states only (CLAUDE.md › Error handling). Console-log at boundaries with the query as context. |
| INPUT VALIDATION | `CLAUDE.md` › Security | Sanitize the search query: trim, drop control chars (or, simpler and safer: pass only via `URLSearchParams` which percent-encodes everything). Min length ≥ 2 chars (per AC1); shorter → silent no-op, no request fired. Render any API-returned string via `textContent` — never `innerHTML`. |
| DOM EVENTS | `src/ui/home-screen.ts:82-106` | Single delegated `click` listener on the suggestions container — derive the chosen index from `dataset.optionIndex`. Same delegation idea for `keydown` if/when keyboard nav is added (out of scope for this story; click + tap is enough for the iPhone target). |
| DOM CONSTRUCTION | `src/ui/location-card.ts:14-62`, `src/ui/footer.ts:5-18` | Build with `document.createElement` + `textContent`. No template strings. No innerHTML. CSS classes BEM-style: `.search-input`, `.search-input__field`, `.search-input__list`, `.search-input__option`, `.search-input__status`. |
| OBSERVABILITY | `CLAUDE.md` › Observability, `src/main.ts:31-33` | `console.warn`/`console.info` at boundaries only, prefixed `[geocoding]`. No analytics. The input's status text (`Searching…`, `No results`, `Search needs a connection`) is the primary user-facing health signal. |
| TESTS | `src/weather/open-meteo-client.test.ts:1-100`, `src/ui/home-screen.test.ts:1-60`, `src/locations/default-locations.test.ts:1-185` | Vitest, NO globals: `import { afterEach, describe, expect, it, vi } from 'vitest'`. Co-locate `*.test.ts`. Mock `fetch` via `vi.fn<typeof fetch>(...)` passed in `deps.fetchImpl` (preferred — keeps tests free of `vi.spyOn(globalThis, …)`). For UI tests, mount into `document.body`, use `afterEach(() => document.body.replaceChildren())` to clean up. Use `vi.useFakeTimers()` + `await vi.advanceTimersByTimeAsync(300)` to test the debounce — fake timers ARE safe here because we inject `fetchImpl` and don't rely on the real `AbortSignal.timeout` firing. |

(Where rows reference a single file: that is the canonical example to mirror.)

---

## Endpoint contract (PRD spike 2026-06-07, re-verify in Task 1)

URL:

```
https://geocoding-api.open-meteo.com/v1/search
  ?name={query}
  &count=5
  &language=en
```

Confirmed by the PRD spike:
- Returns finds for short names (e.g. Käsmu, pop. 112) — responds from 2 characters.
- **Known weakness**: fuzzy match is weak on short prefixes (`Käs` does NOT
  surface Käsmu in top 5; needs ~4+ chars). UI just shows what the API returns —
  no promises, no client-side reranking.
- No API key, no auth header.
- Response shape (only the fields we use; the API returns more we ignore):

```jsonc
{
  "results": [
    {
      "name": "Helsinki",            // required, string
      "latitude": 60.16952,          // required, number
      "longitude": 24.93545,         // required, number
      "country": "Finland",          // OPTIONAL — string when present
      "admin1": "Uusimaa"            // OPTIONAL region — string when present
      // ... other fields ignored: id, elevation, country_code, timezone, …
    }
  ],
  "generationtime_ms": 0.42
}
```

If `name` returns no matches, the API typically responds with `{ "generationtime_ms": 0.42 }` (no `results` key). The parser MUST treat a missing `results` key as `{ ok: true, data: [] }` — that is the "No results" case (AC3), not a parse error.

**Per CLAUDE.md › Validate Before Implementing**: Task 1 below is to hit this URL live ONCE for two queries (one with hits, one without) and record both into the fixture file. Do not write client logic before this step. If the sandbox blocks outbound network, defer-and-record per CLAUDE.md and use a synthetic fixture (the `satisfies` type check is the actual contract).

---

## Public API (the only exports)

```ts
// src/locations/types.ts — EXTEND (do not break existing LocationSlot)

export interface GeocodingPlace {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;   // Open-Meteo omits for some hits
  admin1?: string;    // first-level admin region (state/oblast/region)
}

// src/locations/geocoding-client.ts — NEW

import type { GeocodingPlace } from './types';

export type GeocodingError =
  | { kind: 'network'; message: string }              // fetch threw (DNS, offline, transport)
  | { kind: 'timeout'; message: string }              // our own AbortSignal.timeout fired
  | { kind: 'aborted'; message: string }              // external signal aborted (new keystroke) — UI ignores
  | { kind: 'server'; status: number; message: string } // 5xx (no retry — caller will keystroke again)
  | { kind: 'client'; status: number; message: string } // 4xx (no retry)
  | { kind: 'parse'; message: string };                 // 200 but response not the expected shape

export type GeocodingResult =
  | { ok: true; data: GeocodingPlace[] }   // empty array is the "no matches" case (AC3)
  | { ok: false; error: GeocodingError };

export interface GeocodingDeps {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  signal?: AbortSignal;   // caller-owned; aborting it returns kind: 'aborted'
}

export const DEFAULT_GEOCODING_TIMEOUT_MS = 10_000;
export const DEFAULT_GEOCODING_COUNT = 5;
export const OPEN_METEO_GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
export const MIN_QUERY_LENGTH = 2;

export async function searchGeocoding(
  query: string,
  deps?: GeocodingDeps,
): Promise<GeocodingResult>;

export function buildGeocodingUrl(name: string, count?: number): string;

export function parseGeocoding(raw: unknown): GeocodingResult;
```

### Query validation (closed before any network call)

- `query` trimmed; if trimmed length `< MIN_QUERY_LENGTH` → return `{ ok: true, data: [] }` (silent no-op). This is NOT an error — the UI's "type ≥ 2 chars" hint is the only feedback.
- Encoded via `URLSearchParams({ name: trimmed, count: '5', language: 'en' })` — no manual string concat, no injection vector.

### Abort/timeout distinction (locked)

Two abort sources, one fetch call. The classifier must tell them apart:

| Trigger | Detection | Returned kind |
|---|---|---|
| External `deps.signal.abort()` fires (new keystroke) | `deps.signal?.aborted === true` at catch-time | `'aborted'` |
| `AbortSignal.timeout(timeoutMs)` fires after 10 s | `err instanceof DOMException && err.name === 'TimeoutError'` | `'timeout'` |
| Other DOMException with `name === 'AbortError'` and external signal NOT aborted | (rare; defensive) | `'aborted'` |

Implementation: combine the two signals via `AbortSignal.any([deps.signal, AbortSignal.timeout(timeoutMs)])` if both are present; otherwise pass whichever exists. Then in the `catch` block:

```ts
if (deps.signal?.aborted) return { ok: false, error: { kind: 'aborted', message: 'request cancelled' } };
if (err instanceof DOMException && err.name === 'TimeoutError') return { ok: false, error: { kind: 'timeout', message: 'request timed out' } };
if (err instanceof DOMException && err.name === 'AbortError') return { ok: false, error: { kind: 'aborted', message: 'request aborted' } };
if (err instanceof Error) return { ok: false, error: { kind: 'network', message: err.message } };
return { ok: false, error: { kind: 'network', message: 'unknown network error' } };
```

(Order matters — check external `signal.aborted` BEFORE inspecting the DOMException, because both signals look alike at the `fetch` level.)

### `parseGeocoding` (boundary)

- `raw` must be an object.
- If `raw.results` is missing → success with empty array (no-matches contract, AC3).
- If `raw.results` is present but not an array → parse error.
- For each entry: `name`/`latitude`/`longitude` must be of the right primitive type; out-of-range coords → parse error (mirror `default-locations.ts:89-113`). `country` and `admin1`: include only if `typeof === 'string'` (and non-empty after trim); otherwise omit.
- Cap the returned array length at `DEFAULT_GEOCODING_COUNT` (defensive — API already does this, but a misbehaving response shouldn't blow up the UI list).

---

## UI component contract — `renderSearchInput`

```ts
// src/ui/search-input.ts — NEW

import type { GeocodingPlace } from '../locations/types';
import type { GeocodingResult } from '../locations/geocoding-client';

export interface SearchInputDeps {
  // Caller injects the bound client so this module stays at the UI layer
  // (depends on `locations/` types only, not on its network client).
  searchGeocoding: (query: string, signal: AbortSignal) => Promise<GeocodingResult>;
  // Fired with the user's typed pick — STORY-009 will swap this to slot-fill logic.
  onSelect: (place: GeocodingPlace) => void;
  // Visibility-of-network signal. Default: `() => navigator.onLine`.
  isOnline?: () => boolean;
  // Debounce window — default 300 ms (issue AC2).
  debounceMs?: number;
  // Min length to fire a search — default 2 (issue AC1).
  minQueryLength?: number;
}

export function renderSearchInput(deps: SearchInputDeps): HTMLElement;
```

### State machine (rendered inside the wrapper element)

| Trigger | Visible state |
|---|---|
| Empty input | input only; suggestions list hidden; no status |
| Length `< minQueryLength` | suggestions hidden; no status (don't nag) |
| Length `≥ minQueryLength`, online, in-flight | `Searching…` (status text — non-blocking) |
| Result `ok: true, data: []` | `No results` (status) — AC3 |
| Result `ok: true, data: [...]` | list of options, each `Name — Region, Country` (omit missing fields gracefully) — AC1 |
| Result `kind: 'aborted'` | **ignore** — a newer query is already in flight |
| `isOnline() === false` (checked BEFORE firing) | `Search needs a connection` (status); request NOT fired — AC4 |
| Result `kind: 'network' \| 'timeout' \| 'server' \| 'client' \| 'parse'` | `Search unavailable, try again` (status) — no raw error text |
| User clicks/taps an option | call `deps.onSelect(place)`; clear input; clear list |
| User clears input | hide suggestions; cancel any in-flight via `AbortController.abort()` |

### Per-keystroke flow (locked)

1. `input` event handler reads `event.target.value`.
2. `controller.abort()` the previous AbortController.
3. Compute trimmed length; if `< min` → render empty + return (no debounce timer).
4. If `!isOnline()` → render `Search needs a connection` + return.
5. Render `Searching…` status (best UX: keep prior list visible underneath until the new one resolves, but for first version a clean `Searching…` swap is fine and simpler to test).
6. `clearTimeout(timer)`, schedule `setTimeout(debounceMs)`:
   - On fire: create a new `AbortController`; call `deps.searchGeocoding(trimmed, controller.signal)`; on resolve, **bail if `result.error?.kind === 'aborted'`**; otherwise render.

### Selection event

- Each `<button class="search-input__option" data-option-index="i">` has its `textContent` set to a multi-part label built with `appendChild(document.createTextNode(...))` per fragment — no innerHTML.
- Delegated `click` on the list: read `data-option-index`, look up the stored `GeocodingPlace`, call `onSelect`, then clear input + collapse list.
- Buttons are `<button type="button">` so they don't submit any enclosing form.

### CSS (extend `src/ui/styles.css`)

Add a small block reusing the existing tokens (`--card-bg`, `--border`, `--radius`, `--muted`, `--accent`):
- `.search-input { position: relative; margin-bottom: var(--gap); }`
- `.search-input__field { width: 100%; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--card-bg); color: var(--fg); font-size: 1rem; }`
- `.search-input__field:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }`
- `.search-input__list { list-style: none; margin: 4px 0 0; padding: 0; border: 1px solid var(--border); border-radius: var(--radius); background: var(--card-bg); overflow: hidden; }`
- `.search-input__list[hidden] { display: none; }`
- `.search-input__option { display: block; width: 100%; padding: 10px 12px; text-align: left; background: transparent; border: 0; color: var(--fg); cursor: pointer; font: inherit; }`
- `.search-input__option:hover, .search-input__option:focus-visible { background: rgba(247, 181, 0, 0.12); }`
- `.search-input__option + .search-input__option { border-top: 1px solid var(--border); }`
- `.search-input__option-name { font-weight: 600; }`
- `.search-input__option-meta { color: var(--muted); font-size: 0.85rem; margin-left: 6px; }`
- `.search-input__status { margin: 6px 4px 0; font-size: 0.85rem; color: var(--muted); }`

---

## Files to change

| File | Action | Purpose |
|------|--------|---------|
| `src/locations/types.ts` | UPDATE | Add `GeocodingPlace` interface alongside existing `LocationSlot`. No breaking change. |
| `src/locations/geocoding-client.ts` | CREATE | Pure-function client: `searchGeocoding`, `buildGeocodingUrl`, `parseGeocoding`, types + constants. No retries, abort-aware. |
| `src/locations/geocoding-client.test.ts` | CREATE | Unit tests on mocked `fetch` + fixture: happy path, empty results, 4xx, 5xx (no retry), parse, external-abort vs timeout classification, query-length validation, URL builder. |
| `src/locations/fixtures/open-meteo-geocoding.fixture.ts` | CREATE | Two recorded live responses (one with hits, one with no `results` key), `satisfies` raw `unknown` and a typed `GeocodingPlace[]` view for assertions. |
| `src/ui/search-input.ts` | CREATE | The vanilla-DOM component: render input + list + status; manages debounce + AbortController. No direct network — takes `searchGeocoding` via deps. |
| `src/ui/search-input.test.ts` | CREATE | Component tests with `vi.useFakeTimers()`: debounce, abort previous on next keystroke, no-results state, offline state, selection callback fires with the right object, no innerHTML used. |
| `src/ui/styles.css` | UPDATE | Add the `.search-input*` CSS block above. Reuse existing tokens. **Hotspot per CLAUDE.md — only this story touches it concurrently.** |
| `src/main.ts` | UPDATE | Wire the search input above the locations grid: import + bind the client, render at top of the root. For STORY-008 the `onSelect` is a placeholder that `console.info`s the pick and clears the input (STORY-009 replaces it). **Hotspot per CLAUDE.md.** |
| `.agents/reports/geocoding-autocomplete-report.md` | CREATE (during `/implement`) | Implementation report mirroring `.agents/reports/open-meteo-client-report.md`. |

Counts: **5 CREATE files**, **3 UPDATE files** (+ 1 report file CREATE during implement = 6 CREATE total). **0 DELETE**.

**NOT touched** (deliberate):
- `vite.config.ts` — no PWA/manifest change needed; the geocoding endpoint is just another fetch under the hood. Hotspot, but out of scope.
- `src/weather/*` — geocoding is a `locations/` concern; no domain crossover.
- `src/storage/*` — STORY-009 owns persisting custom slots.
- `src/ui/home-screen.ts`, `src/ui/location-card.ts`, `src/ui/detail-view.ts` — the existing card grid is unchanged; the search input sits above it in `main.ts`.
- `src/locations/default-locations.ts`, `default-locations.test.ts`, `mock-locations.ts` — untouched.

---

## Implementation contract — sketch

### `src/locations/geocoding-client.ts`

```ts
import type { GeocodingPlace } from './types';

export const DEFAULT_GEOCODING_TIMEOUT_MS = 10_000;
export const DEFAULT_GEOCODING_COUNT = 5;
export const OPEN_METEO_GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
export const MIN_QUERY_LENGTH = 2;

export type GeocodingError =
  | { kind: 'network'; message: string }
  | { kind: 'timeout'; message: string }
  | { kind: 'aborted'; message: string }
  | { kind: 'server'; status: number; message: string }
  | { kind: 'client'; status: number; message: string }
  | { kind: 'parse'; message: string };

export type GeocodingResult =
  | { ok: true; data: GeocodingPlace[] }
  | { ok: false; error: GeocodingError };

export interface GeocodingDeps {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export function buildGeocodingUrl(name: string, count: number = DEFAULT_GEOCODING_COUNT): string {
  const params = new URLSearchParams({
    name,
    count: String(count),
    language: 'en',
  });
  return `${OPEN_METEO_GEOCODING_URL}?${params.toString()}`;
}

export async function searchGeocoding(
  query: string,
  deps: GeocodingDeps = {},
): Promise<GeocodingResult> {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) {
    return { ok: true, data: [] };
  }

  const fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = deps.timeoutMs ?? DEFAULT_GEOCODING_TIMEOUT_MS;
  const externalSignal = deps.signal;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal =
    externalSignal !== undefined
      ? AbortSignal.any([externalSignal, timeoutSignal])
      : timeoutSignal;
  const url = buildGeocodingUrl(trimmed);

  try {
    const response = await fetchImpl(url, { signal });
    if (response.status >= 500 && response.status < 600) {
      return { ok: false, error: { kind: 'server', status: response.status, message: `HTTP ${response.status}` } };
    }
    if (response.status >= 400 && response.status < 500) {
      return { ok: false, error: { kind: 'client', status: response.status, message: `HTTP ${response.status}` } };
    }
    if (!response.ok) {
      return { ok: false, error: { kind: 'server', status: response.status, message: `HTTP ${response.status}` } };
    }
    const json = (await response.json()) as unknown;
    return parseGeocoding(json);
  } catch (err) {
    return { ok: false, error: classifyThrown(err, externalSignal) };
  }
}

function classifyThrown(err: unknown, externalSignal: AbortSignal | undefined): GeocodingError {
  if (externalSignal?.aborted === true) {
    return { kind: 'aborted', message: 'request cancelled' };
  }
  if (err instanceof DOMException && err.name === 'TimeoutError') {
    return { kind: 'timeout', message: 'request timed out' };
  }
  if (err instanceof DOMException && err.name === 'AbortError') {
    return { kind: 'aborted', message: 'request aborted' };
  }
  if (err instanceof Error) {
    return { kind: 'network', message: err.message };
  }
  return { kind: 'network', message: 'unknown network error' };
}

export function parseGeocoding(raw: unknown): GeocodingResult {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: { kind: 'parse', message: 'response is not an object' } };
  }
  const r = raw as Record<string, unknown>;
  // No `results` key OR `results` is undefined → no matches (NOT a parse error).
  if (r.results === undefined) {
    return { ok: true, data: [] };
  }
  if (!Array.isArray(r.results)) {
    return { ok: false, error: { kind: 'parse', message: 'results is not an array' } };
  }
  const places: GeocodingPlace[] = [];
  for (let i = 0; i < r.results.length && places.length < DEFAULT_GEOCODING_COUNT; i++) {
    const entry = r.results[i];
    const parsed = parsePlace(entry, i);
    if (!parsed.ok) return parsed;
    places.push(parsed.data);
  }
  return { ok: true, data: places };
}

function parsePlace(raw: unknown, index: number): { ok: true; data: GeocodingPlace } | { ok: false; error: GeocodingError } {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: { kind: 'parse', message: `result ${index} is not an object` } };
  }
  const e = raw as Record<string, unknown>;
  if (typeof e.name !== 'string' || e.name.trim() === '') {
    return { ok: false, error: { kind: 'parse', message: `result ${index}: name is missing or empty` } };
  }
  if (typeof e.latitude !== 'number' || !Number.isFinite(e.latitude) || e.latitude < -90 || e.latitude > 90) {
    return { ok: false, error: { kind: 'parse', message: `result ${index}: latitude is missing or out of range` } };
  }
  if (typeof e.longitude !== 'number' || !Number.isFinite(e.longitude) || e.longitude < -180 || e.longitude > 180) {
    return { ok: false, error: { kind: 'parse', message: `result ${index}: longitude is missing or out of range` } };
  }
  const place: GeocodingPlace = {
    name: e.name.trim(),
    latitude: e.latitude,
    longitude: e.longitude,
  };
  if (typeof e.country === 'string' && e.country.trim() !== '') place.country = e.country.trim();
  if (typeof e.admin1 === 'string' && e.admin1.trim() !== '') place.admin1 = e.admin1.trim();
  return { ok: true, data: place };
}
```

### `src/ui/search-input.ts` — outline

```ts
import type { GeocodingPlace } from '../locations/types';
import type { GeocodingResult } from '../locations/geocoding-client';

const DEFAULT_DEBOUNCE_MS = 300;
const DEFAULT_MIN_QUERY_LENGTH = 2;

export interface SearchInputDeps {
  searchGeocoding: (query: string, signal: AbortSignal) => Promise<GeocodingResult>;
  onSelect: (place: GeocodingPlace) => void;
  isOnline?: () => boolean;
  debounceMs?: number;
  minQueryLength?: number;
}

export function renderSearchInput(deps: SearchInputDeps): HTMLElement {
  const debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const minQueryLength = deps.minQueryLength ?? DEFAULT_MIN_QUERY_LENGTH;
  const isOnline = deps.isOnline ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));

  const wrapper = document.createElement('section');
  wrapper.className = 'search-input';
  wrapper.setAttribute('aria-label', 'Search for a location');

  const field = document.createElement('input');
  field.className = 'search-input__field';
  field.type = 'search';
  field.autocomplete = 'off';
  field.placeholder = 'Search city or place…';
  field.setAttribute('aria-autocomplete', 'list');

  const status = document.createElement('p');
  status.className = 'search-input__status';
  status.hidden = true;

  const list = document.createElement('ul');
  list.className = 'search-input__list';
  list.hidden = true;
  list.setAttribute('role', 'listbox');

  wrapper.append(field, status, list);

  let currentResults: GeocodingPlace[] = [];
  let controller: AbortController | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let queryId = 0; // monotonically increasing — bail if a later query has already started.

  function setStatus(text: string | null): void {
    if (text === null) {
      status.hidden = true;
      status.textContent = '';
    } else {
      status.textContent = text;
      status.hidden = false;
    }
  }

  function setOptions(places: GeocodingPlace[]): void {
    currentResults = places;
    list.replaceChildren();
    if (places.length === 0) {
      list.hidden = true;
      return;
    }
    list.hidden = false;
    places.forEach((place, idx) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'search-input__option';
      button.dataset.optionIndex = String(idx);
      const nameSpan = document.createElement('span');
      nameSpan.className = 'search-input__option-name';
      nameSpan.textContent = place.name;
      button.append(nameSpan);
      const metaText = [place.admin1, place.country].filter((s): s is string => typeof s === 'string' && s !== '').join(', ');
      if (metaText !== '') {
        const metaSpan = document.createElement('span');
        metaSpan.className = 'search-input__option-meta';
        metaSpan.textContent = metaText;
        button.append(metaSpan);
      }
      li.append(button);
      list.append(li);
    });
  }

  function clearAll(): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (controller !== null) {
      controller.abort();
      controller = null;
    }
    setOptions([]);
    setStatus(null);
  }

  field.addEventListener('input', () => {
    const raw = field.value;
    const trimmed = raw.trim();
    // Cancel anything in flight.
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    if (controller !== null) controller.abort();
    if (trimmed.length < minQueryLength) {
      setOptions([]);
      setStatus(null);
      return;
    }
    if (!isOnline()) {
      setOptions([]);
      setStatus('Search needs a connection');
      return;
    }
    setStatus('Searching…');
    const id = ++queryId;
    debounceTimer = setTimeout(() => {
      const localController = new AbortController();
      controller = localController;
      void deps.searchGeocoding(trimmed, localController.signal).then((result) => {
        // Bail if a newer query has overtaken us.
        if (id !== queryId) return;
        if (!result.ok) {
          if (result.error.kind === 'aborted') return; // silent
          console.warn('[geocoding] search failed', trimmed, result.error);
          setOptions([]);
          setStatus('Search unavailable, try again');
          return;
        }
        if (result.data.length === 0) {
          setOptions([]);
          setStatus('No results');
          return;
        }
        setOptions(result.data);
        setStatus(null);
      });
    }, debounceMs);
  });

  list.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>('.search-input__option');
    if (button === null) return;
    const idxStr = button.dataset.optionIndex;
    if (idxStr === undefined) return;
    const idx = Number(idxStr);
    const place = currentResults[idx];
    if (place === undefined) return;
    console.info('[geocoding] selected', place.name);
    deps.onSelect(place);
    field.value = '';
    clearAll();
  });

  return wrapper;
}
```

(The above is the design target — `/implement` may shorten or tweak names but must preserve the AC mapping and the public function signature.)

### `src/main.ts` — minimal wire-in

Insert above the locations grid render, after `parseDefaultLocations`:

```ts
import { searchGeocoding } from './locations/geocoding-client';
import { renderSearchInput } from './ui/search-input';

// inside bootstrap, before first paint:
const search = renderSearchInput({
  searchGeocoding: (query, signal) => searchGeocoding(query, { signal }),
  onSelect: (place) => {
    // STORY-009 will wire this to slot-fill logic. For now: log + clear.
    console.info('[main] location selected (STORY-009 will use this):', place);
  },
});
```

Then in the `render()` helper, prepend `search` to the children list passed to `root.replaceChildren(...)` (or keep `search` mounted separately above the grid, whichever keeps the diff smallest — `/implement` decides between (a) `root.append(search, grid, footer)` style and (b) a dedicated header div, but the search input MUST persist across re-renders so its in-progress state is not nuked when `revalidate` returns). **Recommended**: mount `search` ONCE at bootstrap, separately from the `render(root, …)` flow which replaces the cards-and-footer block. The simplest way: keep a `<header>` wrapper outside the area that `render()` rewrites.

---

## Tasks

Execute in order. Each task is atomic and verifiable.

### Task 1: Validate the live geocoding endpoint (CLAUDE.md gate)

- **Action**: Run two real `curl`s to confirm the endpoint is up, the params are accepted, the response still has the fields our parser claims, AND verify the "no matches" shape.
- **Commands**:
  ```bash
  # Hits expected (well-known place):
  curl -sS --max-time 10 \
    "https://geocoding-api.open-meteo.com/v1/search?name=Helsinki&count=5&language=en"

  # No-results case (gibberish):
  curl -sS --max-time 10 \
    "https://geocoding-api.open-meteo.com/v1/search?name=zzzzzzzzqqxx&count=5&language=en"
  ```
- **Verify**:
  - Hits response: top-level `results` is an array of objects; each has `name: string`, `latitude: number`, `longitude: number`; `country` and `admin1` may be `string` or absent.
  - No-results response: `results` key is absent (or is an empty array — parser handles both).
- **If endpoint is unreachable from this sandbox**: record as a CLAUDE.md sandbox-blocked check (defer-and-record); proceed with a synthesized fixture in Task 2 (the `satisfies` type guarantee is the actual contract; live realism is bonus).
- **Validate**: paste both responses (trimmed if huge) into the fixture file in Task 2.

### Task 2: Create the fixture — `src/locations/fixtures/open-meteo-geocoding.fixture.ts`

- **File**: `src/locations/fixtures/open-meteo-geocoding.fixture.ts`
- **Action**: CREATE
- **Implement**:
  - `import type { GeocodingPlace } from '../types';`
  - `export const SAMPLE_HITS_RAW: unknown = JSON.parse(JSON.stringify({ ... }));` — the live response body for the hits query. The `JSON.parse(JSON.stringify(...))` round-trip strips TS types so it presents as true `unknown` to the parser tests.
  - `export const SAMPLE_HITS_PARSED: GeocodingPlace[] = [ ... ] satisfies GeocodingPlace[];` — the expected parsed view. Used for `expect(result.data).toEqual(SAMPLE_HITS_PARSED)`.
  - `export const SAMPLE_NO_RESULTS_RAW: unknown = JSON.parse(JSON.stringify({ generationtime_ms: 0.42 }));` — the no-results shape (no `results` key).
  - Use a public place (Helsinki) — NO repo-private cities.
- **Mirror**: `src/weather/fixtures/open-meteo-forecast.fixture.ts` (already in repo) for module style.
- **Validate**: `npx tsc --noEmit` passes.

### Task 3: Extend `src/locations/types.ts`

- **File**: `src/locations/types.ts`
- **Action**: UPDATE
- **Implement**: append `GeocodingPlace` interface (see Public API above). Leave `LocationSlot` untouched (STORY-009 will think about how a `custom` slot stores its place-of-origin).
- **Mirror**: `src/locations/types.ts:5-11` style (one-line block comment, PascalCase interface, optional fields with `?`).
- **Validate**: `npx tsc --noEmit` passes; `npm run lint` passes.

### Task 4: Build the client — `src/locations/geocoding-client.ts`

- **File**: `src/locations/geocoding-client.ts`
- **Action**: CREATE
- **Implement**: every export listed in the Public API section. `searchGeocoding`, `buildGeocodingUrl`, `parseGeocoding`, the discriminated-union types, the constants, and the private `classifyThrown`/`parsePlace` helpers per the sketch above.
- **Mirror**: `src/weather/open-meteo-client.ts:1-133` (overall shape: pure module, deps injection, classify thrown errors, boundary parser). Do NOT mirror the retry loop — geocoding has no retries (per issue's Technical Notes).
- **Validate**: `npx tsc --noEmit` + `npm run lint`; tests in Task 5 cover behaviour.

### Task 5: Unit tests for the client — `src/locations/geocoding-client.test.ts`

- **File**: `src/locations/geocoding-client.test.ts`
- **Action**: CREATE
- **Implement** at minimum these cases (each gets its own `it`):
  1. **`buildGeocodingUrl` shape**: URL starts with `OPEN_METEO_GEOCODING_URL?`; `name` is percent-encoded (test with `name = 'Käsmu'` → assert `URL(...).searchParams.get('name') === 'Käsmu'`); `count` defaults to 5; `language=en`.
  2. **Query too short**: `searchGeocoding('a')` returns `{ ok: true, data: [] }` without calling `fetchImpl` (assert spy not called).
  3. **Whitespace-only query**: `searchGeocoding('   ')` returns `{ ok: true, data: [] }`; spy not called.
  4. **Happy path**: `fetchImpl` returns `new Response(JSON.stringify(SAMPLE_HITS_RAW))`; expect `{ ok: true, data }` where `data` equals `SAMPLE_HITS_PARSED`.
  5. **No-results body**: `fetchImpl` returns the `SAMPLE_NO_RESULTS_RAW` shape; expect `{ ok: true, data: [] }`.
  6. **`results` is wrong type**: returns `{ ok: false, error: { kind: 'parse', ... } }`.
  7. **Result entry missing `name`**: parse error mentioning `result 0` and `name`.
  8. **4xx — no retry**: `fetchImpl` returns status 400; expect `{ ok: false, error: { kind: 'client', status: 400, ... } }`; spy called exactly once.
  9. **5xx — no retry** (geocoding has no retries): `fetchImpl` returns 503; expect `{ ok: false, error: { kind: 'server', status: 503, ... } }`; spy called exactly once.
  10. **External abort wins over timeout classification**: simulate a fetchImpl that rejects with `new DOMException('aborted', 'AbortError')`, and pass a `signal` that is already aborted (`AbortSignal.abort()`). Expect `{ ok: false, error: { kind: 'aborted', ... } }`.
  11. **Timeout classification**: `fetchImpl` rejects with `new DOMException('timeout', 'TimeoutError')`; expect `{ ok: false, error: { kind: 'timeout', ... } }`.
  12. **Network throw**: `fetchImpl` rejects with `new TypeError('Failed to fetch')`; expect `{ ok: false, error: { kind: 'network', ... } }`.
  13. **`parseGeocoding` direct unit tests**: pass `null`, `'string'`, `{ results: 'oops' }`, `{ results: [{ name: 'X', latitude: 91, longitude: 0 }] }`, `{ results: [{ name: 'X', latitude: 60, longitude: 24 }] }`, and `SAMPLE_HITS_RAW`. Assert distinct messages on each rejection and the correct `data` length on success.
  14. **`country`/`admin1` optionality**: `{ results: [{ name: 'X', latitude: 60, longitude: 24 }] }` → parsed `GeocodingPlace` has no `country` / `admin1` keys (or `=== undefined`). With both fields present and non-empty → both copied.
  15. **Defensive cap**: response with 20 entries → returned array length is capped at 5.
- **Test scaffolding**:
  - `import { afterEach, describe, expect, it, vi } from 'vitest';`
  - `afterEach(() => vi.restoreAllMocks());`
  - For each case: `const fetchImpl = vi.fn<typeof fetch>(async () => ...);` then pass `{ fetchImpl }`.
  - **Do NOT use `vi.useFakeTimers()`** in this file — the client has no internal timer plumbing tested here. Fake timers belong in the UI test (Task 7).
- **Mirror**: `src/weather/open-meteo-client.test.ts:1-100` for the dependency-injection mocking and shape of `it`-cases.
- **Validate**: `npm test` — all green.

### Task 6: Build the UI component — `src/ui/search-input.ts`

- **File**: `src/ui/search-input.ts`
- **Action**: CREATE
- **Implement**: `renderSearchInput(deps)` per the sketch above. Strict-mode TypeScript: every `null`/`undefined` access guarded; `noUncheckedIndexedAccess` respected (the `currentResults[idx]` access checks `=== undefined` before use). NO innerHTML. NO `eval`. NO API-sourced strings rendered as anything but `textContent`.
- **Mirror**: `src/ui/home-screen.ts:7-109` (event delegation, role/aria attrs), `src/ui/location-card.ts:14-62` (DOM construction style), `src/ui/footer.ts:5-18` (smallest possible component).
- **Validate**: `npx tsc --noEmit` + `npm run lint`; tests in Task 7 cover behaviour.

### Task 7: Unit tests for the component — `src/ui/search-input.test.ts`

- **File**: `src/ui/search-input.test.ts`
- **Action**: CREATE
- **Implement** at minimum:
  1. **Renders the input field**: mount, assert there is exactly one `<input class="search-input__field">` with `type="search"` and `autocomplete="off"`.
  2. **Below min-length: no search**: type 'a' (set `field.value = 'a'`, dispatch `new Event('input')`), advance debounce timer; assert `searchGeocoding` was NOT called.
  3. **At min-length online: fires after debounce**: `vi.useFakeTimers()`; type 'He', dispatch input; `vi.advanceTimersByTimeAsync(299)` → not called yet; `vi.advanceTimersByTimeAsync(1)` → called exactly once with `'He'` and an `AbortSignal`.
  4. **Renders suggestions on success**: stub `searchGeocoding` to resolve with `{ ok: true, data: [{ name: 'Helsinki', latitude: 60.17, longitude: 24.94, country: 'Finland', admin1: 'Uusimaa' }] }`; assert the list contains one `.search-input__option` whose `textContent` includes `Helsinki` and the meta `Uusimaa, Finland`.
  5. **No results state**: stub returns `{ ok: true, data: [] }`; assert status text is `No results` and `.search-input__list` is hidden.
  6. **Error state**: stub returns `{ ok: false, error: { kind: 'network', message: 'x' } }`; assert status text is `Search unavailable, try again` and no raw error message leaks (`expect(status.textContent).not.toContain('Failed')`).
  7. **Aborted state is silent**: stub returns `{ ok: false, error: { kind: 'aborted', message: 'cancelled' } }`; assert status is NOT replaced (i.e. prior `Searching…` is kept or cleared by the next query, but no error text appears).
  8. **Offline state**: pass `deps.isOnline = () => false`; type 'He'; assert status is `Search needs a connection` and `searchGeocoding` was NEVER called.
  9. **Keystroke cancels the previous in-flight request**: stub takes two calls; first never resolves but its signal should `abort` after the second keystroke. Use a vi.fn that captures signals; after a second keystroke + debounce advance, assert the first call's signal `aborted === true`.
  10. **Selection fires `onSelect` and clears the input**: after rendering options, `(option as HTMLButtonElement).click()`; assert `onSelect` was called with the exact place object; assert `field.value === ''` and the list is hidden.
  11. **No innerHTML used (anywhere)**: render with options whose `name` is `'<script>alert(1)</script>'`. Assert `wrapper.outerHTML` contains the escaped `&lt;script&gt;` sequence — i.e. textContent escaping worked. (This is a regression test for AC5.)
- **Test scaffolding**:
  - `import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';`
  - `beforeEach(() => vi.useFakeTimers());`
  - `afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); vi.restoreAllMocks(); });`
  - Mount with `document.body.append(wrapper);` per `home-screen.test.ts:6-12`.
- **Mirror**: `src/ui/home-screen.test.ts:1-60` for the mount/cleanup; `src/locations/default-locations.test.ts:1-185` for the `describe`/`it` density.
- **Validate**: `npm test` — all green.

### Task 8: Style block in `src/ui/styles.css` (hotspot)

- **File**: `src/ui/styles.css`
- **Action**: UPDATE
- **Implement**: append the `.search-input*` block at the bottom of the file (after `.location-card__updated`, before EOF). Reuse `--card-bg`, `--border`, `--radius`, `--muted`, `--accent`, `--gap`, `--fg`. Mobile-first; no media queries needed (the input fits the existing 480 px max-width column).
- **Mirror**: `src/ui/styles.css:62-90` (location-card block) for spacing + token reuse.
- **Validate**: `npx tsc --noEmit` (CSS isn't typed, but ensure no JS/TS broke); `npm run lint` (CSS is not linted; only TS files).

### Task 9: Wire the search input into `main.ts` (hotspot)

- **File**: `src/main.ts`
- **Action**: UPDATE
- **Implement**:
  - Add imports for `searchGeocoding` and `renderSearchInput`.
  - Build the search input ONCE at bootstrap (after `parseDefaultLocations` resolves successfully — we still want it visible even if some slots have no cache yet).
  - Render strategy that keeps debounce state alive: create a `<div id="app-header">` (or just keep a module-scoped `searchEl`), attach the search input ONCE, and refactor the existing `render()` helper to call `root.replaceChildren(searchEl, renderHomeScreen(...), renderFooter())`. Re-rendering must NOT recreate the search input — only the grid + footer. The simplest pattern: keep a `headerEl: HTMLElement` outside `render()` and append it before the grid each time (or skip replaceChildren and only swap the grid + footer block).
  - `onSelect` for STORY-008: `console.info('[main] location selected (STORY-009):', place)` and that's it (the component already clears the input + list).
- **Mirror**: `src/main.ts:85-96` for the render helper; `src/main.ts:27-83` for the bootstrap pattern.
- **Risks**:
  - Don't break the empty-state path (`renderEmptyState`) — if default locations fail to parse, the user should STILL see the search input (so they can manually add a slot once STORY-009 lands). For STORY-008, this is a nice-to-have; **acceptable minimum**: search input is only shown on the happy path. The plan accepts either; `/implement` chooses the smaller diff. Document the decision in the implementation report.
- **Validate**: `npm run lint && npx tsc --noEmit && npm test && npm run build` — all green.

### Task 10: Full validation pass + implementation report

- **Implement**:
  1. `npm run lint && npx tsc --noEmit && npm test` — every command exits 0 (CLAUDE.md › Validation).
  2. `npm run build` — succeeds; bundle size delta minimal (only adds the geocoding client + UI component; no new deps).
  3. (Optional, demoable per CLAUDE.md › Notes: "every phase must produce something visually demoable") — run `npm run preview` and capture a screenshot via agent-browser of the search input with a Helsinki query showing the dropdown. If the sandbox blocks outbound network for the screenshot fetch, record as defer-and-record and provide the dev-server screenshot instead.
  4. Write `.agents/reports/geocoding-autocomplete-report.md` mirroring `.agents/reports/open-meteo-client-report.md` structure (Summary, Tasks Completed, Validation Evidence, Acceptance Criteria Mapping, Tests Written, Files Changed, Re-verification, Sandbox-blocked items).
- **Sandbox-blocked items** (record explicitly, do NOT treat as failures):
  - Real-device iPhone tap-test of the input field (keyboard interactions, momentum scroll under the dropdown) — owner runs manually after deploy.
  - Live `curl` to the geocoding endpoint, if outbound network is unavailable in this environment (Task 1 fallback).
  - Production deploy / Lighthouse — STORY-010 territory.
- **Validate**: every command above exits 0; the report file exists; the screenshot (or its defer-and-record note) is committed under `.agents/reports/screenshots/`.

---

## Risks

| Risk | Mitigation |
|------|------------|
| `AbortSignal.any` not available in older runtimes | Targets are TS `ES2022` + `vite@7` + Node 18+ + modern Safari (iPhone 12+, the actual deploy target). `AbortSignal.any` is widely available since 2024. If a CI runner ever lacks it, fall back to manually wiring an `AbortController` that listens to both signals — but don't pre-emptively polyfill. |
| `vi.useFakeTimers()` interaction with `AbortSignal.timeout` | We inject `fetchImpl` in tests so `AbortSignal.timeout` is never actually waited on. The fake timer only drives the UI debounce timer. The client unit tests don't use fake timers. |
| Race: a stale (slow) `searchGeocoding` resolves AFTER a newer one | The `queryId` monotonic counter inside the component bails out (`if (id !== queryId) return`) BEFORE rendering. Plus the AbortController is aborted on every keystroke so the request itself should fail with `aborted` and be silently dropped by the result-handler. Double-protection on purpose. |
| API rate limit hit during tests | All tests mock `fetch` via `deps.fetchImpl`. Task 1's two `curl`s are negligible against the 10k/day free quota. |
| Cross-domain typing — `GeocodingResult` re-imported from `locations/` into `ui/search-input.ts` | Architecture allows `ui/ → locations/` (UI depends on the domain). The component imports the result TYPE, not the network function — keeping the component testable with a stub. |
| Hotspot collisions on `main.ts` and `styles.css` | CLAUDE.md orchestration rule: never run two issues touching the same hotspot concurrently. This story is the only one open on these files in the current session. |
| Real-world fuzzy-search weakness on short prefixes ("Käs" misses Käsmu) | UI shows whatever the API returns, per spec. The placeholder text is generic ("Search city or place…") — does NOT promise great suggestions at 2–3 chars. Documented in the report. |
| Committing user-specific coordinates by accident | Fixture uses Helsinki (60.17/24.94 — public Open-Meteo docs example). The four CLAUDE.md cities + their env-injected coords MUST NOT appear in source. The geocoding response for Helsinki is fair game (it's in Open-Meteo's public docs). |
| `console.warn` from the component fires during the error-state test and clutters output | Acceptable, mirrors the existing pattern in `open-meteo-client.ts:83-86`. If it becomes annoying, test can `vi.spyOn(console, 'warn').mockImplementation(() => {})` and assert + suppress. |
| Search input gets recreated on every revalidate cycle and loses focus mid-typing | Mitigated by Task 9: mount the search input ONCE outside the `render()` helper. The UNIT test for the component doesn't catch this — it's a `main.ts` integration concern; verify manually with `npm run preview` + agent-browser (defer-and-record if sandbox blocks). |
| XSS via API-returned location names | All names rendered via `textContent` (AC5 enforces this; test case 11 in Task 7 is the regression test). |

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

- Live `curl` re-verification of the geocoding endpoint, if outbound network is blocked in this environment (Task 1 fallback).
- Real-device iPhone tap test (keyboard, dropdown momentum, iOS safe-area) — owner runs manually.
- `npm run preview` + agent-browser screenshot, if the sandbox blocks the headless browser.

---

## Acceptance criteria

Issue #8 ACs → tasks/tests mapping (every AC maps to ≥ 1 task or test):

- [ ] **AC1** — Input + ≥2 chars → suggestions (name, country, region) from the API.
      → Task 4 (`searchGeocoding` + `buildGeocodingUrl` send `count=5&language=en`), Task 6 (component renders name + meta), Task 7 cases 3+4 (debounce fires; suggestions render with `Helsinki` + `Uusimaa, Finland`).
- [ ] **AC2** — Debounce ~300 ms; in-flight aborted on new input via `AbortController`.
      → Task 6 (debounce + AbortController), Task 7 cases 3 (timing exact at 300 ms) + 9 (previous signal aborted on next keystroke).
- [ ] **AC3** — Empty result → "No results" (not a hang, not an error).
      → Task 4 (parser treats missing `results` and empty array as `ok: true, data: []`), Task 6 (renders `No results` status), Task 5 case 5 (parser), Task 7 case 5 (component).
- [ ] **AC4** — Offline → "Search needs a connection"; rest of app keeps working.
      → Task 6 (checks `isOnline()` BEFORE firing), Task 7 case 8 (assertion: search not called, status text exact), and the existing `main.ts` keeps cards rendering from cache (no regression).
- [ ] **AC5** — Suggestions rendered as text (`textContent`), not HTML.
      → Task 6 (uses only `textContent` / `createElement` / `appendChild`), Task 7 case 11 (regression test with `<script>` payload).
- [ ] **AC6** — Selection callback returns a typed `{ name, lat, lon }` object — ready for STORY-009.
      → Task 3 (`GeocodingPlace` type), Task 6 (`onSelect(place)` fires with the typed object), Task 7 case 10 (assertion on the exact object passed in).

Process gates:

- [ ] All tasks completed
- [ ] `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build` pass
- [ ] No new runtime dependencies (`package.json` `dependencies` stays empty)
- [ ] No `any` anywhere in new code; lint = 0 errors, 0 warnings
- [ ] No `innerHTML` in any new file; no API-sourced string rendered as anything but `textContent` (CLAUDE.md › Security)
- [ ] No real default-location coordinates (Lahti/Helsinki/Tallinn/Käsmu env-injected lat/lon) appear in source (Helsinki city centre via the public geocoding response is fine — it's not the env-injected one)
- [ ] No retries in the geocoding client (per issue Technical Notes)
- [ ] Fixture file uses `JSON.parse(JSON.stringify(...))` round-trip to present as true `unknown` to the parser
- [ ] Geocoding client lives in `src/locations/` and does NOT import from `src/weather/` or `src/ui/` or `src/storage/` (architecture rule)
- [ ] Search input mounted ONCE in `main.ts` so focus/value survive revalidate re-renders (Task 9 risk)
- [ ] Sandbox-blocked checks (Task 1 live `curl`, real-iPhone test, preview screenshot) recorded as defer-and-record, NOT treated as failures
- [ ] Issue #8 acceptance criteria → tasks/tests mapping above is complete
