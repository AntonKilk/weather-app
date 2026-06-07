# Plan: Offline cache + stale-while-revalidate

## Summary

Add an on-device forecast cache plus a stale-while-revalidate orchestrator so the
app renders the last-known forecasts instantly (and offline) with an "Updated N
ago" freshness stamp, then quietly refreshes from the network in parallel. A
`visibilitychange` handler refreshes again when the user returns to the app and
the data is older than ~30 minutes. The cache lives in `src/storage/` behind a
small interface so localStorage can be swapped for IndexedDB later without
touching the orchestrator.

## User Story

As a personal weather user
I want the app to instantly show the last forecasts (even offline) with an
honest freshness stamp, and quietly update in the background when the network
is available
So that I never see a blank screen and the data is fresh whenever I open the
app online.

## Metadata

| Field | Value |
|-------|-------|
| Type | NEW_CAPABILITY |
| Complexity | MEDIUM |
| Systems Affected | `src/storage/`, `src/main.ts`, tests |
| GitHub Issue | #7 |

---

## Patterns to Follow

### Naming: typed `Result<T>` boundary, never-throw

```ts
// SOURCE: src/weather/types.ts:151-162
export type ForecastError =
  | { readonly kind: 'timeout' }
  | { readonly kind: 'network'; readonly message: string }
  | { readonly kind: 'http'; readonly status: number; readonly retried: boolean }
  | { readonly kind: 'parse'; readonly message: string };

export type Result<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: ForecastError };
```

The cache layer will mirror this: every read returns a typed result; no exception
escapes the storage boundary.

### Naming: boundary parser with explicit error kinds

```ts
// SOURCE: src/locations/env.ts:23-37
export type EnvParseErrorKind = 'missing' | 'malformed-json' | 'invalid-shape' | 'invalid-entry';
export interface EnvParseError { readonly kind: EnvParseErrorKind; readonly message: string; }
export type ParseDefaultLocationsResult =
  | { readonly ok: true; readonly locations: readonly Location[] }
  | { readonly ok: false; readonly error: EnvParseError };
```

Cache read failures (missing entry, corrupted JSON, wrong shape) will use the
same shape.

### Wiring (`main.ts`) — per-slot isolation + console at boundaries

```ts
// SOURCE: src/main.ts:82-108
const settled = await Promise.allSettled(
  locations.map((location) =>
    fetchForecast({ lat: location.lat, lon: location.lon }, ...),
  ),
);
// per-slot extract → AppItem with forecast | null → renderApp(root, items)
```

The new SWR orchestrator will keep this shape — only it will first render from
cache, then re-render after each settled fetch updates the cache.

### Tests: vitest, co-located, vi.fn-injected dependencies

```ts
// SOURCE: src/main.test.ts:38-46
const fetchImpl = vi.fn(async (input: Request | string | URL): Promise<Response> => {
  const url = typeof input === 'string' ? input : input.toString();
  if (url.includes('latitude=60')) return makeResponse(200, lahtiFixture);
  return makeResponse(404, { error: 'not found' });
}) as unknown as typeof fetch;

await bootstrap(root, { rawEnv: TWO_LOCATIONS, fetchImpl });
```

Storage tests will inject a fake `KeyValueStore` (in-memory `Map`); SWR tests
will inject a fake clock + fake `fetchImpl`.

---

## Files to Change

