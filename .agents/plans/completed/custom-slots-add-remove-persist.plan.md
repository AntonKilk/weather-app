# Plan: Custom Slots — Add / Remove / Persist (STORY-009)

## Summary

Wire up two user-controlled "custom" location slots that sit alongside the four env-baked default slots. The user adds a slot by picking a result from the geocoding autocomplete (STORY-008), removes it from the card, and the slot survives reload and offline open. Persistence is on-device only via `localStorage`; default slots are not removable; cap is two custom slots and the search input/CTA is disabled when the cap is reached.

## User Story

As a personal user of the weather PWA,
I want two free slots I can fill with a travel destination and clear after the trip,
So that I can temporarily watch the weather where I'm going without rebuilding the app.

## Metadata

| Field | Value |
|-------|-------|
| Type | NEW_CAPABILITY |
| Complexity | MEDIUM |
| Systems Affected | `src/locations/`, `src/ui/`, `src/main.ts` |
| GitHub Issue | #9 |

---

## Patterns to Follow

### Naming — kebab-case files, PascalCase types, camelCase functions (CLAUDE.md)
```ts
// SOURCE: src/locations/env.ts:23-37
export type EnvParseErrorKind =
  | 'missing'
  | 'malformed-json'
  | 'invalid-shape'
  | 'invalid-entry';

export interface EnvParseError {
  readonly kind: EnvParseErrorKind;
  readonly message: string;
}

export type ParseDefaultLocationsResult =
  | { readonly ok: true; readonly locations: readonly Location[] }
  | { readonly ok: false; readonly error: EnvParseError };
```

### Boundary validation (CLAUDE.md › Types)
```ts
// SOURCE: src/locations/env.ts:105-128
function validateEntry(entry: unknown, index: number): EntryResult {
  if (!isPlainObject(entry)) return entryFail(index, 'must be a JSON object');
  const name = entry['name'];
  if (typeof name !== 'string' || name.trim().length === 0) {
    return entryFail(index, '`name` must be a non-empty string');
  }
  // …lat/lon range checks…
  return { ok: true, location: { name, lat, lon } };
}
```

### Error handling — log internally, render friendly state (CLAUDE.md › Error handling)
```ts
// SOURCE: src/main.ts (pre-issue-9): parseDefaultLocations + console.error
if (!parsed.ok) {
  console.error(`[main] VITE_DEFAULT_LOCATIONS invalid (...)`);
  renderApp(root, []);
  return;
}
```

### Tests — co-located, Vitest, no DOM snapshots — assert behaviour (CLAUDE.md › Testing)
```ts
// SOURCE: src/locations/env.test.ts pattern
import { describe, expect, it } from 'vitest';
import { parseDefaultLocations } from './env';

describe('parseDefaultLocations', () => {
  it('returns ok with parsed entries for valid JSON', () => {
    const out = parseDefaultLocations('[{"name":"A","lat":60,"lon":25}]');
    expect(out.ok).toBe(true);
  });
});
```

### Card placeholder for empty slot (extant)
```ts
// SOURCE: src/ui/card.ts:28-38
if (slot.location === null) {
  button.classList.add('card--empty');
  button.setAttribute('aria-label', 'Add a location');
  const placeholder = document.createElement('span');
  placeholder.className = 'card-placeholder';
  placeholder.textContent = '+ Add a location';
  button.appendChild(placeholder);
  button.disabled = true;
  return button;
}
```

---

## Files to Change

