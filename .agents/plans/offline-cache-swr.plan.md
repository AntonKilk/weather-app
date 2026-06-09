# Plan: Offline data cache + stale-while-revalidate

## Summary

Make every app open render last-known forecasts instantly (including in
airplane mode) with an honest "Updated N min/h/d ago" stamp, then quietly
revalidate from Open-Meteo and swap in the fresh data. We add a typed
on-device **forecast cache** (`src/storage/forecast-cache.ts`, localStorage
backed, abstracted behind a small interface so an IndexedDB swap is cheap
later — STORY-009 territory), a pure **staleness formatter**
(`src/storage/staleness.ts`) for the timestamp display + the 30-minute
freshness threshold from the PRD, and a small **SWR orchestrator**
(`src/storage/revalidate.ts`) that the entry point composes with the
existing `loadForecasts` (STORY-005). The home-screen render flow gains a
per-slot `fetchedAt` so each card prints its own stamp; degraded cards
still render their cached forecast when the cache has one, only falling
back to "No data" when neither cache nor live fetch produced anything.
`main.ts` wires it together: hydrate from cache → paint → revalidate in
the background → merge + re-render; a `visibilitychange` listener kicks
the same revalidate when the page returns to view AND data is older than
30 minutes AND the browser is online.

Runtime caching of the Open-Meteo HTTP responses through Workbox is
**deliberately not** the approach here — Workbox HTTP-cache hides the
"how old is this slot" signal we need to show on screen. We cache the
parsed `ForecastResponse` per slot at the application layer, where the
freshness stamp is a first-class field.

## User Story

As a user, I want every open of the app to instantly show the most
recent weather I've seen for every location — even offline — with an
honest "last updated" stamp, and then to quietly catch up to fresh data
when I have a connection.

## Metadata
| Field | Value |
|-------|-------|
| Type | NEW_CAPABILITY (Phase 3, second half) |
| Complexity | LARGE |
| GitHub Issue | #7 (STORY-007) |
| PRD | `.agents/PRDs/offline-weather-pwa.prd.md` — Phase 3 (PWA + offline) |
| Stories | `.agents/stories/offline-weather-pwa.stories.md` → STORY-007 |
| Branch | `claude/beautiful-keller-i9r0ta` |
| Blocked by | STORY-005 (merged), STORY-006 (merged) |
| Blocks | STORY-010 (deploy / final offline check) |

---

## Patterns to follow

| Category | File:lines | Pattern |
|----------|-----------|---------|
| LAYERING | `CLAUDE.md` › Architecture | `ui → app services → api/storage → domain`. `src/storage/` may import `src/weather/types.ts` (forecast shape only) and `src/locations/types.ts` (slot id type), MUST NOT import anything from `src/ui/`, `src/weather/open-meteo-client.ts`, or `src/sw/`. `main.ts` is the only wiring point that touches all layers. |
| RESULT TYPE | `src/weather/open-meteo-client.ts:8-17`; `src/locations/default-locations.ts:12-19` | Discriminated-union results for cache I/O: `ReadResult<T> = { ok: true; data: T } \| { ok: false; reason: CacheReadFailure }`. Write returns a `WriteResult = { ok: true } \| { ok: false; reason: CacheWriteFailure }`. No `any`, no thrown exceptions across the cache boundary. |
| DEPS INJECTION | `src/sw/register.ts:17-27`; `src/weather/load-forecasts.ts:12-19`; `src/weather/open-meteo-client.ts:19-24` | Each public function accepts an optional `Deps` object whose fields default to the real implementations. Tests inject in-memory stubs. NEVER touch `globalThis.localStorage` directly inside business logic — go through the injected store. |
| NAMING | `CLAUDE.md` › Code Patterns | Files kebab-case (`forecast-cache.ts`, `staleness.ts`, `revalidate.ts`); types PascalCase (`CachedSlot`, `CacheSnapshot`); functions camelCase (`readForecastCache`, `formatLastUpdated`). Domain-first names — not `LocalStorageHelper`, not `WeatherCacheService`. |
| ERROR HANDLING | `CLAUDE.md` › Error handling; `src/weather/load-forecasts.ts:32-42` | Showing stale data IS the happy path, not an error state. Per CLAUDE.md: "UI must distinguish 'offline, showing stale data' (normal state, show stamp) from 'no data at all for this slot' (error state)." Revalidation failure NEVER blanks the screen — keep last cache, log at the boundary, keep the existing stamp. |
| TYPES | `src/weather/types.ts:5-36`; `src/locations/types.ts:5-12` | All cached fields explicitly modelled; validate at the storage boundary so that anything past the cache read is trusted. No `unknown` leaks past the cache module. |
| TESTS | `src/weather/load-forecasts.test.ts:1-30`; `src/locations/default-locations.test.ts`; `src/sw/register.test.ts:1-30` | Vitest, no globals; `import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';`. Inject all stores/clocks. Use in-memory `Storage`-shaped stubs — do NOT rely on jsdom's localStorage being clean between tests (use `beforeEach` cleanup). |
| OBSERVABILITY | `CLAUDE.md` › Observability; `src/weather/open-meteo-client.ts:83-86`; `src/weather/load-forecasts.ts:36-40` | `console.info`/`warn`/`error` at storage boundaries with `[cache]` / `[revalidate]` prefix and the slot id/name in context. No analytics. |
| SECURITY | `CLAUDE.md` › Security; `src/ui/location-card.ts:23-50` | Cached values are author-controlled JSON we wrote ourselves — but we still narrow them with explicit type guards on read (defense against any tampering / future schema mismatch). Render via `textContent`, never `innerHTML`. |
| FAULT TOLERANCE | `CLAUDE.md` › Fault tolerance; `src/weather/open-meteo-client.ts:73-87` | Per-slot isolation: revalidate fetches go in parallel; one failure does not affect others (already true via `loadForecasts`). Cache writes wrap localStorage in try/catch — a quota or private-mode failure must NEVER throw past the cache module. |
| HOTSPOTS (no concurrent work) | `CLAUDE.md` › Orchestration | `src/main.ts`, `src/ui/styles.css`, `src/ui/home-screen.ts`, `src/ui/location-card.ts`. Orchestrator must not run STORY-008/009 (custom slots — also touch main.ts + location-card) concurrently with this one. |

---

## Public contracts

### `src/storage/forecast-cache.ts` (CREATE)