| File | Action | Purpose |
|------|--------|---------|
| `src/storage/types.ts` | CREATE | `CacheEntry`, `CacheReadResult`, `KeyValueStore` interface |
| `src/storage/key-value-store.ts` | CREATE | `localStorage` adapter (safe-guarded, never throws) + in-memory fallback |
| `src/storage/forecast-cache.ts` | CREATE | Typed read/write over the KV store; keys forecasts by `lat,lon` |
| `src/storage/forecast-cache.test.ts` | CREATE | Boundary tests (missing, corrupted, shape-mismatch, write-then-read, merge) |
| `src/storage/freshness.ts` | CREATE | `formatLastUpdated(ageMs)` + `isStale(ageMs)` (30 min threshold) |
| `src/storage/freshness.test.ts` | CREATE | Age formatting + staleness threshold edge cases |
| `src/storage/swr.ts` | CREATE | `loadCachedThenRefresh()` orchestrator: per-slot cache→fetch→update→callback |
| `src/storage/swr.test.ts` | CREATE | All-online, all-offline, partial-fail, stale-then-refresh behaviour |
| `src/storage/index.ts` | CREATE | Public storage barrel (re-exports the few symbols main.ts needs) |
| `src/ui/app.ts` | UPDATE | Add optional `lastUpdated` (or `ageMs`) per item + render the stamp in the header |
| `src/ui/app.test.ts` | UPDATE | Cover the stamp rendering |
| `src/main.ts` | UPDATE | Replace direct `fetchAllForecasts` path with `loadCachedThenRefresh`; add `visibilitychange` handler |
| `src/main.test.ts` | UPDATE | Cover cache-first render and the visibility refresh |
| `package.json` | (no change) | Validation commands already match CLAUDE.md |

---

## Tasks

Execute in order. Each task is atomic and verifiable.

### Task 1: Storage types

- **File**: `src/storage/types.ts`
- **Action**: CREATE
- **Implement**:
  - `KeyValueStore` interface: `getItem(key) => string | null`, `setItem(key, value) => void`, `removeItem(key) => void`. Sync because both `localStorage` and the in-memory fallback are sync; the orchestrator wraps everything in async itself.
  - `CacheEntry<T>` shape: `{ readonly value: T; readonly fetchedAt: number; readonly version: number }` — `fetchedAt` is `Date.now()` at write time, `version` lets us evict on a future schema change.
  - `CacheReadErrorKind = 'missing' | 'malformed-json' | 'invalid-shape' | 'version-mismatch'` plus `CacheReadError` (mirrors `EnvParseError`).
  - `type CacheReadResult<T> = { ok: true; entry: CacheEntry<T> } | { ok: false; error: CacheReadError }`.
- **Mirror**: `src/locations/env.ts:23-37`, `src/weather/types.ts:151-162`
- **Validate**: `npx tsc --noEmit`

### Task 2: KeyValueStore — localStorage adapter + memory fallback

- **File**: `src/storage/key-value-store.ts`
- **Action**: CREATE
- **Implement**:
  - `createLocalStorageStore(): KeyValueStore` — wraps `window.localStorage` and swallows quota/SecurityError exceptions (they only log internally and become no-ops). Returns the memory fallback if `localStorage` is not accessible (Safari private mode, SSR, jsdom-without-storage).
  - `createMemoryStore(): KeyValueStore` — a `Map<string,string>` adapter. Used by tests; also the fallback above.
  - Probe `localStorage` with a single `setItem` / `removeItem` of a sentinel key inside `try/catch`. Never throws out of this module.
  - Console-log at boundary on quota errors (`[storage] quota exceeded …`).
- **Mirror**: `src/sw-register.ts:30-58` (never-throw, console at boundary, degrade gracefully).
- **Validate**: `npx tsc --noEmit`

### Task 3: ForecastCache

- **File**: `src/storage/forecast-cache.ts`
- **Action**: CREATE
- **Implement**:
  - `createForecastCache(store: KeyValueStore): ForecastCache`. Exposes:
    - `read(coords): CacheReadResult<ForecastResponse>` — returns `missing` / `malformed-json` / `invalid-shape` / `version-mismatch` per the typed error union.
    - `write(coords, forecast, now: number): void` — persists `{ value, fetchedAt: now, version: CACHE_VERSION }` as JSON. Failures (quota etc.) are swallowed and logged — the KV store's own try/catch is the boundary.
    - `clear(coords): void` (for tests / future "evict bad entry"). Internal use only.
  - Cache key: `forecast:v1:{lat.toFixed(4)},{lon.toFixed(4)}` (rounds to ~11 m precision so identical slots share a key). Constants `CACHE_KEY_PREFIX` and `CACHE_VERSION` exported.
  - JSON shape validated at read time using the same `isPlainObject`/`isNumberArrayProp`/`isStringArrayProp` style helpers used in `open-meteo-client.ts:379-400`. Re-use the client's `narrowForecastResponse` by extracting it OR re-implement the same field guards locally — simpler to add local guards (no cross-layer coupling).
