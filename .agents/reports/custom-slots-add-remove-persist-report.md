# Implementation Report

**Plan**: `.agents/plans/custom-slots-add-remove-persist.plan.md`
**Branch**: `claude/eager-wozniak-5apkd1`
**Issue**: #9 (STORY-009)
**Status**: COMPLETE

## Summary

Closed Phase 4 of the offline-weather PWA: turned STORY-008's `onSelect`
placeholder (which only `console.info`d the picked place) into a real
custom-slot add flow, surfaced an "×" remove button on every custom card,
and persisted the ≤ 2 custom slots to `localStorage` under a separate key
(`weather-custom-slots.v1`) so they survive reload — including offline.

Pure domain logic landed in `src/locations/custom-slots.ts` (capacity check,
deterministic id from rounded coords, dedup, place → slot mapping). IO
mirrors STORY-007's `createForecastCache`: a `createCustomSlotsStore`
factory accepting an injectable `CacheStore`, returning typed
`ReadResult`/`WriteResult` discriminated unions with the same
unsupported/absent/corrupt/wrong-version/quota taxonomy. Removal
fire-and-forget calls `cache.removeSlot(id)` to evict the forecast bytes
in lockstep with the slot list.

`main.ts` reads the persisted custom-slot list before any network call —
which means the first paint on reload (online or offline) renders the
persisted custom slots immediately, then revalidate merges them with the
default slots from env. The search input is mounted-or-replaced via
`mountSearchOrNotice()`: when both custom slots are full, the input is
swapped for a dashed `<p class="custom-slots-full">` notice; when a slot
is removed, the input re-appears. The component (`search-input.ts`) and
the geocoding client (`geocoding-client.ts`) were not touched —
visibility is owned by `main.ts`, keeping the STORY-008 surface stable.

## Tasks Completed

| # | Task | File | Status |
|---|------|------|--------|
| 0 | Verify shipping invariants (CacheStore exported, removeSlot exposed, onSelect placeholder, no existing `kind: 'custom'` branches) | grep checks | ✅ |
| 1 | Create pure domain helpers | `src/locations/custom-slots.ts` | ✅ |
| 2 | Tests for domain helpers | `src/locations/custom-slots.test.ts` (28 cases) | ✅ |
| 3 | Create localStorage IO store | `src/storage/custom-slots-store.ts` | ✅ |
| 4 | Tests for the store | `src/storage/custom-slots-store.test.ts` (17 cases) | ✅ |
| 5 | Extend location-card with optional `onRemove` callback (remove button only on `kind: 'custom'`; `stopPropagation` before callback) | `src/ui/location-card.ts` | ✅ |
| 6 | Tests for the remove button | `src/ui/location-card.test.ts` (+5 cases) | ✅ |
| 7 | Forward `callbacks` through home-screen | `src/ui/home-screen.ts` | ✅ |
| 8 | Tests for home-screen forwarding | `src/ui/home-screen.test.ts` (+2 cases) | ✅ |
| 9 | CSS for remove button + capacity-full notice | `src/ui/styles.css` (hotspot) | ✅ |
| 10 | Wire add/remove + visibility gate into `main.ts` | `src/main.ts` (hotspot) | ✅ |
| 10b | End-to-end JSDOM integration test (substitute for the agent-browser visual demo) | `src/integration.test.ts` (6 cases) | ✅ |
| 11 | Full validation + report | this file | ✅ |

## Validation Evidence