| File | Action | Purpose |
|------|--------|---------|
| `src/locations/custom-slots.ts` | CREATE | localStorage-backed store: list/add/remove/clear + subscribe, with strict boundary validation. Cap = 2. |
| `src/locations/custom-slots.test.ts` | CREATE | Unit tests for store: add cap, dedupe, remove, persistence (round-trip via fake `Storage`), corrupt-data recovery, subscribe notifications. |
| `src/ui/card.ts` | UPDATE | (a) Empty custom slot → enable the placeholder button with a click callback (so it can focus the search input). (b) Populated custom slot → add a small "Remove" button inside the card that calls a callback (stops click propagation so the card itself stays openable). |
| `src/ui/card.test.ts` | CREATE | Unit tests: remove button shows only on populated custom slot; remove click fires callback and does not navigate to detail; empty custom placeholder calls onAddRequest when enabled. |
| `src/ui/app.ts` | UPDATE | Accept `onRemove(index)` and `onAddRequest()` callbacks and thread them to `renderLocationCard`. |
| `src/ui/styles.css` | UPDATE | Minimal styles for `.card-remove` button + `.location-search-container`. |
| `src/main.ts` | UPDATE | Already merged-in: store wiring + search widget mount. Add: focus the search input on empty-card click; remove callback → `store.remove(index_in_customs)`; cap awareness; subscribe re-renders. |
| `src/main.test.ts` | UPDATE | Update card-count expectations to account for the 2 padded custom slots, and add tests for: persistence round-trip via injected store, add-by-selection, remove, cap enforcement. |
| `.agents/reports/custom-slots-add-remove-persist-report.md` | CREATE | Report at end of implementation (per implement.md). |

---

## Tasks

Execute in order. Each task is atomic and verifiable.

### Task 1: Custom-slot store (domain + persistence boundary)