- **Mirror**: `src/weather/open-meteo-client.ts:311-373` (boundary validation), `src/locations/env.ts:63-95` (Result-returning parse).
- **Validate**: `npx tsc --noEmit`

### Task 4: ForecastCache tests

- **File**: `src/storage/forecast-cache.test.ts`
- **Action**: CREATE
- **Implement**:
  - Use `createMemoryStore()` to keep tests hermetic.
  - Cases:
    - `read` on empty store → `missing`.
    - `write` then `read` returns the same payload with `fetchedAt` echoed.
    - Tampered JSON (`store.setItem(key, 'not-json')`) → `malformed-json`.
    - Wrong shape (e.g. missing `current`) → `invalid-shape`.
    - Wrong version (`version: 0`) → `version-mismatch`.
    - Two different coords write to two distinct keys.
- **Mirror**: `src/locations/env.test.ts:18-198` (boundary-error coverage)
- **Validate**: `npm test`

### Task 5: Freshness helpers

- **File**: `src/storage/freshness.ts`
- **Action**: CREATE
- **Implement**:
  - `STALE_THRESHOLD_MS = 30 * 60 * 1000`.
  - `isStale(ageMs): boolean` — true iff `ageMs >= STALE_THRESHOLD_MS`.
  - `formatLastUpdated(ageMs): string` — human-friendly stamp:
    - `< 60 s` → `"Just now"`
    - `< 60 min` → `"Updated Nm ago"` (singular `1m`)
    - `< 24 h` → `"Updated Nh ago"`
    - else → `"Updated Nd ago"`
    - `ageMs < 0` (clock skew) → treat as `0` → `"Just now"`
    - `!Number.isFinite(ageMs)` → `"Updated —"` (defensive, no crash)
  - Pure functions, no DOM, no `Date.now()` calls — accept `ageMs` directly so the caller controls the clock.
- **Mirror**: `src/ui/format.ts:1-35` (pure formatters, defensive on NaN/Infinity)
- **Validate**: `npx tsc --noEmit`

### Task 6: Freshness tests

- **File**: `src/storage/freshness.test.ts`
- **Action**: CREATE
- **Implement**: each branch of `formatLastUpdated` + `isStale` (boundary at exactly 30 min).
- **Mirror**: `src/ui/format.test.ts`
- **Validate**: `npm test`

### Task 7: SWR orchestrator

- **File**: `src/storage/swr.ts`
- **Action**: CREATE
- **Implement**:
  - Public function:
    ```ts
    interface SlotForecast {
      readonly location: Location;
      readonly forecast: ForecastResponse | null;
      readonly fetchedAt: number | null; // ms since epoch, or null if never fetched
    }
    interface SwrOptions {
      readonly fetchImpl?: typeof fetch;
      readonly now?: () => number;       // injected clock (tests use a fake)
      readonly isOnline?: () => boolean; // injected for tests; default reads navigator.onLine
    }
    interface SwrResult {
      readonly initial: readonly SlotForecast[]; // from cache (or null forecast if never cached)
      readonly refresh: () => Promise<readonly SlotForecast[]>; // resolves to refreshed slots
    }
    function loadCachedThenRefresh(
      locations: readonly Location[],
      cache: ForecastCache,
      opts?: SwrOptions,
    ): SwrResult;
    ```
  - Synchronous cache reads → `initial` array. `refresh()` triggers `Promise.allSettled(fetchForecast …)` in parallel, updates the cache per slot on success, and resolves with the merged slot array (kept old cache for failed slots — graceful degradation).
  - `refresh()` honours `isOnline()` — if explicitly `false`, it skips fetching and resolves with `initial`. Default `navigator.onLine` (truthy in tests/jsdom — fine, just means we try and the injected fetch decides the outcome).
  - Per-slot console at boundary: `console.info` on cache hit, `console.info` on fetch start, `console.warn` on fetch failure, `console.info` on cache write.
  - Imports allowed: `weather/types`, `weather/open-meteo-client`, `locations/types`, `./forecast-cache`, `./types`. Forbidden: `ui/`.