| Check | Command | Result |
|-------|---------|--------|
| Lint | `npm run lint` | exit 0 (no output, no errors) |
| Type check | `npx tsc --noEmit` | exit 0 (no output, no errors) |
| Tests | `npm test` | **272 passed (20 test files), 0 failed** |
| Build | `npm run build` | exit 0; 40.93 kB JS / 5.71 kB CSS / PWA SW + manifest generated |
| Architecture invariant | `grep -E "from '\.\./(storage|ui|weather)" src/locations/custom-slots.ts` | no matches (clean layering) |
| Architecture invariant | `grep -E "from '\.\./(ui|weather)" src/storage/custom-slots-store.ts` | no matches |
| No `innerHTML` | grep across all new + updated files | no matches |
| No `any` types | `grep -nE ': any\b'` across all new + updated source/test files | no matches |
| `cache.removeSlot(id)` is called on remove | `src/main.ts:199` | confirmed (`const evict = cache.removeSlot(id);`) |
| Separate localStorage keys | `weather-custom-slots.v1` (store) ≠ `weather-cache.v1` (forecast cache) | confirmed at `custom-slots-store.ts:14` and `forecast-cache.ts:66` |
| Search-input + geocoding client untouched | `git diff master -- src/ui/search-input.ts src/locations/geocoding-client.ts` | no diff |
| Built bundle contains new code paths | `curl http://127.0.0.1:4173/assets/index-*.js \| grep` | matches: `Custom slots full`, `Remove `, `Search city or place`, `custom-slots-full`, `location-card__remove` |
| Built CSS contains new rules | `curl http://127.0.0.1:4173/assets/index-*.css \| grep` | matches: `.custom-slots-full{`, `.location-card__remove{`, `.location-card__remove:hover{`, `.location-card__remove:focus-visible{` |

Key lines from `npm test`:

```
 Test Files  20 passed (20)
      Tests  272 passed (272)
   Duration  5.58s
```

The new + extended test files contribute 58 cases:
- `src/locations/custom-slots.test.ts` — 28 tests
- `src/storage/custom-slots-store.test.ts` — 17 tests
- `src/integration.test.ts` — 6 tests (end-to-end JSDOM walk)
- `src/ui/location-card.test.ts` — +5 tests (remove button)
- `src/ui/home-screen.test.ts` — +2 tests (remove forwarding)

## Acceptance Criteria Mapping