```ts
import type { ForecastResponse } from '../weather/types';

// One slot's cached payload — last-known good forecast + when we got it.
// `fetchedAt` is milliseconds since the Unix epoch (Date.now()).
export interface CachedSlot {
  forecast: ForecastResponse;
  fetchedAt: number;
}

// Snapshot of every cached slot, keyed by `LocationSlot.id`.
export type CacheSnapshot = Record<string, CachedSlot>;

export type CacheReadFailure =
  | { kind: 'absent' }
  | { kind: 'unsupported' }   // localStorage not available (e.g., Safari private mode)
  | { kind: 'corrupt'; message: string }
  | { kind: 'wrong-version'; found: number };

export type CacheWriteFailure =
  | { kind: 'unsupported' }
  | { kind: 'quota'; message: string }
  | { kind: 'unknown'; message: string };

export type ReadResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: CacheReadFailure };

export type WriteResult =
  | { ok: true }
  | { ok: false; reason: CacheWriteFailure };

// Minimal Storage surface we depend on — lets tests inject an in-memory map.
export interface CacheStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ForecastCache {
  read(): ReadResult<CacheSnapshot>;
  writeSlot(slotId: string, slot: CachedSlot): WriteResult;
  // Used by STORY-009 to evict custom slots; included now to keep the API stable.
  removeSlot(slotId: string): WriteResult;
  clear(): WriteResult;
}

export interface CreateForecastCacheDeps {
  store?: CacheStore | null;        // null = unsupported; default = globalThis.localStorage
  key?: string;                     // default = 'weather-cache.v1'
  version?: number;                 // default = CACHE_VERSION
}

export const CACHE_KEY = 'weather-cache.v1';
export const CACHE_VERSION = 1;

export function createForecastCache(deps?: CreateForecastCacheDeps): ForecastCache;
```

Behaviour:

- **Storage shape on disk** (one JSON document under `CACHE_KEY`):
  ```json
  {
    "version": 1,
    "slots": {
      "default-0": { "forecast": { ... ForecastResponse ... }, "fetchedAt": 1717760000000 }
    }
  }
  ```