- **Mirror**: `src/main.ts:82-108` (Promise.allSettled per-slot isolation pattern).
- **Validate**: `npx tsc --noEmit`

### Task 8: SWR orchestrator tests

- **File**: `src/storage/swr.test.ts`
- **Action**: CREATE
- **Implement**:
  - All cases use a `createMemoryStore()` + `createForecastCache(store)` + injected `now` + injected `fetchImpl`.
  - Cases:
    1. Cold start (empty cache) + offline (`isOnline: () => false`) → `initial` has `forecast: null` for every slot; `refresh()` resolves the same without calling fetch.
    2. Cold start + online → `initial` is null-forecast; `refresh()` populates cache and resolves with all slots.
    3. Warm cache + offline → `initial` returns the cached forecasts with their `fetchedAt`; `refresh()` short-circuits.
    4. Warm cache + online + partial fetch failure (Beta → 404) → `initial` from cache; refreshed → Alpha updated, Beta keeps old cached entry (no blank).
    5. Cache shape corruption (e.g. wrong version) → treated as cold (forecast: null) but does not throw.
- **Mirror**: `src/main.test.ts:32-122`
- **Validate**: `npm test`

### Task 9: Storage barrel

- **File**: `src/storage/index.ts`
- **Action**: CREATE
- **Implement**: `export` the public surface — `createForecastCache`, `createLocalStorageStore`, `createMemoryStore`, `loadCachedThenRefresh`, `formatLastUpdated`, `isStale`, `STALE_THRESHOLD_MS`, and the types `SlotForecast`, `SwrResult`, `KeyValueStore`, `CacheEntry`, `CacheReadResult`.
- **Validate**: `npx tsc --noEmit`

### Task 10: UI — render the "Updated N ago" stamp

- **File**: `src/ui/app.ts`
- **Action**: UPDATE
- **Implement**:
  - Extend `AppItem` with optional `lastUpdatedLabel?: string` (computed by the caller from `fetchedAt` and `now`). UI does not know about epoch times.
  - In `buildListView`, after the header `<h1>Weather</h1>`, render `<p class="last-updated">{label}</p>` if a label is provided. Pick the OLDEST stamp across all items to display globally (per AC: a single global stamp on the list view). If no items have a label (all empty cache), omit the element entirely.
  - Keep using `textContent` (CLAUDE.md > Security).
- **Mirror**: `src/ui/card.ts:43-67` (DOM construction with textContent only).
- **Validate**: `npx tsc --noEmit`

### Task 11: UI — minimal style for the stamp

- **File**: `src/ui/styles.css`
- **Action**: UPDATE
- **Implement**: tiny rule for `.last-updated` — small muted text, right-aligned in the header. Keep additions <10 lines to avoid hot-spot contention with #9.
- **Validate**: visual (deferred — owner runs `npm run preview` in real iOS Safari).

### Task 12: UI tests

- **File**: `src/ui/app.test.ts`
- **Action**: UPDATE
- **Implement**:
  - Add a case that passes `AppItem`s with a `lastUpdatedLabel` and asserts the `.last-updated` element renders with that text.
  - Add a case with no labels — assert the element is absent.
- **Validate**: `npm test`

### Task 13: Main wiring — SWR + visibilitychange