| # | Acceptance criterion (verbatim) | Evidence |
|---|---|---|
| 1 | Given пустой слот, when выбираю локацию из автокомплита, then слот заполняется, погода для него загружается и кэшируется наравне с дефолтными | `src/locations/custom-slots.ts:23-58` (`placeToSlot`); `src/locations/custom-slots.ts:81-95` (`addCustomSlot`); `src/storage/custom-slots-store.ts:107-152` (`write`); `src/main.ts:155-181` (`handleSelect` — adds, persists, then calls `revalidate(mergedSlots(), ...)` so the new slot is fetched + cached in the same SWR cycle as the defaults). Tests: `custom-slots.test.ts` › *"builds a typed LocationSlot from a geocoding hit (happy path)"*; `custom-slots-store.test.ts` › *"round-trips slots through write → read, attaching kind: 'custom' on the way back"*; `integration.test.ts` › *"AC1: add → persisted → re-added produces same slot id (cache-friendly)"*. |
| 2 | Given оба свободных слота заняты, when смотрю UI, then добавить третью локацию нельзя (кнопка скрыта/disabled), дефолтные слоты удалить нельзя | `src/locations/custom-slots.ts:11` (`MAX_CUSTOM_SLOTS = 2`); `src/locations/custom-slots.ts:73-75` (`canAddCustomSlot`); `src/main.ts:139-152` (`mountSearchOrNotice` swaps the input for the dashed "Custom slots full" notice at the cap); `src/ui/location-card.ts:113-128` (`appendRemoveButton` early-returns when `slot.kind !== 'custom'`, so default cards never get a remove button). Tests: `custom-slots.test.ts` › *"returns false at the cap"* + *"rejects when at capacity (capacity-full)"*; `location-card.test.ts` › *"does NOT render a remove button on a default slot, even if onRemove is provided"*; `integration.test.ts` › *"AC2: at the cap, canAddCustomSlot is false and addCustomSlot returns capacity-full"* + *"AC2: duplicate add is silently rejected"*. |
| 3 | Given заполненный временный слот, when удаляю его, then слот освобождается и его кэш-данные удаляются | `src/locations/custom-slots.ts:97-100` (`removeCustomSlot`); `src/ui/location-card.ts:113-132` (remove button with `event.stopPropagation()` before `onRemove`); `src/main.ts:183-202` (`handleRemove` calls `slotsStore.write` + `cache.removeSlot(id)` + drops the snapshot entry). Tests: `location-card.test.ts` › *"click on remove button calls onRemove(slot.id) and stops propagation"*; `home-screen.test.ts` › *"clicking remove on a custom card calls onRemove and does NOT expand the card"*; `integration.test.ts` › *"AC3: remove evicts both the slot list AND the forecast cache entry"*. |
| 4 | Given добавленный слот, when закрываю и снова открываю приложение (включая офлайн), then слот на месте с последними данными | `src/storage/custom-slots-store.ts:13-14` (`CUSTOM_SLOTS_KEY = 'weather-custom-slots.v1'`, separate from `weather-cache.v1`); `src/storage/custom-slots-store.ts:65-105` (`readDoc` narrows version + shape + drops malformed entries one-by-one); `src/main.ts:52-60` (bootstrap reads the persisted list BEFORE any network call — first paint on reload-while-offline already shows the custom cards from `localStorage`; STORY-007's forecast cache renders the last-known data underneath). Tests: `custom-slots-store.test.ts` › *"round-trips slots through write → read, attaching kind: 'custom' on the way back"* + *"preserves slot order across the round-trip"* + *"default store path round-trips through jsdom localStorage"*; `integration.test.ts` › *"AC4: reload (re-create store) restores the slot list in insertion order"*. |
| 5 | Given логика управления слотами, when запускаю `npm test`, then add/remove/persist покрыты unit-тестами | `src/locations/custom-slots.test.ts` (28 cases — build id, place→slot, capacity, add, remove, dedup, immutability); `src/storage/custom-slots-store.test.ts` (17 cases — round-trip, order, unsupported/absent/corrupt/wrong-version, malformed-entry drops, quota, clear, separate key, kind-not-persisted); `src/ui/location-card.test.ts` (+5 — remove button rendering + propagation); `src/ui/home-screen.test.ts` (+2 — callback forwarding); `src/integration.test.ts` (6 — full domain + store + cache walk-through, one per AC). Suite total: **272 passed / 0 failed**. |

Every AC maps to ≥ 1 file:line implementing it AND ≥ 1 test asserting it. No `DEFERRED — owner` rows.

## Independent Verification

**Round 1** — VERDICT: REFUTED (single procedural finding)

The verifier independently re-ran lint, typecheck (272 passed across 20 files), build, and all the invariant greps — every check was green. AC mapping was re-validated against the actual code and test files. The only finding was procedural: the implementation report file (this file) was missing from the commit and the working tree. All other plan deliverables were confirmed correctly implemented.

Verifier's exact findings (copied verbatim):

> EVIDENCE (commands I ran myself):
> - npm run lint → exit 0; no output (no errors)
> - npx tsc --noEmit → exit 0; no output (no type errors)
> - npm test → exit 0; Test Files 20 passed (20); Tests 272 passed (272)
> - npm run build → exit 0; vite build succeeded, 40.93 kB main bundle, PWA SW generated
> - grep -E "from '\.\./(storage|ui|weather)" src/locations/custom-slots.ts → no output (clean layering)
> - grep -rn innerHTML [new/updated files] → no output (no innerHTML use)
> - grep -nE ': any\b' [new/updated files] → no output (no any types)
> - grep "weather-custom-slots.v1\|weather-cache.v1" [store files] → two separate keys confirmed at custom-slots-store.ts:14 and forecast-cache.ts:66
> - Verified search-input.ts and geocoding-client.ts identical to 8db39e8 (STORY-008 commit)
> - button.type = 'button' confirmed at location-card.ts:123
> - event.stopPropagation() confirmed at location-card.ts:131, before onRemove(slot.id) at :132
> - cache.removeSlot(id) confirmed at main.ts:199
> - buildCustomSlotId uses lat.toFixed(4) and lon.toFixed(4) confirmed at custom-slots.ts:12-14
> - All AC integration tests confirmed passing in integration.test.ts (6 cases, all green)
>
> FINDINGS:
> 1. `.agents/reports/custom-slots-add-remove-persist-report.md` — ABSENT. The plan's "Files to change" table (line 297) explicitly lists this file as CREATE (during /implement), Task 11 item 4 requires writing it, and the Task 11 validate condition states "the report file exists" (line 592). The file does not exist in the working tree or in the STORY-009 commit. All other plan deliverables are correctly implemented.

**Resolution**: this file (the implementation report) was written immediately after the round-1 verdict and committed to the same branch. Round 2 verifier dispatched below.

## E2E Evidence

| Test | Action performed | Observed result |
|------|------------------|-----------------|
| Full integration walk (JSDOM) | `npx vitest run src/integration.test.ts` | 6/6 passed: AC1 add→persist→reload-id-stable; AC2 cap-full + duplicate rejected; AC3 remove evicts both stores; AC4 reload restores order; AC5 no orphaned cache entry post-cycle |
| Production build smoke | `npm run build && npm run preview --port 4173`; `curl http://127.0.0.1:4173/` | HTTP 200; index.html serves the built bundle with manifest + apple-touch-icon |
| Built bundle contains STORY-009 code paths | `curl /assets/index-*.js \| grep` for `Custom slots full`, `Remove `, `custom-slots-full`, `location-card__remove`, `Search city or place` | all five literals present in the minified bundle |
| Built CSS contains STORY-009 rules | `curl /assets/index-*.css \| grep` for `.custom-slots-full` and `.location-card__remove{`/`:hover`/`:focus-visible` | all four rules present |
| Visual end-to-end (preview + headless browser walk) | DEFERRED — `agent-browser` CLI is not installed in this sandbox; per CLAUDE.md › Sandbox-blocked checks, this is a defer-and-record. `src/integration.test.ts` is the testable substitute and exercises the same flow against real `localStorage` + real `createForecastCache` + real DOM. |

## Files Changed

| File | Action | Lines |
|------|--------|-------|
| `src/locations/custom-slots.ts` | CREATE | +102 |
| `src/locations/custom-slots.test.ts` | CREATE | +198 |
| `src/storage/custom-slots-store.ts` | CREATE | +188 |
| `src/storage/custom-slots-store.test.ts` | CREATE | +231 |
| `src/integration.test.ts` | CREATE | +160 |
| `src/main.ts` | UPDATE | +156 / −81 (rewritten bootstrap + handlers) |
| `src/ui/location-card.ts` | UPDATE | +37 / −3 |
| `src/ui/location-card.test.ts` | UPDATE | +71 / −1 |
| `src/ui/home-screen.ts` | UPDATE | +9 / −4 |
| `src/ui/home-screen.test.ts` | UPDATE | +62 / −1 |
| `src/ui/styles.css` | UPDATE | +38 / 0 |

Totals: **5 CREATE source/test files**, **6 UPDATE files**, **1239 insertions / 90 deletions** across the implementation commit (`51c3a1d`). Plus this report (CREATE).

## Deviations from Plan

| Plan asked for | What was done | Why |
|---|---|---|
| Task 5 mirror note suggested wrapping the remove button "in a header row inside `.location-card__body` if alignment looks off" | The remove button is appended as the LAST child of the card (sibling to `.location-card__body`), with `align-self: flex-start` so it pins to the top-right of the flex row. | The card is already `display: flex` (`.location-card`); the body has `flex: 1` and the button has a fixed 28×28 size — alignment looked correct without a second wrapper, and the simpler DOM avoids touching `.location-card__body`'s structure. |
| Plan Task 9 wired the `onSelect` and `onRemove` re-renders inline inside `bootstrap` | Same intent, but the implementation extracted `mergedSlots()`, `renderGrid()`, `forecastsFromSnapshot()`, `lastUpdatedFromSnapshot()`, `mountSearchOrNotice()`, `remountSearch()`, `handleSelect()`, `handleRemove()` into named functions inside the closure | Keeps each step under ~15 lines and avoids re-deriving the same data shape four times across initial paint / first revalidate / visibilitychange / add / remove. No new abstraction across modules — all closures inside `bootstrap`. |
| Plan "Files to change" listed `src/storage/forecast-cache.ts` as UPDATE (verification-only) | Left untouched | Task 0 confirmed `export interface CacheStore` (line 47) and `removeSlot` (line 56) were already exported — no change needed. The row collapsed to a no-op as the plan anticipated. |
| Plan suggested either keeping `searchEl` mounted via `replaceChildren(searchEl, ...)` at every render call OR mounting it once and swapping only the grid | Chose the second option (`replaceChild(next, searchEl)` only on capacity transitions; the grid swap inside `content.replaceChildren(...)` doesn't touch `searchEl`). | Smaller diff against STORY-008's "mount once outside `render()`" principle; revalidate cycles do not re-mount the search input → focus + in-progress query survive. |
| The plan's `searchEl = mountSearchOrNotice()` chained-assignment pattern | Implemented as a discrete `remountSearch()` helper that does `root.replaceChild(next, searchEl); searchEl = next;` | Clearer than a chained assignment inside `replaceChildren`; surface area identical. |
| The plan asked to test removal of a slot whose initial slot list comes from `MOCK_LOCATIONS` | Used inline custom-slot fixtures inside the home-screen test instead | `MOCK_LOCATIONS` is all `kind: 'default'` (`src/locations/mock-locations.ts:7-12`); to assert remove-button rendering you need a custom-kind slot, so the test builds one inline. Same coverage, no shared-fixture refactor needed. |
| Plan Task 11 asked for an agent-browser preview screenshot | Could not run — the `agent-browser` CLI is not installed in this sandbox (the skill directory only contains `SKILL.md`). Recorded as a defer-and-record sandbox-blocked check per CLAUDE.md. Compensated with `src/integration.test.ts`, which walks the same add→cap→remove→reload sequence against real `localStorage` + real `createForecastCache` + real DOM. | Sandbox limitation, not an implementation gap. |

## Tests Written

| Test File | Test Cases |
|-----------|------------|
| `src/locations/custom-slots.test.ts` | constants (2: cap=2, precision=4); `buildCustomSlotId` (3: positive coords, negative coords with double dash, true zero); `placeToSlot` (5: happy path, empty name, invalid lat parametrised ×4, invalid lon parametrised ×3, boundary ±90/±180); `findExistingCustomSlot` (3: existing match, no match, NaN coords defensive); `canAddCustomSlot` (4: empty, below cap, at cap, above cap); `addCustomSlot` (3: appends + immutable, capacity-full, duplicate); `removeCustomSlot` (3: removes named id, absent is no-op, last slot → empty). **28 cases.** |
| `src/storage/custom-slots-store.test.ts` | `unsupported` on null store (2: read/write); `absent` (1); `corrupt` JSON (1); `wrong-version` (1); malformed-entry drops (1, asserts 4 warns / 1 valid slot); round-trip with `kind` re-attach (1); slot-order preserved (1); `kind` NOT persisted on disk (1); empty-write deletes key (1); quota classification (1); non-quota throw → unknown (1); default jsdom round-trip (1); `clear()` removes key (1); read-after-clear → absent (1); top-level non-object → corrupt (1); slots-not-array → corrupt (1). **17 cases.** |
| `src/integration.test.ts` | AC1: add → persist → re-create store → same id; AC2 cap-full + duplicate rejected; AC3 remove evicts both stores; AC4 reload restores insertion order; AC5 full add→remove→reload cycle leaves no orphan. **6 cases.** |
| `src/ui/location-card.test.ts` (extension) | remove button on custom slot when callback provided; absent on default slot; absent when callback missing; click calls onRemove + stops propagation (parent click spy verifies); remove button on custom degraded card. **+5 cases.** |
| `src/ui/home-screen.test.ts` (extension) | remove button count matches custom-slot count, not present on defaults; click triggers `onRemove` AND leaves card collapsed (`aria-expanded=false`, detail hidden). **+2 cases.** |

## Sandbox-blocked items (defer-and-record per CLAUDE.md)

- `npm run preview` + agent-browser walk-through screenshots — the `agent-browser` CLI is not installed in this remote execution container. The preview server itself boots and serves the built bundle (verified via `curl`), and the new strings/classes are present in the bundle. Substituted with `src/integration.test.ts`.
- Real-device iPhone tap test (Add via on-screen keyboard, momentum scroll under the dropdown, reload-while-offline) — owner runs manually after deploy.
- Production deploy / Lighthouse PWA audit — STORY-010 territory.
