# Plan: Custom slots — add, remove, persist

## Summary

Close the Phase-4 loop: turn the geocoding-autocomplete `onSelect` (which today
just `console.info`s the pick in `src/main.ts:33-38`) into a real "fill a custom
slot" action, surface a remove control on each custom card, and persist the
two-slot custom list to `localStorage` so it survives reload (including offline).
The default slots stay env-injected and immutable; only `kind: 'custom'` slots
are addable/removable, and the cap is two. When both custom slots are full, the
search input is hidden behind a small "Custom slots full — remove one to add
another" notice in `main.ts`. Architecture mirrors what already exists: pure
domain logic in `src/locations/custom-slots.ts` (capacity check, id derivation,
duplicate detection, `place → LocationSlot` mapping); IO in
`src/storage/custom-slots-store.ts` (a `createCustomSlotsStore` whose shape and
error taxonomy mirror `createForecastCache` in `src/storage/forecast-cache.ts`).
Removing a custom slot also drops its forecast cache entry via the existing
`cache.removeSlot(id)` (STORY-007). main.ts wires the four moving parts —
load → render → add → remove — and re-runs `revalidate` after any mutation so
the new slot's data is fetched and cached in the same SWR cycle as the defaults.

## User Story

As a user, I want two free slots where I can add a location from search and
remove it after the trip, so I can temporarily track weather in places I'm
travelling to.

## Metadata

| Field | Value |
|-------|-------|
| Type | NEW_CAPABILITY |
| Complexity | SMALL–MEDIUM (≈ STORY-005 in size; the heavy lifting — geocoding, cache, removeSlot — is already shipped) |
| GitHub Issue | #9 (STORY-009) |
| PRD | `.agents/PRDs/offline-weather-pwa.prd.md` — Phase 4 "Custom location slots" |
| Stories | `.agents/stories/offline-weather-pwa.stories.md` → STORY-009 |
| Branch | `claude/eager-wozniak-5apkd1` (per session instructions) |
| Blocked by | STORY-005 (`parseDefaultLocations`, merged), STORY-008 (`renderSearchInput`/`searchGeocoding`, merged) |
| Blocks | STORY-010 (deploy) |

---

## Patterns to follow