- **File**: `src/main.ts`
- **Action**: UPDATE
- **Implement**:
  - Replace direct `fetchAllForecasts` with the SWR flow:
    1. Build `ForecastCache` (localStorage adapter; memory fallback when storage unavailable).
    2. Call `loadCachedThenRefresh(locations, cache, { fetchImpl })`.
    3. Map `initial` → `AppItem[]` and render immediately (cache-first paint). Compute the global "Updated N ago" label from the OLDEST `fetchedAt` across items that have one.
    4. Kick off `refresh()` — when it resolves, recompute items + label and re-render.
  - Add a single `visibilitychange` listener on `document`:
    - When `document.visibilityState === 'visible'`, check the oldest `fetchedAt`. If `isStale(now - oldestFetchedAt)` and `navigator.onLine`, call the orchestrator's `refresh()` again. Guard against concurrent refreshes (a tiny `inFlight` boolean).
    - Listener is registered once at bootstrap; remove logic is not needed (page lifetime).
  - Keep `bootstrap` exported + testable. Add a `documentImpl?` option (defaults to `document`) so the test can dispatch a fake visibility event into an injected document-like stub. Same with `isOnline?` and `now?` and `cacheStore?: KeyValueStore` (for tests).
  - Scoping: do NOT touch anything related to slot management (issue #9 territory). Only the SWR data flow.
- **Mirror**: `src/main.ts:50-76` for the bootstrap signature; `src/sw-register.ts:35-46` for the never-throw browser-API guard.
- **Validate**: `npx tsc --noEmit && npm run lint && npm test`

### Task 14: Main tests — cache-first render + visibility refresh

- **File**: `src/main.test.ts`
- **Action**: UPDATE
- **Implement**:
  - Add a test that pre-populates the cache via an injected `KeyValueStore` containing a valid CacheEntry for Alpha, then calls `bootstrap` with `fetchImpl` that NEVER resolves (or is never called when offline). Assert Alpha's card renders the cached forecast immediately and the "Updated …" stamp shows up.
  - Add a test that drives a `visibilitychange` flow: warm cache older than 30 minutes (use injected `now` returning two distinct values), online → bootstrap completes → simulate `visibilitychange` → assert the injected `fetchImpl` was called a second time.
- **Mirror**: `src/main.test.ts:32-122`
- **Validate**: `npm test`

---

## Validation

```bash
npm run lint
npx tsc --noEmit
npm test
```

| Verification | Runs in env? | If blocked: where/when verified |
|--------------|--------------|---------------------------------|
| Lint (ESLint) | yes | n/a |
| Type check (tsc --noEmit) | yes | n/a |
| Unit tests (vitest, jsdom) | yes | n/a |
| `npm run build` (Vite bundle) | yes — keep clean | n/a |
| Real iOS PWA install + airplane-mode open | NO (sandbox) | Owner runs on iPhone (CLAUDE.md > Sandbox-blocked checks) |
| 7-day iOS eviction long-poke check | NO (week-long observation) | Owner — defer-and-record per issue body |

---

## Risks

| Risk | Mitigation |
|------|------------|
| `localStorage` unavailable (Safari private / SSR) | KV-store wrapper detects and falls back to in-memory. Whole app keeps working with degraded freshness. |
| Quota exceeded (unlikely at ~6 slots, defensive) | KV-store wrapper swallows + logs; nothing throws. |
| Stale cache after schema change | `CACHE_VERSION` constant; mismatched version → treated as `missing` (graceful refetch). |
| Concurrent refresh on rapid visibilitychange flicker | `inFlight` guard in main; `refresh()` itself is also idempotent at the cache level (last write wins). |
| `main.ts` is a hot-spot shared with #9 | Edits scoped to the data-flow section only (no slot-management code). Owner reconciles at merge. |
| `.last-updated` style colliding with #9 styles | Single, well-named class; <10 lines of CSS; appended at end of file. |

---

## Acceptance Criteria (from issue #7)

- [ ] Offline open → cached data + "Updated N ago" stamp; never a blank screen.
- [ ] Online start → cache renders in <2 s; parallel fetches; UI + cache updated; stamp resets.
- [ ] `visibilitychange` → if data older than 30 min and online → refresh.
- [ ] Fetch failure after retries → keep cached UI + stamp; no error overlay.
- [ ] Unit tests cover age calculation, stamp formatting, cache merge.
- [ ] All tasks completed; type check, lint, tests all green.
- [ ] Defer-and-record: real-device offline tests recorded for owner.