- `read()`:
  - if `store === null` or `typeof store?.getItem !== 'function'` → `{ ok: false, reason: { kind: 'unsupported' } }`;
  - if `getItem` returns `null` → `{ ok: false, reason: { kind: 'absent' } }`;
  - else `JSON.parse`; on throw → `{ ok: false, reason: { kind: 'corrupt', message } }` + `console.warn('[cache] corrupt — discarding', message)`;
  - if `parsed.version !== version` → `{ ok: false, reason: { kind: 'wrong-version', found } }` (treated as absent by callers; we don't auto-migrate — STORY-007 sets v1);
  - per-entry guard: drop entries that fail the `ForecastResponse` shape check (re-use the narrowing rules from `src/weather/open-meteo-client.ts:143-296` — re-export a `narrowForecastResponse(raw): ForecastResponse | null` from `open-meteo-client.ts` OR inline the same shape checks. **Decision: inline** — keeps `storage/` from importing the network client and avoids cycle risk).
- `writeSlot(slotId, slot)`:
  - read-modify-write: re-read the doc (a separate cache write may have happened from another tab), merge the slot, `JSON.stringify`, `setItem`.
  - `setItem` throw → classify: `DOMException` with `name === 'QuotaExceededError'` → `{ kind: 'quota' }`; else `{ kind: 'unknown' }`. Log `console.warn('[cache] write failed', slotId, reason)`. Never throw.
- `removeSlot(slotId)` / `clear()` — same wrapping pattern; `clear()` calls `removeItem`.

Defaults: `store = (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) ? globalThis.localStorage : null`.

### `src/storage/staleness.ts` (CREATE)

```ts
// Threshold from the PRD: revalidate on visibilitychange when cache is older.
export const REVALIDATE_THRESHOLD_MS = 30 * 60 * 1000; // 30 min

export type Stamp = string; // "Just now" | "Updated 5 min ago" | "Updated 2 h ago" | "Updated 3 d ago"

// Pure: same `now` + `fetchedAt` always produce the same string.
export function formatLastUpdated(now: number, fetchedAt: number): Stamp;

// True when the cache entry is older than `thresholdMs` (defaults to REVALIDATE_THRESHOLD_MS).
export function isStale(now: number, fetchedAt: number, thresholdMs?: number): boolean;

// True when at least one slot is stale (or missing entirely).
export function anyStale(
  now: number,
  snapshot: Record<string, { fetchedAt: number }>,
  slotIds: readonly string[],
  thresholdMs?: number,
): boolean;
```

Formatter spec (exhaustive, English UI, no Intl required):

| Age (ms) | Output |
|----------|--------|
| `< 60_000` (under 1 min) | `Just now` |
| `< 60 * 60_000` | `Updated ${minutes} min ago` (floor) |
| `< 24 * 3600_000` | `Updated ${hours} h ago` (floor) |
| `else` | `Updated ${days} d ago` (floor) |

Edge cases:
- `fetchedAt > now` (clock skew) → treat age as `0` → `Just now`.
- `fetchedAt` not finite → return `''` (caller falls back to no stamp).

### `src/storage/revalidate.ts` (CREATE)

```ts
import type { LocationSlot } from '../locations/types';
import type { ForecastResponse } from '../weather/types';
import type { FetchResult } from '../weather/open-meteo-client';
import type { CachedSlot, CacheSnapshot, ForecastCache } from './forecast-cache';

export type Fetcher = (lat: number, lon: number) => Promise<FetchResult<ForecastResponse>>;

export interface RevalidateDeps {
  cache: ForecastCache;
  fetchForecast: Fetcher;
  now?: () => number;       // default: Date.now
  // online?: () => boolean — only used by main.ts for the visibility gate; revalidate itself always tries.
}

export interface RevalidateResult {
  // Snapshot AFTER this cycle (cache + freshly fetched merged).
  snapshot: CacheSnapshot;
  // Slot ids that were successfully refreshed this cycle.
  refreshed: readonly string[];
  // Slot ids that failed (still served from cache if present).
  failed: readonly string[];
}

// Reads the current cache, then fetches every slot in parallel, then writes
// successes back and returns the merged snapshot. Never throws.
export async function revalidate(
  slots: readonly LocationSlot[],
  deps: RevalidateDeps,
): Promise<RevalidateResult>;
```

Behaviour:

- Per-slot fetch is independent (`Promise.all`); fetch failure for slot X never affects slot Y. (Existing invariant on `loadForecasts` carries over.)
- On per-slot success: `cache.writeSlot(slot.id, { forecast, fetchedAt: now() })` (write happens before the merge so an in-flight tab navigation still gets the fresh data).
- On per-slot failure: do NOT touch the cache entry — the old `fetchedAt` stays; the stamp keeps ageing honestly.
- Final `snapshot` is read once at the end via `cache.read()`; if read returns `{ ok: false, reason: 'absent' }` (first-ever run, all fetches failed), return an empty snapshot.
- Console-log at the boundary: `console.info('[revalidate] start', slots.length)`, `console.info('[revalidate] done', { refreshed: N, failed: M })`. Per-slot failures are already warned by `loadForecasts`-style code; we don't duplicate.

### `src/ui/location-card.ts` (UPDATE)

Add a per-card stamp line. New optional argument; no breaking change for tests that haven't been updated yet (default = no stamp).

```ts
// Existing signature for back-compat with callers we don't touch in this story:
export function renderLocationCard(slot: LocationSlot, forecast: ForecastResponse): HTMLElement;

// Preferred from STORY-007 onward:
export function renderLocationCard(
  slot: LocationSlot,
  forecast: ForecastResponse,
  stamp?: string,
): HTMLElement;

// renderDegradedCard accepts an optional stamp too (e.g., the slot has a cached
// forecast but no fresh fetch — show the stamp on the cached card; if no cache
// either, no stamp).
export function renderDegradedCard(slot: LocationSlot, stamp?: string): HTMLElement;
```

DOM: inside `.location-card__body`, after `.location-card__meta`, append a `<span class="location-card__updated">` with `textContent = stamp` when `stamp !== undefined && stamp !== ''`. Same on degraded cards (when there IS cached data — so the user sees how old it is; if both cache + fetch are empty, no stamp, just "No data").

### `src/ui/home-screen.ts` (UPDATE)

Add an optional `lastUpdated` map alongside the existing `forecasts`. Card rendering passes the stamp through.

```ts
export function renderHomeScreen(
  slots: LocationSlot[],
  forecasts: Record<string, ForecastResponse>,
  lastUpdated?: Record<string, number | undefined>,
  nowMs?: number,                // default: Date.now() — injectable for tests
): HTMLElement;
```

Behaviour:
- For each slot, if `lastUpdated?.[slot.id]` is a finite number → compute `stamp = formatLastUpdated(nowMs, fetchedAt)` and pass into the card.
- Detail view unchanged in this story (no per-detail stamp yet — kept tight). Stamp lives on the card.
- The existing expand/collapse logic is unchanged.

### `src/main.ts` (UPDATE — hotspot, single-issue edit)

New bootstrap flow:

1. Parse `VITE_DEFAULT_LOCATIONS` (existing).
2. **`cache.read()`** → derive `forecasts` + `lastUpdated` from `snapshot`.
3. Paint immediately: `root.replaceChildren(renderHomeScreen(slots, cachedForecasts, lastUpdated, Date.now()), renderFooter())`. This is the < 2 s offline guarantee — paints from cache before any network.
4. Kick off `revalidate(slots, { cache, fetchForecast, now: Date.now })`. On resolve, re-derive the snapshot → re-render the home screen (same `replaceChildren`). If the cycle returns no refreshed slots AND no cached slots either, fall back to the existing empty/loading messages.
5. Add a single module-level `document.addEventListener('visibilitychange', …)` that, when `document.visibilityState === 'visible'`, checks `anyStale(Date.now(), snapshot, slots.map(s => s.id))` AND `navigator.onLine !== false` → triggers another revalidate cycle, re-renders on completion. Guard with an in-flight boolean so back-to-back focus events don't stack.
6. SW registration call stays exactly where it is (`registerServiceWorker()`); paint never waits on it.

Layering rule: `main.ts` is the wiring point — it's allowed to import from `storage/`, `weather/`, `locations/`, `ui/`. Cache+revalidate are app-service altitude and DO NOT import `ui/`.

### `src/ui/styles.css` (UPDATE — hotspot, append only)

Add (no edits to existing rules):

```css
.location-card__updated {
  margin-top: 4px;
  font-size: 0.72rem;
  color: var(--muted);
}
```

That's it — no new layout, no new tokens. The stamp is a small secondary line beneath the existing meta row.

---

## Files to change

| File | Action | Purpose |
|------|--------|---------|
| `src/storage/forecast-cache.ts` | CREATE | Typed cache: read/writeSlot/removeSlot/clear, localStorage-backed, injectable. |
| `src/storage/forecast-cache.test.ts` | CREATE | Unit tests: read absent/corrupt/wrong-version/unsupported, write+merge, quota, removeSlot/clear. |
| `src/storage/staleness.ts` | CREATE | `formatLastUpdated`, `isStale`, `anyStale`, `REVALIDATE_THRESHOLD_MS`. |
| `src/storage/staleness.test.ts` | CREATE | Unit tests for stamp formatting (boundaries) + staleness flag + anyStale. |
| `src/storage/revalidate.ts` | CREATE | SWR orchestrator: read cache → parallel fetch → writeSlot per success → return merged snapshot. |
| `src/storage/revalidate.test.ts` | CREATE | Unit tests: full success, partial failure, all-fail keeps cache, per-slot write, never throws. |
| `src/ui/location-card.ts` | UPDATE | Render optional `Updated …` stamp on both normal + degraded cards. (Hotspot.) |
| `src/ui/location-card.test.ts` | UPDATE | Add stamp-presence/absence assertions for normal + degraded variants. |
| `src/ui/home-screen.ts` | UPDATE | Accept `lastUpdated` + `nowMs` args; pass stamps into cards. (Hotspot.) |
| `src/ui/home-screen.test.ts` | UPDATE | Add cases for stamp rendering + degraded-with-cache + degraded-without-cache. |
| `src/ui/styles.css` | UPDATE | Append `.location-card__updated` rule. (Hotspot — append-only.) |
| `src/main.ts` | UPDATE | Wire cache → paint → revalidate → re-render + `visibilitychange` SWR. (Hotspot.) |
| `.agents/reports/offline-cache-swr-report.md` | CREATE | Implementation report (Phase 6A). |

Counts: **7 CREATE**, **6 UPDATE**, **0 DELETE**.

**NOT touched** (deliberate):

- `vite.config.ts` — runtime caching of Open-Meteo via Workbox is deliberately NOT used (stamp visibility requires app-layer cache). The `navigateFallbackDenylist` already keeps cross-origin requests out of SW navigation, so cache layering is clean.
- `src/weather/load-forecasts.ts` — `revalidate` calls `fetchForecast` directly (one less indirection). The existing `loadForecasts` stays — it's still used in tests and as a model. We don't delete it (no caller harm), but `main.ts` will switch to `revalidate`.
- `src/weather/open-meteo-client.ts` — unchanged. Cache narrowing duplicates the shape checks intentionally (avoid storage→network import).
- `src/sw/register.ts` — unchanged.
- `index.html`, `public/` — unchanged.

---

## Tasks

Execute in order. Each task is atomic and verifiable. Run the validation
command from CLAUDE.md (`npm run lint && npx tsc --noEmit && npm test`)
after every task or batch where the file count justifies it.

### Task 1: Staleness module — `src/storage/staleness.ts`

- **File**: `src/storage/staleness.ts`
- **Action**: CREATE
- **Implement** per "Public contracts › `staleness.ts`":
  - Export `REVALIDATE_THRESHOLD_MS = 30 * 60 * 1000`.
  - Export `formatLastUpdated(now, fetchedAt): string` with the table above.
  - Export `isStale(now, fetchedAt, thresholdMs = REVALIDATE_THRESHOLD_MS): boolean` — returns `true` when `now - fetchedAt >= thresholdMs`.
  - Export `anyStale(now, snapshot, slotIds, thresholdMs?)` — returns `true` when ANY slotId is missing from the snapshot OR its entry is stale. (A missing slot is "infinitely stale" → forces revalidate.)
  - Guards: `Number.isFinite(fetchedAt)` before subtraction; clamp negative ages to 0.
- **Mirror**: `src/ui/format.ts:1-21` (small pure formatters; no side effects).
- **Validate**: `npm run lint && npx tsc --noEmit`. (Tests come in Task 2.)

### Task 2: Staleness tests — `src/storage/staleness.test.ts`

- **File**: `src/storage/staleness.test.ts`
- **Action**: CREATE
- **Implement** — Vitest cases (≥ 14):
  1. `formatLastUpdated`: age 0 → `Just now`.
  2. age 30 s → `Just now` (under the 60 s boundary).
  3. age 59 s → `Just now`.
  4. age 60 s → `Updated 1 min ago` (boundary).
  5. age 5 min → `Updated 5 min ago`.
  6. age 59 min → `Updated 59 min ago`.
  7. age 60 min → `Updated 1 h ago` (boundary).
  8. age 23 h 59 min → `Updated 23 h ago`.
  9. age 24 h → `Updated 1 d ago` (boundary).
  10. age 3 d → `Updated 3 d ago`.
  11. clock skew: `fetchedAt > now` → `Just now`.
  12. `fetchedAt = NaN` → `''` (empty string fallback).
  13. `isStale` at exactly the threshold (`now - fetchedAt === threshold`) → `true`.
  14. `anyStale` — missing slot id forces `true`; all-fresh → `false`; one stale → `true`.
- **Test setup**: `import { describe, expect, it } from 'vitest';`. No DOM, no mocks.
- **Mirror**: `src/ui/format.test.ts` for the formatter style; `src/locations/default-locations.test.ts` for table-driven structure.
- **Validate**: `npm test` — all green; 14 new tests pass.

### Task 3: Forecast cache module — `src/storage/forecast-cache.ts`

- **File**: `src/storage/forecast-cache.ts`
- **Action**: CREATE
- **Implement** per "Public contracts › `forecast-cache.ts`":
  - Exports: `CachedSlot`, `CacheSnapshot`, `CacheReadFailure`, `CacheWriteFailure`, `ReadResult`, `WriteResult`, `CacheStore`, `ForecastCache`, `CreateForecastCacheDeps`, `CACHE_KEY`, `CACHE_VERSION`, `createForecastCache`.
  - Default `store` = `globalThis.localStorage` if present, else `null`. Treat `null` as "unsupported" (read returns `{ ok: false, reason: { kind: 'unsupported' } }`, all writes return `{ ok: false, reason: { kind: 'unsupported' } }`).
  - `read()` parses the doc, validates `version === CACHE_VERSION`, then **narrows every entry's `forecast` field with explicit type guards** (mirror `src/weather/open-meteo-client.ts:143-296` — same shape, inlined to avoid the network import). Entries that fail the guard are silently dropped + `console.warn('[cache] dropping malformed entry', slotId, reason)`. If the resulting snapshot is empty, still return `{ ok: true, data: {} }` (an empty snapshot is valid — first launch).
  - `writeSlot(id, slot)` — read-modify-write to preserve other slots; wrap `setItem` in try/catch; classify quota vs unknown; never throw.
  - `removeSlot(id)` — same read-modify-write minus the entry; if the resulting doc is empty, `removeItem(CACHE_KEY)` (keep storage tidy).
  - `clear()` — `removeItem(CACHE_KEY)`; wrap in try/catch.
- **Mirror**:
  - `src/weather/open-meteo-client.ts:143-296` for the narrowing helpers (inline, do not import).
  - `src/locations/default-locations.ts:21-65` for the discriminated-union `ReadResult` shape + table-driven parsing.
  - `src/sw/register.ts:17-27` for the `Deps` injectable surface.
- **Validate**: `npm run lint && npx tsc --noEmit`. (Tests come in Task 4.)

### Task 4: Forecast cache tests — `src/storage/forecast-cache.test.ts`

- **File**: `src/storage/forecast-cache.test.ts`
- **Action**: CREATE
- **Implement** — Vitest cases (≥ 14). Use an in-memory `CacheStore` stub:
  ```ts
  function memStore(): CacheStore & { snapshot(): Record<string,string> } {
    const m = new Map<string,string>();
    return {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => { m.set(k, v); },
      removeItem: (k) => { m.delete(k); },
      snapshot: () => Object.fromEntries(m),
    };
  }
  ```
  Cases:
  1. **Unsupported store** (`store: null`) → `read` returns `unsupported`; `writeSlot` returns `unsupported`; no throw.
  2. **Absent key** → `read` returns `absent`.
  3. **Corrupt JSON** → `read` returns `corrupt`; console.warn logged once.
  4. **Wrong version** → `read` returns `wrong-version` with `found` matching the on-disk value.
  5. **Malformed slot entry** (missing `forecast.current`) → `read` succeeds; that slot is dropped; other valid slots remain; warn logged with the slot id.
  6. **Round trip**: write one slot → read returns exactly that snapshot.
  7. **Merge**: write slot A, then write slot B → read returns both; on-disk doc contains both keys.
  8. **Overwrite**: write slot A twice → second write wins (latest `fetchedAt`).
  9. **removeSlot** removes the named slot, preserves others.
  10. **removeSlot** of the last slot deletes the key entirely.
  11. **clear()** removes the key.
  12. **Quota classification**: `setItem` throws `DOMException` with `name='QuotaExceededError'` → write returns `{ kind: 'quota' }`; console.warn logged; no throw.
  13. **Unknown throw**: `setItem` throws plain `Error('disk full')` → write returns `{ kind: 'unknown' }`; never throws.
  14. **Default localStorage path**: with no `store` dep injected and jsdom's `localStorage` present, a write + read round-trips correctly (cleanup with `localStorage.clear()` in `beforeEach`/`afterEach`).
  15. **Use a recorded `ForecastResponse` fixture** — import `SAMPLE_FORECAST` from `src/weather/fixtures/open-meteo-forecast.fixture.ts` to keep the snapshot realistic.
- **Test setup**:
  - `import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';`
  - `beforeEach(() => { localStorage.clear(); });` (jsdom env).
  - Spy on `console.warn` only when asserted; restore in `afterEach`.
- **Mirror**: `src/locations/default-locations.test.ts` (table-driven); `src/weather/load-forecasts.test.ts:1-30` (vi-mock console + restore pattern).
- **Validate**: `npm test` — all green; 14+ new tests pass.

### Task 5: Revalidate orchestrator — `src/storage/revalidate.ts`

- **File**: `src/storage/revalidate.ts`
- **Action**: CREATE
- **Implement** per "Public contracts › `revalidate.ts`":
  - Single exported `async function revalidate(slots, deps): Promise<RevalidateResult>`.
  - Parallel fetch via `Promise.all(slots.map(s => deps.fetchForecast(s.latitude, s.longitude)))` — mirror `src/weather/load-forecasts.ts:26-28`.
  - Per slot: on `result.ok` → `cache.writeSlot(slot.id, { forecast: result.data, fetchedAt: now() })`; push slot id to `refreshed`; if write returns `!ok`, still keep the slot in `refreshed` (the in-memory snapshot below will still surface the new data via `read()` below — except writes failed; mitigate by also building an in-memory delta and returning it merged with the post-write `read()` so the UI sees fresh data even when the disk write failed).
  - **Critical**: when `writeSlot` fails (quota / unsupported), the caller MUST still see the fresh forecast in this cycle's `snapshot`. Implementation: build `delta: CacheSnapshot` from in-flight successes; final `snapshot = { ...cacheRead.data ?? {}, ...delta }`. If `cache.read()` returns `unsupported`, `cacheRead.data` is `{}` and `snapshot = delta`.
  - Per slot: on `!result.ok` → push to `failed`; log nothing here (the `fetchForecast` client already logged at boundary).
  - Boundary logs: `console.info('[revalidate] start', slots.length)` and `console.info('[revalidate] done', { refreshed: refreshed.length, failed: failed.length })`.
  - Never throws.
- **Mirror**: `src/weather/load-forecasts.ts:16-45` line-by-line (parallel fetch + per-slot result handling pattern); `src/sw/register.ts:38-58` (try/catch never-throws posture).
- **Validate**: `npm run lint && npx tsc --noEmit`. (Tests come in Task 6.)

### Task 6: Revalidate tests — `src/storage/revalidate.test.ts`

- **File**: `src/storage/revalidate.test.ts`
- **Action**: CREATE
- **Implement** — Vitest cases (≥ 7):
  1. **Empty slot list** → `{ snapshot: {}, refreshed: [], failed: [] }`; fetcher never called; cache.read called once.
  2. **All-success**: 3 slots, fetcher always `ok` → `refreshed.length === 3`; `failed.length === 0`; `snapshot` contains all 3 slots with `fetchedAt === now()`; `cache.writeSlot` was called 3 times with the correct ids.
  3. **Partial failure**: slot B's fetcher returns `{ ok: false, error: { kind: 'server', status: 503, message: 'HTTP 503' } }` → `refreshed = ['a','c']`; `failed = ['b']`; pre-existing cache entry for slot B (set up before the call) survives in the returned `snapshot` with its OLD `fetchedAt`.
  4. **All-fail**: every fetcher fails → `refreshed = []`; `failed = all`; existing cache entries are unchanged; `snapshot` equals the pre-cycle cache read.
  5. **Cache write failure is non-fatal**: stub `cache.writeSlot` to return `{ ok: false, reason: { kind: 'quota' } }` for one slot → `revalidate` still returns the slot in `snapshot` (via the in-memory delta) and still lists it in `refreshed`. Cycle does NOT throw.
  6. **Unsupported cache**: stub `cache.read()` to return `{ ok: false, reason: { kind: 'unsupported' } }`; with successful fetches → `snapshot` equals the in-memory delta from this cycle (the cycle still produces fresh data even on unsupported storage).
  7. **Parallelism**: gate-based test (mirror `load-forecasts.test.ts:75-98`) — assert all fetcher calls are in flight before any resolves.
  8. **Now() injection**: pass `now = () => 1_000_000` → every refreshed slot's `fetchedAt === 1_000_000`.
  9. **Never throws**: stub fetcher to return rejected promises (instead of typed `FetchResult`) and assert `revalidate` still resolves (defense in depth — though `fetchForecast` is contractually total).
- **Test setup**: in-memory `ForecastCache` stub (do NOT touch `localStorage` here; that's Task 4's territory):
  ```ts
  function memCache(initial: CacheSnapshot = {}): ForecastCache & { written: string[] } {
    const data: CacheSnapshot = { ...initial };
    const written: string[] = [];
    return {
      written,
      read: () => ({ ok: true, data }),
      writeSlot: (id, slot) => { data[id] = slot; written.push(id); return { ok: true }; },
      removeSlot: (id) => { delete data[id]; return { ok: true }; },
      clear: () => { for (const k of Object.keys(data)) delete data[k]; return { ok: true }; },
    };
  }
  ```
  Fetcher: `vi.fn<Fetcher>(...)`. Use `SAMPLE_FORECAST` fixture.
- **Mirror**: `src/weather/load-forecasts.test.ts:1-107`.
- **Validate**: `npm test` — 7+ new tests pass.

### Task 7: Update `renderLocationCard` + `renderDegradedCard` to print the stamp

- **File**: `src/ui/location-card.ts`
- **Action**: UPDATE (hotspot — single-issue edit)
- **Implement** per "Public contracts › `location-card.ts`":
  - `renderLocationCard(slot, forecast, stamp?)` — when `stamp !== undefined && stamp !== ''`, append a `<span class="location-card__updated">` with `textContent = stamp` into `.location-card__body` after `.location-card__meta`.
  - `renderDegradedCard(slot, stamp?)` — same stamp pattern; appended after `.location-card__status`. When `stamp` is undefined, render nothing extra (current behavior).
  - Use `textContent` (CLAUDE.md › Security).
- **Mirror**: `src/ui/location-card.ts:40-52` (existing `.meta` append pattern); `src/ui/footer.ts:9-14` (`textContent` only, no `innerHTML`).
- **Validate**: `npm run lint && npx tsc --noEmit`. Tests follow in Task 8.

### Task 8: Update `location-card.test.ts` for stamp coverage

- **File**: `src/ui/location-card.test.ts`
- **Action**: UPDATE
- **Implement** — add cases (≥ 4):
  1. `renderLocationCard(slot, forecast)` with no stamp arg → no `.location-card__updated` element exists.
  2. `renderLocationCard(slot, forecast, 'Updated 5 min ago')` → exactly one `.location-card__updated` exists, with that exact text.
  3. `renderDegradedCard(slot, 'Updated 3 h ago')` → exactly one `.location-card__updated` exists with that text; degraded class is still present.
  4. `renderDegradedCard(slot)` (no stamp) → no `.location-card__updated` element exists; `No data` status still rendered.
  5. **XSS guard**: stamp string containing HTML (`<img onerror=...>`) is rendered verbatim as text (`textContent`), not parsed (assert `el.innerHTML` is the escaped form).
- **Mirror**: existing assertions in `src/ui/location-card.test.ts` (read the file before editing to keep style consistent).
- **Validate**: `npm test` — all green.

### Task 9: Update `renderHomeScreen` to thread stamps through

- **File**: `src/ui/home-screen.ts`
- **Action**: UPDATE (hotspot — single-issue edit)
- **Implement** per "Public contracts › `home-screen.ts`":
  - New optional args: `lastUpdated?: Record<string, number | undefined>`, `nowMs?: number` (default `Date.now()`).
  - For each slot, compute `stamp` if `lastUpdated?.[slot.id]` is a finite number: `formatLastUpdated(nowMs, lastUpdated[slot.id]!)`. Pass into `renderLocationCard(slot, forecast, stamp)` OR `renderDegradedCard(slot, stamp)`.
  - **Degraded-with-cache behavior**: a slot may have a cached forecast but no `forecasts[slot.id]` if main.ts only passed live results. We want the home screen to FAVOR `forecasts[slot.id]` (the live merged snapshot). `main.ts` is responsible for merging cache + fresh into a single `forecasts` map before passing in — so `renderHomeScreen` itself stays simple. **Decision: the `forecasts` arg is the merged snapshot from `main.ts`. `renderDegradedCard` is only used when neither cache nor fresh has data for that slot.**
- **Mirror**: existing `src/ui/home-screen.ts:6-37` (one card+detail per slot loop); existing fault-isolation pattern (try/catch around card render).
- **Validate**: `npm run lint && npx tsc --noEmit`. Tests follow in Task 10.

### Task 10: Update `home-screen.test.ts`

- **File**: `src/ui/home-screen.test.ts`
- **Action**: UPDATE
- **Implement** — add cases (≥ 3) and adjust existing ones that explicitly assert "degraded text contains 'No data'" so they still pass:
  1. With `lastUpdated` providing a `fetchedAt` for every slot → each `.location-card` contains a `.location-card__updated` with the right text (compute expected via `formatLastUpdated`).
  2. With `lastUpdated` omitted entirely → no card has `.location-card__updated`. (Pre-existing tests should keep working — verify by running them.)
  3. With one slot missing from `forecasts` AND missing from `lastUpdated` → degraded card, no stamp (existing behavior preserved).
  4. With one slot missing from `forecasts` but **present** in `lastUpdated` (edge case: main.ts merged it in, but `forecasts[slot.id]` somehow undefined — should not happen in practice) → degraded card with stamp. Document the case as a defensive contract.
- **Mirror**: existing test patterns in the same file (mount, click, assertions).
- **Validate**: `npm test` — all green. Pre-existing 119+ tests still pass.

### Task 11: Append `.location-card__updated` rule to `styles.css`

- **File**: `src/ui/styles.css`
- **Action**: UPDATE (hotspot — append only, no edits to existing rules)
- **Implement**: append the CSS block from "Public contracts › `styles.css`" at the bottom of the file. Keep tokens (`var(--muted)`) consistent with the rest.
- **Mirror**: `src/ui/styles.css:130-142` (other small text utility rules).
- **Validate**: `npm run build` produces a CSS bundle that includes the new selector (grep `dist/assets/index-*.css`). `npm test` — passes (CSS isn't loaded in tests; just regression).

### Task 12: Wire SWR in `src/main.ts`

- **File**: `src/main.ts`
- **Action**: UPDATE (hotspot — single-issue edit)
- **Implement**:
  - New imports:
    ```ts
    import { createForecastCache } from './storage/forecast-cache';
    import { revalidate } from './storage/revalidate';
    import { anyStale, REVALIDATE_THRESHOLD_MS } from './storage/staleness';
    import { fetchForecast } from './weather/open-meteo-client';
    ```
    Drop the existing `import { loadForecasts } from './weather/load-forecasts';` (the file stays — tests still import it — but main no longer does).
  - `async function bootstrap(root)`:
    1. Parse env (existing).
    2. `const cache = createForecastCache();`
    3. `const initial = cache.read();` — derive `forecasts = mapValues(initial.data, e => e.forecast)` and `lastUpdated = mapValues(initial.data, e => e.fetchedAt)` (treat `!initial.ok` as empty maps).
    4. `let currentSnapshot: CacheSnapshot = initial.ok ? initial.data : {};`
    5. **First paint** — `render(root, slots, currentSnapshot);` (where `render` is a small helper inside main.ts that swaps children for `renderHomeScreen(slots, forecasts, lastUpdated) + renderFooter()`).
    6. Kick off revalidate (no `await` blocking the render):
       ```ts
       const cycle = await revalidate(slots, { cache, fetchForecast, now: Date.now });
       currentSnapshot = cycle.snapshot;
       render(root, slots, currentSnapshot);
       ```
       (The `await` here is fine — `bootstrap` is already async; the FIRST paint already happened before it.)
  - `visibilitychange` listener at module top-level (outside `bootstrap`, after the existing SW registration call):
    ```ts
    let revalidating = false;
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState !== 'visible' || revalidating) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      // Reach into the same module-scoped cache + slots. Or expose via a closure.
      // ...
    });
    ```
    **Decision**: rather than rely on module-scoped mutable state, refactor the entry so `bootstrap(root)` registers the listener itself (closure over `slots`, `cache`, `root`). Cleaner; tests don't depend on it.
  - When `bootstrap` enters the listener: check `anyStale(Date.now(), currentSnapshot, slots.map(s => s.id), REVALIDATE_THRESHOLD_MS)` AND online → set `revalidating = true`; run a new `revalidate` cycle; re-render; on completion set `revalidating = false`.
  - Layering check: main.ts may import from any layer (it's the wiring point). Verify with `grep` (see "Validation" below).
- **Mirror**: existing `src/main.ts:1-52` (bootstrap shape, error path, footer-always-present invariant); `src/sw/register.ts:38-58` (never-throws posture).
- **Validate**: `npm run lint && npx tsc --noEmit && npm test && npm run build`. The smoke test passes; build succeeds.

### Task 13: End-to-end verification + implementation report

- **Files**: `.agents/reports/offline-cache-swr-report.md` (CREATE), screenshots under `.agents/reports/screenshots/`.
- **Action**: CREATE
- **Implement**:
  1. Run the full validation suite (see "Validation" section) — all four commands exit 0.
  2. **Build + preview** with a sample env so SWR is exercised end-to-end (SW only registers on preview, per CLAUDE.md):
     ```bash
     VITE_DEFAULT_LOCATIONS='[
       {"name":"Sample-A","lat":60.0,"lon":24.0},
       {"name":"Sample-B","lat":59.4,"lon":24.7}
     ]' npm run build && npm run preview -- --port 5173
     ```
  3. Use the `agent-browser` skill to load `http://127.0.0.1:5173/` and:
     - **First load (online)**: assert two cards render; each has a `.location-card__updated` line within ~2 s; check `localStorage.getItem('weather-cache.v1')` is a JSON doc with `version: 1` and both slot ids.
     - **Refresh while online**: reload → cards appear effectively instantly; the stamp says `Just now` or close to it.
     - **Offline shell + cached data**: in DevTools → Network → "Offline"; hard-reload; assert both cards still render with last-known data and an honest stamp (e.g., `Updated 1 min ago`); no error toast.
     - **Visibility-stale path**: stub the clock by hand-editing `localStorage` to push `fetchedAt` backwards by 31 minutes (DevTools Console: `const c=JSON.parse(localStorage.getItem('weather-cache.v1')); for(const k in c.slots) c.slots[k].fetchedAt = Date.now()-31*60*1000; localStorage.setItem('weather-cache.v1', JSON.stringify(c));`), then switch the tab away and back. Assert a new fetch happens (DevTools Network panel shows a request to `api.open-meteo.com`) and the stamp resets.
     - **All-fail revalidate**: block `api.open-meteo.com` in DevTools (block request URL) → reload → cached cards render with their existing stamp; no error UI is shown; console has `[revalidate] done { refreshed: 0, failed: 2 }`.
     - Capture screenshots:
       - `offline-cache-swr-online-fresh.png` — fresh load, stamps visible.
       - `offline-cache-swr-offline-cached.png` — offline + cached cards visible with stamp.
       - `offline-cache-swr-after-revalidate.png` — stamp reset after refresh.
  4. **Write the implementation report** mirroring `.agents/reports/pwa-install-manifest-service-worker-report.md` exactly:
     - Summary, Tasks Completed table, Validation Evidence (paste outputs), Acceptance Criteria Mapping (per AC1–AC5), E2E Evidence with screenshot paths, Files Changed, Deviations from Plan, Tests Written, Re-verification recipe.
  5. **Defer-and-record** items (per CLAUDE.md › Sandbox-blocked checks):
     - **Real iPhone airplane-mode test on installed PWA**: owner runs the checklist on device (AC1 fully — only a real iOS PWA proves the iOS cache path; DevTools offline is a proxy).
     - **iOS 7-day eviction check**: owner doesn't open the PWA for a week, then checks offline → records whether storage survived (this is the open PRD question; the report flags it).
- **Owner manual checklist** (record in the report under "Defer-and-record"):
  ```
  □ On iPhone, install the deployed app via Add to Home Screen (STORY-006).
  □ Open the installed app once with network so cache is populated.
  □ Enable Airplane Mode → re-open → all 6 cards show with last-known data + stamp.
  □ Wait ~7 days without opening the app, then re-open offline → record whether
    cached data still renders (eviction probe).
  ```

---

## Risks

| Risk | Mitigation |
|------|------------|
| Re-rendering the whole home screen after revalidate collapses any card the user expanded between first paint and revalidate completion | Acceptable trade-off: revalidate completes in ~hundreds of ms; first paint happens before. The owner will not realistically expand a card in that window. If feedback says otherwise (STORY-010 demo), STORY-008 or a follow-up can add a finer-grained per-card update API. Documented as a known limitation. |
| Stamp text becomes inaccurate as time passes (cache rendered at T+0 still says "Just now" at T+10 min) | First-pass accepts this — every revalidate cycle re-renders. A periodic `setInterval(updateStamps, 60_000)` would refresh stamps in place; deferred unless the demo flags it. |
| `localStorage` unavailable (Safari private mode, iOS Lockdown profile, future iOS restrictions) | `createForecastCache({ store: null })` path returns `unsupported`; revalidate still fetches and renders; just no offline guarantee. Logged once at boundary. Test #1 covers this. |
| `localStorage` quota exceeded (very small budget — under 5 MB; payload ~6 × ~20 KB = ~120 KB so we're safe, but defensive nonetheless) | Quota error classified to `WriteResult { kind: 'quota' }`; revalidate still surfaces the fresh data in the in-memory delta; next cycle retries. CLAUDE.md observability log fires. |
| Schema drift between Open-Meteo response shape and the inlined narrowing in `forecast-cache.ts` (if `open-meteo-client.ts` evolves but `forecast-cache.ts` doesn't) | Tests in `forecast-cache.test.ts` import the SAME `SAMPLE_FORECAST` fixture as `load-forecasts.test.ts`. If the canonical fixture changes shape, both test suites flag it. Risk graded "low" — the `ForecastResponse` interface has been stable since STORY-002. |
| Two tabs racing on `writeSlot` (read-modify-write loses one slot) | Negligible — single-user, single-device, single-tab PWA. CLAUDE.md › Project Overview: "Single user, no accounts". Not worth a `StorageEvent` listener / mutex. |
| `visibilitychange` listener firing before bootstrap finishes (rapid focus changes during initial load) | `revalidating` boolean gate; if a cycle is already running, ignore the event. Listener registration happens AFTER first cycle is scheduled (inside `bootstrap`). |
| `navigator.onLine === false` false-negative (some networks report online while the request still fails) | We gate the visibility-triggered revalidate on `onLine !== false`, but the existing retry/backoff in `fetchForecast` (STORY-004) still handles transient failures correctly. Boolean is advisory, not authoritative. |
| Workbox SW (STORY-006) caches an old `/index.html` and the new SWR logic doesn't load on first refresh after this story ships | `workbox.skipWaiting: true` + `clientsClaim: true` in `vite.config.ts` (already set by STORY-006) forces the new SW to take over without a reload. Verified by the existing STORY-006 report. |
| Cache entries from a future schema version (downgrade scenario) | Reads with mismatched `version` return `wrong-version`; main.ts treats that as "no cache" and just re-fetches. No data is lost in the API — only the cached copy is ignored. |
| `home-screen.test.ts` pre-existing assertions on "expanded detail panel contains an hourly-chart svg" break when the new stamp is added | The stamp is a sibling INSIDE `.location-card`, not `.location-detail`. Detail selectors are unaffected. Re-running pre-existing tests in Task 10 validates. |
| `renderDegradedCard` signature change breaks existing call sites (only `renderHomeScreen`) | New `stamp` arg is OPTIONAL with no behavior change when omitted. Backwards-compat. Existing `home-screen` callers continue to work; only `main.ts` will be on the new path. |
| Hotspot collisions (`main.ts`, `home-screen.ts`, `location-card.ts`, `styles.css`) with other concurrent stories | Per CLAUDE.md › Orchestration: max parallel 3 + hotspot rule. STORY-008 (geocoding) and STORY-009 (custom slots) both touch `main.ts` and `location-card.ts`; orchestrator must not run them concurrently with this one. STORY-009 is blocked by THIS story per the stories doc; STORY-008 is independent and should land before OR after — not during. |
| Sandbox lacks a real browser, so visibility / offline / cache E2E only validates in `agent-browser` (Chromium), not iOS Safari | Per CLAUDE.md › Sandbox-blocked checks — real-device iPhone tests are defer-and-record. Task 13 documents owner's manual checklist explicitly. The Chromium proxy validates the logic; iOS-specific behavior (7-day eviction) is the owner's open question, called out in the PRD. |

---

## Validation

Run before declaring done — exact commands from CLAUDE.md › Commands / Validation:

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
```

All four exit 0.

Additional gates:

```bash
# Layering: storage may NOT import from ui or sw, and may NOT import the
# network client (open-meteo-client) directly:
! grep -nE "from '\.\./(ui|sw)" src/storage/*.ts
! grep -n  "from '\.\./weather/open-meteo-client" src/storage/*.ts
# (Storage imports from weather/types and locations/types are fine.)

# No real city names slipped in (regression-check the STORY-005 grep gate):
! grep -rE '(Lahti|Helsinki|Tallinn|Käsmu)' \
    src/storage src/ui src/main.ts src/vite-env.d.ts .env.example

# Build artifacts include the new stamp class:
grep -q 'location-card__updated' dist/assets/index-*.css

# Cache key sanity (no PII or location data hard-coded):
! grep -nE '"lat":\s*[1-9]' src/storage/*.ts
```

Browser-driven (agent-browser, Task 13):

- First paint < 2 s with cards rendered from cache.
- After revalidate, fresh stamps present and consistent.
- DevTools "Offline" + reload → cards still render with stamps.
- `localStorage['weather-cache.v1']` valid JSON, `version === 1`.

Deferred (CLAUDE.md › Sandbox-blocked — recorded, NOT failed):

- **Real-iPhone airplane-mode test on installed PWA** (AC1 fully).
- **iOS 7-day eviction probe** (open PRD question).
- **Real-iPhone visibility-triggered refresh** (sandbox proxies it; iOS lifecycle behaviour can subtly differ).

---

## Acceptance criteria

Issue #7 ACs → tasks/tests mapping (every AC maps to ≥ 1 task or test):

- [ ] **AC1** — Offline open shows all slots with last data + `Updated N h ago` stamp; screen never blank.
  → Task 3 (cache read), Task 7 (stamp on card), Task 9 (home-screen threads `lastUpdated`), Task 12 (main paints from cache BEFORE any fetch), Task 13 (agent-browser offline test). Real-iPhone airplane-mode is **defer-and-record (owner)**.

- [ ] **AC2** — Online start: cache renders < 2 s, parallel fetches go out, UI + cache update quietly, stamp resets.
  → Task 5 (`revalidate` is parallel + writes cache), Task 12 (paint-then-revalidate flow; second `render` swaps in fresh data), Task 13 (agent-browser timing + Network panel). Test #2 in Task 6 (all-success).

- [ ] **AC3** — `visibilitychange`: if data older than 30 min and online → background refresh.
  → Task 1 (`REVALIDATE_THRESHOLD_MS` + `isStale` / `anyStale`), Task 12 (visibilitychange listener with the 30-min gate + online gate + in-flight gate), Task 13 (agent-browser visibility scenario by hand-editing the cache timestamps).

- [ ] **AC4** — Update failure (offline / 5xx after retries) → cache + stamp stay, no error overlay.
  → Task 5 (per-slot failure does NOT touch cache), Task 12 (re-render uses the snapshot, no error UI surfaced), Test #3 + #4 in Task 6 (partial / all-fail). Task 13 (block API, observe no error UI).

- [ ] **AC5** — Unit tests cover staleness, stamp format, cache merge.
  → Task 2 (14+ cases on staleness + stamp), Task 4 (14+ cases on cache including write-merge), Task 6 (7+ cases on revalidate including merge and per-slot failure isolation).

Process gates:

- [ ] All tasks completed
- [ ] `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build` pass
- [ ] Zero new runtime dependencies (`package.json` `dependencies` stays empty)
- [ ] Zero new dev dependencies — Vitest + jsdom + existing toolchain is sufficient
- [ ] No `any`; lint = 0 errors, 0 warnings; no `// @ts-ignore`
- [ ] No `innerHTML`; all DOM text via `textContent` (Task 7 + Task 8 XSS test)
- [ ] `src/storage/` has no imports from `src/ui/`, `src/sw/`, or `src/weather/open-meteo-client.ts` (layering — verified by grep gate above)
- [ ] No real default-location names or coordinates anywhere in committed source (regression-check from STORY-005 still passes)
- [ ] First paint NEVER blocks on network — `main.ts` calls `render(...)` before any `await revalidate(...)` (Task 12)
- [ ] Revalidate failure does NOT modify cache for failed slots (Task 5 contract + Task 6 test #3)
- [ ] `revalidate` and `forecast-cache` never throw across module boundaries (Tests in Task 4 + Task 6)
- [ ] Sandbox-blocked checks recorded as defer-and-record — NOT treated as failures:
  - Real iPhone airplane-mode test on installed PWA (AC1 fully)
  - iOS 7-day eviction probe (open PRD question; called out in the report)
  - Real iPhone visibilitychange refresh path
- [ ] Issue #7 acceptance criteria → tasks/tests mapping above is complete