- **File**: `src/locations/custom-slots.ts`
- **Action**: CREATE
- **Implement**:
  - Export `MAX_CUSTOM_SLOTS = 2` and storage key constant (`weather-app:custom-slots:v1`).
  - Export `CustomSlotStore` interface: `list(): readonly Location[]`, `canAdd(): boolean`, `add(loc: LocationSelection): AddResult`, `remove(index: number): boolean`, `clear(): void`, `subscribe(listener: () => void): () => void`.
  - Export `AddResult` as `{ ok: true } | { ok: false; error: { kind: 'cap-reached' | 'duplicate' | 'invalid' } }`.
  - Export `createCustomSlotStore(opts?: { storage?: Storage })` (defaults to `globalThis.localStorage`; tolerate absent localStorage on the platform by falling back to an in-memory map and logging once).
  - Load on construction: read string from storage → JSON.parse in try/catch → narrow each entry with the same `name/lat/lon` validators as `env.ts` (extract or duplicate shape checks; do NOT import from `env.ts` to keep it tight, but mirror the rules).
  - Corrupt-data recovery: catch JSON / shape errors, console.warn once, treat as empty list, persist back the cleaned list on the next mutation only (don't overwrite if no mutation).
  - Dedupe: rejects an add when an existing slot has the same (lat, lon) within ~1e-4 epsilon — same place at "close enough" coordinates is one place.
  - Persist on every mutation; never persist on construction (corrupt-data clearing happens on next write).
  - Subscribe: synchronous notification AFTER mutation; returns an unsubscribe function. Errors in a listener must not break other listeners (wrap in try/catch → console.warn).
- **Mirror**: `src/locations/env.ts:63-128` for the boundary validation shape; `src/locations/geocoding-autocomplete.ts` for subscriber-style callbacks if present.
- **Validate**: `npx tsc --noEmit && npm test -- src/locations/custom-slots`

### Task 2: Store tests

- **File**: `src/locations/custom-slots.test.ts`
- **Action**: CREATE
- **Implement** (Vitest, jsdom env, in-memory `Storage` stub):
  - Round-trip: create store → `add({name,lat,lon})` → `list()` reflects it → new instance with same storage → `list()` returns the same slot.
  - Cap: adding a 3rd slot returns `{ ok: false, error: { kind: 'cap-reached' } }` and `canAdd()` flips between true/false.
  - Dedupe: adding the same lat/lon (or within epsilon) returns `{ kind: 'duplicate' }` and does not grow the list.
  - Remove: `remove(0)` shifts the second slot into index 0; persistence reflects it; removing an out-of-range index returns `false`.
  - Corrupt data: pre-seed storage with `"not-json"` → constructor returns empty list, console.warn called once; first `add()` after that persists clean state.
  - Bad shape on disk: pre-seed `'[{"name":"x"}]'` (missing lat/lon) → empty list, warn.
  - Subscribe: notification fires after add and remove; unsubscribe stops further notifications; one listener throwing does not skip the next listener.
  - No-localStorage fallback: construct with `storage: undefined` after stubbing `globalThis.localStorage = undefined` → store works in-memory; subsequent `add` doesn't throw.
  - All API-sourced strings stay strings (no JSON-sourced HTML smuggling) — render path doesn't matter here, but assert that the stored `name` is preserved verbatim.
- **Mirror**: `src/locations/env.test.ts` style if present, otherwise `src/locations/debounce.test.ts`.
- **Validate**: `npm test -- src/locations/custom-slots`

### Task 3: Card — remove button on populated custom slot + clickable empty placeholder

- **File**: `src/ui/card.ts`
- **Action**: UPDATE
- **Implement**:
  - Extend `renderLocationCard(item, onTap, opts?)` with `opts: { onAddRequest?(): void; onRemove?(): void }`.
    - Empty custom slot (`slot.kind === 'custom' && slot.location === null`): if `onAddRequest` is provided, enable the button and bind a click handler that calls `onAddRequest()`; if not provided, keep current disabled behaviour.
    - Populated custom slot (`slot.kind === 'custom' && slot.location !== null`): if `onRemove` is provided, append a small `<button class="card-remove" aria-label="Remove {name}">×</button>` that on click calls `event.stopPropagation()` then `onRemove()`. Default slots never get this button.
  - Preserve existing tap-to-open behaviour: the remove button must not bubble into the card click.
- **Mirror**: `src/ui/card.ts:96-101` (existing click wiring); add a SOURCE comment.
- **Validate**: `npx tsc --noEmit`

### Task 4: Card tests

- **File**: `src/ui/card.test.ts`
- **Action**: CREATE
- **Implement**:
  - Render with empty custom slot + `onAddRequest` → button is not disabled, click fires the callback exactly once.
  - Render with empty custom slot, no `onAddRequest` → button disabled (regression: existing behaviour).
  - Render with populated custom slot + `onRemove` → a `.card-remove` button is present and clicking it calls `onRemove` once but does NOT fire the card's `onTap`.
  - Render with populated default slot + `onRemove` → no `.card-remove` button (defaults are not removable per CLAUDE.md).
  - Removed-button aria-label includes the location name.
- **Validate**: `npm test -- src/ui/card`

### Task 5: App wiring — pass callbacks through `renderApp`

- **File**: `src/ui/app.ts`
- **Action**: UPDATE
- **Implement**:
  - Extend `renderApp(root, items, opts?)` with `opts: { onAddRequest?(): void; onRemove?(slotIndex: number): void }`.
  - Pass them through to `renderLocationCard` based on slot kind:
    - For each empty card → `onAddRequest`.
    - For each populated custom card → `() => opts.onRemove(slotIndex)`.
  - No behaviour change for existing call sites — both opts are optional.
- **Mirror**: existing `renderApp` (file:`src/ui/app.ts`).
- **Validate**: `npx tsc --noEmit && npm test -- src/ui/app`

### Task 6: Main wiring — store + search widget + remove flow

- **File**: `src/main.ts`
- **Action**: UPDATE (most of this landed in the merge commit; finish it)
- **Implement**:
  - Import `createCustomSlotStore` from `./locations/custom-slots` (Task 1).
  - In `bootstrap`, build slots as `[...defaults, ...customs, ...emptyPadding upTo cap]` (already done in the merge commit — verify).
  - Map slot index back to custom-store index when wiring `onRemove`. The custom-store index is `slotIndex - defaults.length`; ignore removes outside `[defaults.length, defaults.length + customs.length)`.
  - Wire `onAddRequest` to focus the `input` inside the mounted search widget (querySelector by id).
  - Disable / hide the search widget input when `store.canAdd()` is false (set `aria-disabled` + `disabled` on the input and a small inline note "2 of 2 custom slots in use"). Re-enable on store change.
  - Keep `subscribe(renderNow)` so the cards refresh whenever the store mutates.
  - Custom-slot data must NOT be sent anywhere except Open-Meteo fetch (lat/lon only, which is how the API works anyway). Coordinate this with CLAUDE.md › Security.
- **Mirror**: the existing bootstrap from the merge commit.
- **Validate**: `npx tsc --noEmit`

### Task 7: Styles for remove button + search container

- **File**: `src/ui/styles.css`
- **Action**: UPDATE
- **Implement**: append minimal styles for `.card-remove` (small absolute-positioned × button in the corner, accessible focus ring) and `.location-search-container` (block, narrow max-width to match cards). No theme overhaul — keep parity with current Phase-1 look.
- **Validate**: visual (manual; not blocking in sandbox)

### Task 8: Main.test updates + new tests for the slot lifecycle

- **File**: `src/main.test.ts`
- **Action**: UPDATE
- **Implement**:
  - Adjust existing assertions: `FOUR_LOCATIONS` now renders 4 cards + 2 empty custom slots = 6 cards in the grid (or update selector to filter by `.card-name` presence).
  - New test: inject an `InMemoryStorage` + `createCustomSlotStore({storage})` pre-seeded with one custom slot → bootstrap renders 4 default + 1 custom-populated + 1 custom-empty card.
  - New test: simulate the search widget firing `onSelect` (call `store.add` directly with `mountSearchWidget: false`) and assert: a custom card appears, `fetchImpl` was called with the new lat/lon.
  - New test: pre-seed two custom slots → `canAdd()` is false in main; the search widget mount path is unaffected (test the store directly here — DOM-level disabled state is in the search-widget tests).
  - New test: simulate `store.remove(0)` while bootstrapped → the previously populated custom card becomes the empty placeholder; the storage no longer contains the removed entry.
- **Validate**: `npm test -- src/main`

### Task 9: Full validation pass

- **Action**: run the full CLAUDE.md gate.
- **Implement**:
  ```bash
  npm run lint
  npx tsc --noEmit
  npm test
  ```
- **Defer-and-record (CLAUDE.md › Sandbox-blocked checks)**:
  - Real-device iPhone install + offline check (owner-only).
  - Deploy preview.

### Task 10: Final report

- **File**: `.agents/reports/custom-slots-add-remove-persist-report.md`
- **Action**: CREATE
- **Implement**: short narrative covering what landed, the validation results, and any deferred checks.

---

## Risks

| Risk | Mitigation |
|------|------------|
| Existing `main.test.ts` assertions break because the grid grew from `N` to `N + emptyCustomPadding` cards | Update tests as part of Task 8; keep selectors `.card-name` for "real" cards. |
| Card click + remove button event bubbling opens the detail view by accident | `event.stopPropagation()` on the remove button; verify with a Vitest click test. |
| `localStorage` unavailable (private mode on some browsers) throws on access | Defensive try/catch around every read/write; fallback to in-memory; log once. |
| Custom slot data is exfiltrated if we accidentally pass it to a non-Open-Meteo URL | Audit `fetchForecast` call — it already receives `{ lat, lon }` only; no `name` leaves the device. Test asserts this. |
| `id="location-search-input"` clashes if we mount more than one widget | We mount exactly one; on re-mount we `replaceChildren()` the container first. |
| Custom slot dedupe on (lat, lon) only — two distinct places at identical coordinates (impossible in practice) would collapse | Accept this — duplicates are common when users tap the same suggestion twice, and Open-Meteo returns one canonical pair. |
| Race between `add()` and a still-in-flight forecast fetch | `subscribe` triggers `renderNow`, which fires a fresh `Promise.all` — older in-flight promises are simply ignored when their `renderApp` call gets superseded. Acceptable in Phase 1; future story can add abort. |

---

## Environment & Verification

| Verification | Runs in env? | If blocked: where/when verified |
|--------------|--------------|---------------------------------|
| `npm run lint` | yes | — |
| `npx tsc --noEmit` | yes | — |
| `npm test` | yes | — |
| Real iPhone install + offline | no | Owner runs manually after deploy (CH-21) |
| Service-worker eviction behaviour | no | Owner runs manually; outside this story's scope |

---

## Validation

```bash
npm run lint
npx tsc --noEmit
npm test
```

---

## Acceptance Criteria (from issue #9)

- [ ] Empty slot + autocomplete selection → slot fills, weather fetches and caches like defaults.
- [ ] Both free slots full → cannot add a third; defaults are not removable.
- [ ] Filled custom slot → remove releases the slot and drops its cache.
- [ ] App reopened (incl. offline) → slot persists with last data.
- [ ] `npm test` covers add / remove / persist.
- [ ] All tasks completed.
- [ ] `npm run lint && npx tsc --noEmit && npm test` all green in sandbox.
- [ ] Sandbox-blocked verifications recorded (iPhone install / offline observation by owner).