| Category | File:lines | Pattern |
|----------|-----------|---------|
| LAYERING | `CLAUDE.md` › Architecture | `src/locations/` = pure domain (no IO, no DOM, no `weather/` import). `src/storage/` = IO + shape narrowing (may depend on `locations/` types for type imports only). `src/ui/` may depend on either domain or storage TYPES, but never reaches back into `main.ts`. main.ts owns the wiring. |
| NAMING | `CLAUDE.md` › Code Patterns | Files kebab-case (`custom-slots.ts`, `custom-slots-store.ts`); types PascalCase (`CustomSlotsStore`, `AddSlotResult`); functions/vars camelCase (`canAddSlot`, `placeToSlot`, `createCustomSlotsStore`). Domain-first names: not `LocalStorageWrapper`. |
| RESULT TYPE | `src/storage/forecast-cache.ts:39-45`, `src/locations/default-locations.ts:12-19` | Discriminated unions: `{ ok: true; data } \| { ok: false; reason }` for IO, `{ ok: true; data } \| { ok: false; error }` for domain parse. Never throw across module boundaries. |
| IO MODULE | `src/storage/forecast-cache.ts:47-205` | `createCustomSlotsStore(deps?)` factory: accepts a `CacheStore` (same `getItem`/`setItem`/`removeItem` shape — re-use the existing interface from `forecast-cache.ts`, exported). Returns `{ read, add, remove, clear }`. `unsupported`/`corrupt`/`wrong-version`/`quota` reasons mirror the cache exactly. Storage doc shape: `{ "version": 1, "slots": [{ id, name, latitude, longitude }] }`. |
| SHAPE NARROWING | `src/storage/forecast-cache.ts:207-307`, `src/locations/default-locations.ts:66-125` | Inline narrower for `unknown → CustomSlotInput[]`: drop entries with non-string `name`, non-finite/out-of-range `lat`/`lon`, missing `id`. One `console.warn('[custom-slots] dropping malformed entry', id, reason)` per drop; never throw. |
| PURE DOMAIN | `src/storage/staleness.ts:1-58`, `src/locations/default-locations.ts:21-125` | `src/locations/custom-slots.ts` exports CONSTANTS (`MAX_CUSTOM_SLOTS = 2`, `CUSTOM_SLOT_ID_PREFIX = 'custom-'`) and PURE FUNCTIONS only (no IO, no DOM, no `console`). Inputs in, results out. |
| ERRORS | `CLAUDE.md` › Error handling | Domain returns typed result: `addCustomSlot` → `{ ok: true; slot } \| { ok: false; reason: 'capacity-full' \| 'duplicate' \| 'invalid-coords' }`. UI maps each `reason` to a friendly state (status text or silent no-op) — never raw error strings. Console-log every IO outcome at the boundary in `main.ts`. |
| DOM CONSTRUCTION | `src/ui/location-card.ts:14-93`, `src/ui/footer.ts:5-18` | Build with `document.createElement` + `textContent`. No `innerHTML`, no template literals into DOM. Remove button is a real `<button type="button">` so it inherits keyboard a11y; `aria-label` includes the slot name. |
| EVENT DELEGATION | `src/ui/home-screen.ts:82-106` | Click/keydown on the grid catches the remove button via `target.closest('.location-card__remove')`. The remove button MUST `event.stopPropagation()` (or the grid's `.closest('.location-card')` matcher will also expand/collapse the card on the same click). Plan locks `stopPropagation` as the chosen pattern. |
| STORY-007 INTEGRATION | `src/storage/forecast-cache.ts:170-189` | `cache.removeSlot(id)` already exists and is the canonical way to evict per-slot data — removing a custom slot calls it as a fire-and-forget side effect (its result is logged, not surfaced). Pattern mirrors `cache.writeSlot` in `src/storage/revalidate.ts:67-72`. |
| TESTS | `src/storage/forecast-cache.test.ts:1-230`, `src/locations/default-locations.test.ts:1-185`, `src/ui/home-screen.test.ts:1-171` | Vitest, NO globals: `import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'`. Co-locate `*.test.ts`. Mock the store with a `memStore()` helper identical to `forecast-cache.test.ts:12-25`. UI tests mount into `document.body`, `afterEach(() => document.body.replaceChildren())`. |
| OBSERVABILITY | `CLAUDE.md` › Observability, `src/main.ts:46, src/storage/forecast-cache.ts:98, 142, 153` | `console.info`/`warn` at boundaries with `[custom-slots]` prefix and slot id as context: `[custom-slots] add`, `[custom-slots] remove`, `[custom-slots] persist failed`. No analytics. |

(Where rows reference a single file: that is the canonical example to mirror.)

---

## Architecture (locked decisions)

### Custom slot identity is derived from coordinates

ID format: `custom-${lat.toFixed(4)}-${lon.toFixed(4)}` (4-decimal precision ≈ 11 m).

Why:
- **Stable across reloads** — re-adding the same place yields the same id, which keeps the forecast-cache key stable (no orphaned entries from rename churn).
- **Natural dedup** — `slots.some(s => s.id === newId)` is the dupe check; no separate "is same location" heuristic needed.
- **No random IDs** to leak entropy or randomness across sessions.

Caveat: negative coordinates produce `custom--12.3456--78.9012` (double dashes). That's fine — the prefix is fixed and the id is opaque to humans.

If `lat` or `lon` fails `Number.isFinite()` or falls outside `[-90, 90]` / `[-180, 180]`, `placeToSlot` returns `{ ok: false, reason: 'invalid-coords' }` and main.ts logs it. Geocoding-client already validates ranges (`src/locations/geocoding-client.ts:155-175`), so this is a defence-in-depth check, not a hot path.

### Persistence is a SEPARATE localStorage key

- Forecast cache: `weather-cache.v1` (existing, owned by STORY-007).
- Custom slots: `weather-custom-slots.v1` (NEW, owned here).

Separation reasons:
- Different lifecycle — slot list is small (≤ 2 entries), rarely written; forecasts are large (tens of KB) and rewritten on every revalidate cycle.
- Different eviction risk — losing forecasts is recoverable (re-fetch); losing slot list IS the bug we're trying to avoid for AC4.
- A `wrong-version` migration on one document doesn't blow away the other.

### Capacity gate is rendered, not enforced by the store

The store happily persists any number of slots — the cap is a UX rule enforced by `canAddSlot(slots)` in the domain module and by main.ts hiding the search input. This keeps the store reusable in the unlikely case the cap ever changes.

### Removing a custom slot evicts its forecast cache entry

`main.ts.onRemove(id)`:
1. `customSlotsStore.remove(id)` — persisted slot list shrinks.
2. `forecastCache.removeSlot(id)` — forecast bytes evicted (STORY-007 contract).
3. Re-render the grid from the merged slot list.

Order matters: we evict the slot from the persisted list FIRST so a crash between (1) and (2) leaves an orphaned cache entry (harmless, recovered on next write/expiry) rather than an orphaned slot pointing at no data (visible bug).

### Search input visibility is owned by main.ts, NOT the component

The component (`src/ui/search-input.ts`) stays untouched. main.ts conditionally renders:

- If `customSlots.length < MAX_CUSTOM_SLOTS` → mount `renderSearchInput(...)`.
- Else → mount a small `<p class="custom-slots-full">` with the text "Custom slots full — remove one to add another".

Why: it's a smaller diff (no new prop to thread, no test changes to the search-input component), and it preserves the "search input lives ONCE above the grid" pattern set by STORY-008 — the slot is just replaced atomically by a notice when full. The trade-off: typing focus is lost on the cap transition (the entire input node is unmounted), but the transition only happens on add (after which the user just selected a place — focus on the input is no longer interesting) or on remove (where the input reappears empty, which is fine).

### Adding a slot triggers an immediate revalidate

After `add` succeeds, main.ts kicks `revalidate(slots, { cache, fetchForecast, now })` and re-renders from the resulting snapshot. The new slot is fetched alongside the existing ones (per-slot isolation in STORY-007 means a failed fetch for the new slot doesn't break the rest). UX: the card briefly shows "No data" until the fetch resolves (a few hundred ms typically); CLAUDE.md › Error handling allows this state explicitly.

### A custom slot is allowed even if its coords coincide with a default

The PRD doesn't forbid tracking the same point twice (defaults are env-fixed; a user might want a per-city zoom for some reason). Dedup is only within the custom list. If a user "adds Lahti" while Lahti is also default, both cards render; the cache fetches Lahti once because the merged `slots` array does have two distinct ids (`default-0` and `custom-...`) — that IS a duplicate network call. Accepted: it's a personal app, the API is free, and the alternative (cross-checking default coords) leaks the env-injected coordinates into the dedup logic, which is the opposite of what we want.

---

## Public API (the only exports)

### `src/locations/custom-slots.ts` — NEW (pure)

```ts
import type { GeocodingPlace, LocationSlot } from './types';

export const MAX_CUSTOM_SLOTS = 2;
export const CUSTOM_SLOT_ID_PREFIX = 'custom-';
export const CUSTOM_SLOT_COORD_PRECISION = 4; // 4 decimals ≈ 11 m

/** Pure: deterministic id from coordinates. Never throws. */
export function buildCustomSlotId(latitude: number, longitude: number): string;

/** Pure: build a LocationSlot from a typed geocoding pick.
 *  Validates coords (range + finite); returns a discriminated-union result.
 *  The `name` is trimmed; empty after trim → 'invalid-name'. */
export type PlaceToSlotResult =
  | { ok: true; slot: LocationSlot }
  | { ok: false; reason: 'invalid-coords' | 'invalid-name' };

export function placeToSlot(place: GeocodingPlace): PlaceToSlotResult;

/** Pure: true if `place` would resolve to an id already in `customSlots`. */
export function findExistingCustomSlot(
  customSlots: readonly LocationSlot[],
  place: GeocodingPlace,
): LocationSlot | null;

/** Pure: true if at least one custom slot is free. */
export function canAddCustomSlot(customSlots: readonly LocationSlot[]): boolean;

/** Pure: returns the slot array with `slot` appended (NO mutation).
 *  - returns 'duplicate' when an existing slot already has that id,
 *  - returns 'capacity-full' when length === MAX_CUSTOM_SLOTS,
 *  - otherwise { ok: true, slots: [...customSlots, slot] }. */
export type AddSlotResult =
  | { ok: true; slots: LocationSlot[] }
  | { ok: false; reason: 'capacity-full' | 'duplicate' };

export function addCustomSlot(
  customSlots: readonly LocationSlot[],
  slot: LocationSlot,
): AddSlotResult;

/** Pure: returns the slot array with `id` removed (NO mutation, NO error if absent). */
export function removeCustomSlot(
  customSlots: readonly LocationSlot[],
  id: string,
): LocationSlot[];
```

### `src/storage/custom-slots-store.ts` — NEW (IO)

```ts
import type { LocationSlot } from '../locations/types';
import { type CacheStore } from './forecast-cache'; // re-use the existing interface

export const CUSTOM_SLOTS_KEY = 'weather-custom-slots.v1';
export const CUSTOM_SLOTS_VERSION = 1;

export type CustomSlotsReadFailure =
  | { kind: 'absent' }
  | { kind: 'unsupported' }
  | { kind: 'corrupt'; message: string }
  | { kind: 'wrong-version'; found: number };

export type CustomSlotsWriteFailure =
  | { kind: 'unsupported' }
  | { kind: 'quota'; message: string }
  | { kind: 'unknown'; message: string };

export type CustomSlotsReadResult =
  | { ok: true; data: LocationSlot[] }
  | { ok: false; reason: CustomSlotsReadFailure };

export type CustomSlotsWriteResult =
  | { ok: true }
  | { ok: false; reason: CustomSlotsWriteFailure };

export interface CustomSlotsStore {
  read(): CustomSlotsReadResult;
  write(slots: readonly LocationSlot[]): CustomSlotsWriteResult;
  clear(): CustomSlotsWriteResult;
}

export interface CreateCustomSlotsStoreDeps {
  store?: CacheStore | null;
  key?: string;
  version?: number;
}

export function createCustomSlotsStore(
  deps?: CreateCustomSlotsStoreDeps,
): CustomSlotsStore;
```

Storage document shape:

```jsonc
{
  "version": 1,
  "slots": [
    { "id": "custom-60.1695-24.9354", "name": "Helsinki",
      "latitude": 60.1695, "longitude": 24.9354 }
  ]
}
```

Notes:
- `kind` is NOT persisted (always `'custom'` on the way back in — store appends it).
- On read, malformed entries are dropped with a single `console.warn` each (mirrors `forecast-cache.ts:121-123`); a valid-but-truncated list is fine.
- Capacity is NOT enforced at the store level — too many entries on disk get loaded, and main.ts trims via `canAddCustomSlot` rendering logic. (Realistic scenario: user with > 2 entries from a future version downgrades; we render what we can.)

### `src/ui/location-card.ts` — UPDATE

Extend `renderLocationCard` and `renderDegradedCard` signatures to accept an OPTIONAL `onRemove` callback. When present AND `slot.kind === 'custom'`, render a small remove button (an "×" with `aria-label="Remove ${slot.name}"`). The button calls `event.stopPropagation()` then `onRemove(slot.id)`.

```ts
export interface LocationCardCallbacks {
  onRemove?: (id: string) => void;
}

export function renderLocationCard(
  slot: LocationSlot,
  forecast: ForecastResponse,
  stamp?: string,
  callbacks?: LocationCardCallbacks,
): HTMLElement;

export function renderDegradedCard(
  slot: LocationSlot,
  stamp?: string,
  callbacks?: LocationCardCallbacks,
): HTMLElement;
```

Calls without `callbacks` (e.g. existing tests, the default slots in production) get NO remove button — back-compat preserved.

### `src/ui/home-screen.ts` — UPDATE

Add an optional `callbacks` argument forwarded to the per-slot card render:

```ts
export interface HomeScreenCallbacks {
  onRemove?: (id: string) => void;
}

export function renderHomeScreen(
  slots: LocationSlot[],
  forecasts: Record<string, ForecastResponse>,
  lastUpdated?: Record<string, number | undefined>,
  nowMs?: number,
  callbacks?: HomeScreenCallbacks,
): HTMLElement;
```

Pre-existing call sites (mock tests) don't pass `callbacks` → no remove button shows up there → no test churn.

---

## Files to change

| File | Action | Purpose |
|------|--------|---------|
| `src/locations/custom-slots.ts` | CREATE | Pure helpers: constants, `buildCustomSlotId`, `placeToSlot`, `findExistingCustomSlot`, `canAddCustomSlot`, `addCustomSlot`, `removeCustomSlot`. |
| `src/locations/custom-slots.test.ts` | CREATE | Unit tests for all helpers + edge cases (negative coords, dedup, capacity boundary, immutability). |
| `src/storage/custom-slots-store.ts` | CREATE | localStorage-backed `CustomSlotsStore` mirroring `createForecastCache`. |
| `src/storage/custom-slots-store.test.ts` | CREATE | Round-trip, unsupported, absent, corrupt, wrong-version, quota, clear, malformed-entry skip. |
| `src/storage/forecast-cache.ts` | UPDATE (one-line) | Re-export `CacheStore` interface (already exported) — no change if already public. Verify in Task 0. If not exported, change `interface CacheStore` to `export interface CacheStore`. (Note: it IS already `export interface CacheStore` at line 47 — confirmed; this row collapses to "no change" once verified.) |
| `src/ui/location-card.ts` | UPDATE | Add optional `callbacks?: { onRemove? }`. When `slot.kind === 'custom' && callbacks?.onRemove`, append a `<button class="location-card__remove">` that stops propagation and calls `onRemove(slot.id)`. |
| `src/ui/location-card.test.ts` | UPDATE | Add ~3 cases: remove button appears on custom slot, absent on default slot, click calls `onRemove` with id and does NOT toggle (assert via `stopPropagation`). |
| `src/ui/home-screen.ts` | UPDATE | Accept optional `callbacks`; forward to each card render. |
| `src/ui/home-screen.test.ts` | UPDATE | Add ~2 cases: remove button visible only on custom-kind slots; clicking it triggers `onRemove` callback without expanding the card. |
| `src/ui/styles.css` | UPDATE (hotspot) | Add `.location-card__remove` block: small circular button, top-right of card, accessible focus ring using the existing `--accent` token. |
| `src/main.ts` | UPDATE (hotspot) | Load custom slots at bootstrap, merge with defaults, wire `onSelect` → `addCustomSlot` + revalidate, wire `onRemove` → `removeCustomSlot` + `cache.removeSlot` + revalidate, gate search-input visibility on `canAddCustomSlot`. |
| `.agents/reports/custom-slots-add-remove-persist-report.md` | CREATE (during `/implement`) | Implementation report mirroring `.agents/reports/geocoding-autocomplete-report.md`. |

Counts: **5 CREATE files** (4 source + 1 report), **5 UPDATE source files** (one of which — `forecast-cache.ts` — is a verification-only row), **2 UPDATE test files**, **0 DELETE**.

**NOT touched** (deliberate):
- `src/locations/types.ts` — `LocationSlot.kind: 'default' | 'custom'` already exists; nothing to add.
- `src/locations/default-locations.ts`, `default-locations.test.ts`, `mock-locations.ts` — unchanged.
- `src/locations/geocoding-client.ts`, `geocoding-client.test.ts` — unchanged (returns `GeocodingPlace` ready for `placeToSlot`).
- `src/ui/search-input.ts`, `search-input.test.ts` — unchanged (main.ts toggles visibility from outside).
- `src/storage/forecast-cache.ts` — used as-is via `cache.removeSlot`. The "one-line" UPDATE row above collapses to a no-op once verified.
- `src/storage/revalidate.ts` — unchanged (it already handles arbitrary slot arrays).
- `vite.config.ts` — no PWA/manifest change.
- `src/weather/*` — no domain crossover.

---

## Tasks

Execute in order. Each task is atomic and verifiable.

### Task 0: Verify shipping invariants (defensive lookup)

- **Action**: Read-only checks before code changes.
- **Commands** (use Grep/Read, NOT this as a shell script):
  - `Grep` for `export interface CacheStore` in `src/storage/forecast-cache.ts` → confirm `CacheStore` is exported (line 47 says so; verify).
  - `Grep` for `removeSlot` in `src/storage/forecast-cache.ts` → confirm public on `ForecastCache`.
  - `Grep` for `kind: 'custom'` across `src/` → confirm only the type literal exists; no code path branches on it yet (no regression risk).
  - `Read` `src/main.ts` to confirm the `onSelect` placeholder is still on lines ~33-38.
- **Validate**: each grep produces the expected hit; if not, STOP and re-plan.

### Task 1: Create `src/locations/custom-slots.ts`

- **File**: `src/locations/custom-slots.ts`
- **Action**: CREATE
- **Implement**: every export listed in the Public API section, in this order — constants, `buildCustomSlotId`, `placeToSlot`, `findExistingCustomSlot`, `canAddCustomSlot`, `addCustomSlot`, `removeCustomSlot`. Pure module: no side effects, no `console`, no import from `weather/` / `ui/` / `storage/`.
- **Mirror**: `src/storage/staleness.ts:1-58` for the no-IO/pure style; `src/locations/default-locations.ts:21-125` for the discriminated-union result shape and trim/range validation pattern.
- **Coordinate rounding**: use `Number(lat.toFixed(4))` on the SLOT (not just the id) so the persisted `latitude` matches the id seed exactly. Geocoding returns up to 6 decimals; rounding to 4 makes the id stable AND avoids floating-point drift on re-add. The `forecast` request still gets the rounded coords — 11 m precision is more than sufficient for a weather call (Open-Meteo's grid is coarser than that).
- **Validate**: `npx tsc --noEmit && npm run lint`.

### Task 2: Tests — `src/locations/custom-slots.test.ts`

- **File**: `src/locations/custom-slots.test.ts`
- **Action**: CREATE
- **Implement** at minimum these cases:
  1. `buildCustomSlotId(60.169512, 24.93545)` → `'custom-60.1695-24.9354'`.
  2. `buildCustomSlotId(-60.169512, -24.93545)` → `'custom--60.1695--24.9354'` (double-dash kept).
  3. `placeToSlot` happy path: `{ name: '  Helsinki  ', latitude: 60.169512, longitude: 24.93545, country: 'Finland' }` → `{ ok: true, slot: { id: 'custom-60.1695-24.9354', name: 'Helsinki', latitude: 60.1695, longitude: 24.9354, kind: 'custom' } }`.
  4. `placeToSlot` empty-after-trim name → `{ ok: false, reason: 'invalid-name' }`.
  5. `placeToSlot` invalid lat (NaN, 91, -91) → `{ ok: false, reason: 'invalid-coords' }`.
  6. `placeToSlot` invalid lon (NaN, 181, -181) → `{ ok: false, reason: 'invalid-coords' }`.
  7. `findExistingCustomSlot`: returns the existing slot when ids match; returns `null` when they don't.
  8. `canAddCustomSlot([])` → true; `canAddCustomSlot([s1])` → true; `canAddCustomSlot([s1, s2])` → false.
  9. `addCustomSlot` happy path returns NEW array (assert `!== input` and `input.length` unchanged).
  10. `addCustomSlot` to a full list → `{ ok: false, reason: 'capacity-full' }`.
  11. `addCustomSlot` with an id already in the list → `{ ok: false, reason: 'duplicate' }`.
  12. `removeCustomSlot` returns NEW array minus the id; absent id is a silent no-op (returns equal-content but new array).
- **Test scaffolding**:
  - `import { describe, expect, it } from 'vitest';`
  - No mocks needed — module is pure.
- **Mirror**: `src/storage/staleness.test.ts` (pure tests, no mocks), `src/locations/default-locations.test.ts` (discriminated-union assertions).
- **Validate**: `npm test` — all new cases green.

### Task 3: Create `src/storage/custom-slots-store.ts`

- **File**: `src/storage/custom-slots-store.ts`
- **Action**: CREATE
- **Implement**: `createCustomSlotsStore` per the Public API section. Internals:
  - `defaultStore()` — same as `forecast-cache.ts:69-78`, copy verbatim (or, slightly cleaner, factor it out into a shared helper — see "Cleanup" note below).
  - `readDoc()` — version/shape narrowing on the parsed JSON. Drops malformed entries with one `console.warn('[custom-slots] dropping malformed entry', { id, reason })` per drop.
  - `writeDoc(slots)` — `JSON.stringify({ version, slots })`; on throw, classify `QuotaExceededError` → `{ kind: 'quota' }`, else `{ kind: 'unknown' }`. Wire is identical to `forecast-cache.ts:130-156`.
  - `clear()` → `store.removeItem(key)`; classify throw via the same path.
  - The store ALWAYS appends `kind: 'custom'` on the way out of `read` (it's NOT in the persisted doc).
- **Cleanup note**: do NOT preemptively factor `defaultStore`/`CacheStore` into a shared util — the duplication is ~10 lines and only two modules use it (CLAUDE.md › Doing tasks: "Three similar lines is better than a premature abstraction"). Leave the copy.
- **Mirror**: `src/storage/forecast-cache.ts:80-205` for the factory shape; `src/storage/forecast-cache.ts:207-307` for the narrower pattern.
- **Validate**: `npx tsc --noEmit && npm run lint`.

### Task 4: Tests — `src/storage/custom-slots-store.test.ts`

- **File**: `src/storage/custom-slots-store.test.ts`
- **Action**: CREATE
- **Implement** at minimum:
  1. Read with `store: null` → `{ ok: false, reason: { kind: 'unsupported' } }`.
  2. Read empty store → `{ kind: 'absent' }`.
  3. Read corrupt JSON → `{ kind: 'corrupt' }` + one `console.warn`.
  4. Read wrong-version (write `{ version: 999, slots: [] }`) → `{ kind: 'wrong-version', found: 999 }`.
  5. Drop malformed entries: write a doc with one valid and one entry whose `latitude` is a string → read returns the valid one only, one `console.warn` fired.
  6. Round-trip: `write([slot1, slot2])` → `read()` returns the same two slots (with `kind: 'custom'` re-attached).
  7. Empty write `write([])` deletes the storage key (mirror `forecast-cache.ts:179-188` — empty snapshot → `removeItem`). Or: write an empty doc; either is fine — plan locks **deletes the key** to keep the cache pattern.
  8. Quota: store whose `setItem` throws `new DOMException('quota', 'QuotaExceededError')` → `{ kind: 'quota' }` + one `console.warn`.
  9. Non-quota throw: `throw new Error('disk full')` → `{ kind: 'unknown' }` and message contains `'disk full'`.
  10. Default store path: no `store` dep injected — uses jsdom localStorage; round-trip works.
  11. `clear()` removes the key.
  12. Read-after-clear → `{ kind: 'absent' }`.
- **Test scaffolding**:
  - `import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';`
  - `beforeEach(() => localStorage.clear())`, `afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); })`.
  - Re-use the `memStore()` helper verbatim from `forecast-cache.test.ts:12-25`.
- **Mirror**: `src/storage/forecast-cache.test.ts:1-230` — same structure, fewer cases (slots are simpler than forecasts).
- **Validate**: `npm test` — all new cases green.

### Task 5: Extend `src/ui/location-card.ts`

- **File**: `src/ui/location-card.ts`
- **Action**: UPDATE
- **Implement**:
  - Add `LocationCardCallbacks` interface (`onRemove?: (id: string) => void`) to the file's exports.
  - Add optional `callbacks?: LocationCardCallbacks` as the LAST parameter to BOTH `renderLocationCard` and `renderDegradedCard` (preserves back-compat of positional args — `stamp` stays third).
  - When `slot.kind === 'custom' && callbacks?.onRemove !== undefined`, build a `<button class="location-card__remove" type="button" aria-label="Remove ${slot.name}">×</button>` and append it to the card.
  - The button's `click` handler MUST `event.stopPropagation()` then call `callbacks.onRemove(slot.id)`. (Without `stopPropagation`, the home-screen's delegated card click will also fire and expand the card on remove.)
  - `keydown` on the remove button isn't needed — the button IS a `<button>`, native Enter/Space already trigger `click`. Verify by NOT adding a keydown handler.
- **Mirror**: `src/ui/location-card.ts:14-93` (existing element factories), `src/ui/home-screen.ts:82-106` (delegated event pattern — but here we attach the listener directly to the button, NOT delegated, because there's only one per card and direct attach makes `stopPropagation` cleaner).
- **Validate**: `npx tsc --noEmit && npm run lint`.

### Task 6: Update `src/ui/location-card.test.ts`

- **File**: `src/ui/location-card.test.ts`
- **Action**: UPDATE
- **Implement** at minimum:
  - "renders remove button on a custom slot when onRemove is provided" — assert one `.location-card__remove`, `aria-label` includes the slot name.
  - "no remove button on a default slot, even when onRemove is provided" — assert zero `.location-card__remove`.
  - "no remove button when onRemove is NOT provided, even on a custom slot" — assert zero.
  - "click on remove button calls onRemove with slot.id and does NOT bubble to the card" — spy on a parent click listener: assert `onRemove` got the id AND the parent spy was NOT called (or the card's `aria-expanded` did NOT flip if the test mounts via `renderHomeScreen`).
  - The degraded variant gets the same treatment: assert remove button is rendered on a custom degraded card.
- **Validate**: `npm test`.

### Task 7: Update `src/ui/home-screen.ts`

- **File**: `src/ui/home-screen.ts`
- **Action**: UPDATE
- **Implement**:
  - Add optional `callbacks?: HomeScreenCallbacks` (positional argument 5) to `renderHomeScreen`. Forward to each card render call.
  - DO NOT add new click logic at the home-screen level — the remove button stops propagation, so the existing `findCard` / `toggle` flow is untouched.
- **Mirror**: `src/ui/home-screen.ts:7-45`.
- **Validate**: `npx tsc --noEmit && npm run lint`.

### Task 8: Update `src/ui/home-screen.test.ts`

- **File**: `src/ui/home-screen.test.ts`
- **Action**: UPDATE
- **Implement** at minimum two NEW cases:
  - "renders remove button on each custom-kind slot when onRemove is provided"; assert count equals the number of custom slots.
  - "clicking the remove button calls onRemove(slot.id) and does NOT expand the card"; assert the card's `aria-expanded` is still `'false'` and the detail is still hidden after the click.
- Build a small fixture inline: `[{ kind: 'default', ... }, { kind: 'custom', ... }]` with mock forecasts attached.
- **Mirror**: `src/ui/home-screen.test.ts:14-50` for click dispatch.
- **Validate**: `npm test`.

### Task 9: CSS for the remove button — `src/ui/styles.css` (hotspot)

- **File**: `src/ui/styles.css`
- **Action**: UPDATE
- **Implement**: append at end of file (after `.search-input__option-meta`):
  ```css
  .location-card__remove {
    align-self: flex-start;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 1px solid var(--border);
    background: var(--card-bg);
    color: var(--muted);
    font-size: 1.1rem;
    line-height: 1;
    cursor: pointer;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .location-card__remove:hover {
    color: var(--fg);
    border-color: var(--muted);
  }
  .location-card__remove:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .custom-slots-full {
    margin: 0 4px var(--gap);
    padding: 10px 12px;
    border: 1px dashed var(--border);
    border-radius: var(--radius);
    color: var(--muted);
    font-size: 0.85rem;
    text-align: center;
  }
  ```
- The `align-self: flex-start` keeps the button at the top-right of the card body. The card is already `display: flex` (`.location-card`); we attach the button as the LAST child of the card (after the body), so it sits to the right of the body. If alignment looks off in practice, the implementer is free to wrap the button in a header row inside `.location-card__body` — but the CSS block above is the minimum that passes layout review. Decide during `/implement` after a real screenshot.
- **Hotspot per CLAUDE.md** — only this story touches `styles.css` concurrently in the current session.
- **Validate**: `npm run build` — CSS is bundled and not lint-checked, but `vite build` will fail on syntax errors.

### Task 10: Wire it all in `src/main.ts` (hotspot)

- **File**: `src/main.ts`
- **Action**: UPDATE
- **Implement** in this order (chunks tagged for the implementer):
  1. **Imports**: add `import { createCustomSlotsStore } from './storage/custom-slots-store';` and `import { addCustomSlot, canAddCustomSlot, findExistingCustomSlot, placeToSlot, removeCustomSlot } from './locations/custom-slots';`.
  2. **Bootstrap state**: after `const cache = createForecastCache();` (line 54), add:
     ```ts
     const slotsStore = createCustomSlotsStore();
     const customRead = slotsStore.read();
     let customSlots: LocationSlot[] = customRead.ok ? customRead.data : [];
     if (!customRead.ok && customRead.reason.kind !== 'absent' && customRead.reason.kind !== 'unsupported') {
       console.warn('[main] custom slots read failure:', customRead.reason);
     }
     ```
  3. **Merged slot list**: replace `const slots = parsed.data;` with `const defaultSlots = parsed.data;` and compute `const slots = [...defaultSlots, ...customSlots];` AT EACH render call. Keep the merge inline rather than a function — three lines, one call site, no abstraction needed.
  4. **Search input replacement**: today the search input is mounted ONCE outside `render()` (line 33-38). Replace that with a `let searchEl: HTMLElement` that the new helper `mountSearchOrNotice()` updates in place. The helper:
     ```ts
     function mountSearchOrNotice(): HTMLElement {
       if (canAddCustomSlot(customSlots)) {
         return renderSearchInput({
           searchGeocoding: (q, s) => searchGeocoding(q, { signal: s }),
           onSelect: handleSelect,
         });
       }
       const notice = document.createElement('p');
       notice.className = 'custom-slots-full';
       notice.textContent = 'Custom slots full — remove one to add another';
       return notice;
     }
     ```
     and `root.replaceChildren(searchEl, content)` becomes `root.replaceChildren(searchEl = mountSearchOrNotice(), content)` at every relevant boundary (initial mount, after add, after remove).
  5. **`handleSelect`** (the new `onSelect`):
     ```ts
     async function handleSelect(place: GeocodingPlace): Promise<void> {
       const placeResult = placeToSlot(place);
       if (!placeResult.ok) {
         console.warn('[custom-slots] place rejected:', placeResult.reason);
         return;
       }
       const existing = findExistingCustomSlot(customSlots, place);
       if (existing !== null) {
         console.info('[custom-slots] duplicate; ignoring', existing.id);
         return;
       }
       const addResult = addCustomSlot(customSlots, placeResult.slot);
       if (!addResult.ok) {
         console.warn('[custom-slots] add failed:', addResult.reason);
         return;
       }
       customSlots = addResult.slots;
       const writeResult = slotsStore.write(customSlots);
       if (!writeResult.ok) {
         console.warn('[custom-slots] persist failed:', writeResult.reason);
         // Continue: in-memory add still wins until reload.
       }
       const merged = [...defaultSlots, ...customSlots];
       // Re-mount search/notice (capacity may have flipped) and re-render with current snapshot first.
       root.replaceChildren(searchEl = mountSearchOrNotice(), content);
       render(content, merged, snapshot);
       // Then revalidate (will fetch the NEW slot too).
       const cycle = await revalidate(merged, { cache, fetchForecast, now: Date.now });
       snapshot = cycle.snapshot;
       render(content, merged, snapshot);
     }
     ```
  6. **`handleRemove`**:
     ```ts
     function handleRemove(id: string): void {
       customSlots = removeCustomSlot(customSlots, id);
       const writeResult = slotsStore.write(customSlots);
       if (!writeResult.ok) console.warn('[custom-slots] persist failed:', writeResult.reason);
       const evict = cache.removeSlot(id);
       if (!evict.ok) console.warn('[custom-slots] cache evict failed:', evict.reason);
       // Drop the slot from the snapshot too so the next render doesn't show stale data.
       const next: CacheSnapshot = { ...snapshot };
       delete next[id];
       snapshot = next;
       root.replaceChildren(searchEl = mountSearchOrNotice(), content);
       render(content, [...defaultSlots, ...customSlots], snapshot);
     }
     ```
  7. **Pass `handleRemove` to `render`**: extend the `render` helper to forward a `callbacks: { onRemove: handleRemove }` object to `renderHomeScreen`. (Hoist `handleRemove` so the helper closure can see it.)
  8. **visibilitychange revalidate** keeps working unchanged — it already reads `slots` via closure. Make sure the closure reads the LATEST `customSlots` value (declare `customSlots` with `let` at the bootstrap scope, not a const captured before mutations). The recompute is `[...defaultSlots, ...customSlots]` inline at each visibility tick.
- **Layout decision**: `searchEl` and `content` keep their relative order (`searchEl` above `content`). Removing a slot or adding one re-mounts `searchEl` so the capacity-state notice swaps in/out atomically. Focus inside the input survives normal typing because re-mount only happens on add/remove transitions — both moments where focus on the input is not user-relevant.
- **Mirror**: `src/main.ts:29-98` for the bootstrap closure pattern; `.agents/plans/completed/geocoding-autocomplete.plan.md` § "Task 9" for the "mount search once outside render()" principle.
- **Validate**: `npm run lint && npx tsc --noEmit && npm test && npm run build` all exit 0.

### Task 11: Full validation + report

- **Implement**:
  1. `npm run lint && npx tsc --noEmit && npm test` — every command exits 0 (CLAUDE.md › Validation).
  2. `npm run build` — succeeds; bundle delta < a few KB (no new deps).
  3. **Demoable check (CLAUDE.md › Notes)** — run `npm run preview` and capture a screenshot via the **agent-browser skill** showing:
     - The home screen with the search input visible above the 4 default cards (cap not reached).
     - After adding a custom slot via the search input, a 5th card appears with an "×" remove button.
     - After adding a 6th (second custom) slot, the search input is replaced by "Custom slots full — remove one to add another".
     - After clicking "×" on a custom card, the input re-appears and that card disappears.
     - Reload the page → custom slots are still there.
     If the sandbox blocks outbound network for the headless browser → record as defer-and-record per CLAUDE.md and provide a Vitest-based JSDOM screenshot description in the report instead.
  4. Write `.agents/reports/custom-slots-add-remove-persist-report.md` mirroring `.agents/reports/geocoding-autocomplete-report.md` (Summary, Tasks Completed, Validation Evidence, Acceptance Criteria Mapping, Tests Written, Files Changed, Independent Verification, Sandbox-blocked items).
- **Sandbox-blocked items** (record explicitly, do NOT treat as failures):
  - Real-device iPhone tap-test (Add via on-screen keyboard, momentum scroll, reload survives) — owner runs manually after deploy.
  - Production deploy / Lighthouse — STORY-010 territory.
  - The agent-browser screenshot itself, if the headless Chromium is blocked.
- **Validate**: every command above exits 0; the report file exists; the screenshot (or its defer-and-record note) is committed under `.agents/reports/screenshots/`.

---

## Risks

| Risk | Mitigation |
|------|------------|
| Coordinate rounding drifts the slot's lat/lon away from what Open-Meteo's geocoding returned, then API returns slightly different forecasts at the rounded coord | Open-Meteo's forecast endpoint internally snaps to a grid coarser than 4 decimals (PRD § "iOS Reality Check"). Tested informally during the STORY-004 spike — temps match within < 0.5 °C across nearby coords. Rounding is a deliberate trade-off for stable IDs. |
| User reloads while `handleSelect` is mid-`revalidate` and the new slot has been persisted but not yet fetched | Acceptable: on reload, the cache lookup for that slot returns `absent` and the card shows the degraded state until the next revalidate cycle fetches it. STORY-007 already handles this with `renderDegradedCard`. |
| Slot order is unstable across reloads (insertion order vs id order) | Persist in insertion order (`write(customSlots)` writes the array as-is); `read` preserves order. Test case `custom-slots-store.test.ts` "preserves slot order across round-trip" makes this explicit. |
| Hotspot collisions on `main.ts` and `styles.css` | CLAUDE.md orchestration rule: never run two issues touching the same hotspot concurrently. This story is the only one open on these files in the current session. |
| Remove button click leaks to card expand-toggle | `event.stopPropagation()` on the remove handler + a regression test in `location-card.test.ts` that asserts the card's `aria-expanded` stays `'false'` after a remove click. |
| `cache.removeSlot` returns `unsupported` on devices without localStorage | Logged at the boundary in `handleRemove`; the in-memory `snapshot` and `customSlots` updates still proceed, so the UI is correct for the current session. Reload would re-add the slot from a missing/unsupported store — that's the same failure mode as STORY-007 and not in scope here. |
| A user copies the prod URL to a new device and expects custom slots to follow them | Out of scope per PRD ("кастомные локации не покидают устройство" + "no accounts, no multi-tenancy"). Document in the implementation report as expected behavior. |
| Persisted slot list grows past 2 because of a downgrade or hand-edit | `read` returns whatever is on disk; main.ts simply renders them. Adding any new one is gated by `canAddCustomSlot` (still false), so the cap self-heals to ≤ 2 on the next user action. |
| Empty `name` from a future Open-Meteo response shape | `placeToSlot` returns `{ ok: false, reason: 'invalid-name' }`; main.ts logs and ignores. UI stays silent — user just sees nothing happen, which is acceptable for a defensive guard against a contract change. Geocoding's parser already rejects empty names at the boundary. |
| `customSlots` mutation racing with revalidate's in-flight fetches | Promise.all is fired with the snapshot of `slots` at the time of the call; mutation between fire-and-resolve cannot affect the in-flight set. The post-resolve render is from the LATEST `customSlots` via `[...defaultSlots, ...customSlots]`, so a slot removed during a fetch is correctly absent from the rendered grid. |
| Quota write-failure when persisting custom slots | Returned as `{ kind: 'quota' }`; main.ts logs and continues with the in-memory state. Slots survive the session; lost on reload. Two slots × ~120 bytes is trivially under any quota, so this is theoretical. |

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

- `npm run preview` + agent-browser screenshot, if the sandbox blocks the headless browser.
- Real-device iPhone tap test (keyboard, scroll, reload-while-offline) — owner runs manually.
- Production deploy — STORY-010 territory.

---

## Acceptance criteria

Issue #9 ACs → tasks/tests mapping (every AC maps to ≥ 1 task or test):

- [ ] **AC1** — пустой слот, выбираю локацию из автокомплита → слот заполняется, погода загружается и кэшируется наравне с дефолтными.
      → Task 1 (`placeToSlot` + `addCustomSlot`), Task 3 (`slotsStore.write`), Task 10 (`handleSelect` triggers `revalidate`). Tests: `custom-slots.test.ts` cases 3 + 9; `custom-slots-store.test.ts` case 6; manual demo in Task 11.
- [ ] **AC2** — оба слота заняты → добавить третью локацию нельзя (кнопка скрыта/disabled), дефолтные слоты удалить нельзя.
      → Task 1 (`canAddCustomSlot`, `MAX_CUSTOM_SLOTS = 2`), Task 5 (remove button only renders on `kind === 'custom'`), Task 10 (`mountSearchOrNotice` swaps in the notice when capacity full). Tests: `custom-slots.test.ts` case 8; `location-card.test.ts` "no remove button on a default slot"; manual demo in Task 11.
- [ ] **AC3** — заполненный временный слот, удаляю → слот освобождается и его кэш удаляется.
      → Task 1 (`removeCustomSlot`), Task 5 (remove button), Task 10 (`handleRemove` calls `cache.removeSlot`). Tests: `custom-slots.test.ts` case 12; `location-card.test.ts` "click on remove button calls onRemove"; `home-screen.test.ts` "clicking the remove button calls onRemove".
- [ ] **AC4** — добавленный слот, закрываю и снова открываю (включая офлайн) → слот на месте с последними данными.
      → Task 3 (`createCustomSlotsStore` persists to localStorage), Task 4 (round-trip test), Task 10 (bootstrap reads from store). Tests: `custom-slots-store.test.ts` cases 6 + 10; manual reload demo in Task 11.
- [ ] **AC5** — логика управления слотами → `npm test` зелён, add/remove/persist покрыты unit-тестами.
      → Tasks 2, 4, 6, 8 (all new test files / extensions). `custom-slots.test.ts` covers add/remove logic; `custom-slots-store.test.ts` covers persistence; `location-card.test.ts` + `home-screen.test.ts` cover the UI wiring.

Process gates:

- [ ] All tasks completed
- [ ] `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build` all pass
- [ ] No new runtime dependencies (`package.json` `dependencies` stays empty)
- [ ] No `any` anywhere in new code; lint = 0 errors, 0 warnings
- [ ] No `innerHTML` in any new or updated file; no API-sourced string rendered as anything but `textContent` (CLAUDE.md › Security)
- [ ] No real default-location coordinates (Lahti/Helsinki/Tallinn/Käsmu env-injected lat/lon) appear in source. Fixture/test coordinates use public examples or arbitrary values.
- [ ] `src/locations/custom-slots.ts` does NOT import from `src/storage/`, `src/ui/`, or `src/weather/` (architecture rule). `src/storage/custom-slots-store.ts` imports `LocationSlot` and `CacheStore` types only.
- [ ] `src/ui/search-input.ts` and `src/locations/geocoding-client.ts` UNCHANGED (verify via `git diff` in the implementation report).
- [ ] `cache.removeSlot(id)` is called for every successful custom-slot remove (verify by reading `handleRemove` in the diff).
- [ ] Remove button has `aria-label` including the slot name and stops `click` propagation (verify in `location-card.test.ts` + by reading the source).
- [ ] Custom slot id format = `custom-${lat.toFixed(4)}-${lon.toFixed(4)}` (locked; tested in `custom-slots.test.ts` cases 1 + 2).
- [ ] Two custom slots persist across reload via localStorage key `weather-custom-slots.v1`, separate from `weather-cache.v1` (verify by reading `CUSTOM_SLOTS_KEY` vs `CACHE_KEY`).
- [ ] Sandbox-blocked checks (preview screenshot, real-iPhone test, deploy) recorded as defer-and-record, NOT treated as failures.
- [ ] Issue #9 acceptance criteria → tasks/tests mapping above is complete.
