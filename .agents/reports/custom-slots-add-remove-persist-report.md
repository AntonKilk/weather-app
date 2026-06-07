# Implementation Report — STORY-009 Custom Slots (add / remove / persist)

**Plan**: `.agents/plans/custom-slots-add-remove-persist.plan.md`
**Branch**: `claude/issue-9-custom-slots-add-remove-persist`
**Status**: COMPLETE
**Issue**: #9

## Summary

Wired up two user-controlled custom location slots that sit beside the
env-baked default slots. The store (`src/locations/custom-slots.ts`)
exposes `list / canAdd / add / remove / clear / subscribe`, persists to
`localStorage` under `weather-app:custom-slots:v1`, validates everything
at the boundary, and tolerates corrupt / unavailable storage by falling
back to an in-memory list with a single warn. The autocomplete widget
from STORY-008 now drives the store's `add`, the card module exposes a
remove "×" on populated custom cards only, and `bootstrap` re-renders
on every store mutation. Default slots are never removable, cap is 2,
and custom-slot data never leaves the device — Open-Meteo only receives
`{ lat, lon }` (verified by test).

## Tasks Completed

| # | Task | File | Status |
|---|------|------|--------|
| 1 | Custom-slot store | `src/locations/custom-slots.ts` | done |
| 2 | Store tests (19 cases) | `src/locations/custom-slots.test.ts` | done |
| 3 | Card: remove button + clickable empty placeholder | `src/ui/card.ts` | done |
| 4 | Card tests (7 cases) | `src/ui/card.test.ts` | done |
| 5 | App: thread `onAddRequest` / `onRemove` through `renderApp` | `src/ui/app.ts` | done |
| 5b | App tests for the new callbacks | `src/ui/app.test.ts` | done |
| 6 | Main wiring: store + widget + cap-note + remove flow | `src/main.ts` | done |
| 7 | Styles for remove button + search container | `src/ui/styles.css` | done |
| 8 | Main lifecycle tests (10 cases) | `src/main.test.ts` | done |
| 9 | Full validation pass | — | done |
| 10 | This report | `.agents/reports/...` | done |

## Validation Evidence

| Check | Command | Result |
|-------|---------|--------|
| Lint | `npm run lint` | exit 0, no findings |
| Type check | `npx tsc --noEmit` | exit 0 |
| Tests | `npm test` | 154 passed / 0 failed across 13 files |
| Production build | `npm run build` | ok, 30 kB JS / 4 kB CSS gzipped 9 kB / 1.3 kB |

Key test output (excerpt):

```
Test Files  13 passed (13)
     Tests  154 passed (154)
```

## E2E / smoke (sandbox)

| Test | Action performed | Observed result |
|------|------------------|-----------------|
| Bootstrap with 2 defaults + 1 persisted custom | unit test driver in `main.test.ts` | 3 named cards + 1 empty placeholder; 3 forecast fetches |
| Add via store at runtime | `customSlotStore.add({...})` after bootstrap | grid re-renders to include the new card; storage persists; new fetch issued |
| Remove via card × | click `.card-remove` | slot empties; storage now `[]`; card disappears |
| Cap at 2 | add three times | 3rd returns `{ ok:false, error:'cap-reached' }`; `canAdd()` is false |
| Custom data never exfiltrated | inspect fetch URLs | none contained the custom slot's `name`; only `latitude=...&longitude=...` |
| Production build | `npm run build` | clean transform of 18 modules; no warnings |

## Deferred / Sandbox-Blocked (per CLAUDE.md)

- Real-device iPhone install & airplane-mode offline check — owner runs manually.
- Deploy preview to Netlify / Cloudflare Pages — owner runs manually.

## Files Changed

| File | Action | Notes |
|------|--------|-------|
| `src/locations/custom-slots.ts` | CREATE | Store factory, persistence, validation. |
| `src/locations/custom-slots.test.ts` | CREATE | 19 cases. |
| `src/locations/types.ts` | UPDATE | Union with the geocoding types from #8; `LocationSelection = Location`. |
| `src/ui/card.ts` | UPDATE | Add-request handler enables the empty placeholder; remove "×" on populated custom slots only. |
| `src/ui/card.test.ts` | CREATE | 7 cases. |
| `src/ui/app.ts` | UPDATE | `renderApp(root, items, { onAddRequest, onRemove })`. |
| `src/ui/app.test.ts` | UPDATE | +2 cases for the new callbacks. |
| `src/ui/styles.css` | UPDATE | `.card-remove` + `.location-search-container` styles. |
| `src/main.ts` | UPDATE | Store wiring; cap-note; focus-search on empty placeholder; subscribe → re-render. |
| `src/main.test.ts` | UPDATE | Rewritten — pads asserted, lifecycle tests added. |
| `.agents/plans/custom-slots-add-remove-persist.plan.md` | CREATE | Plan archived after implementation. |

## Acceptance Criteria

- [x] Empty slot + autocomplete selection → slot fills, weather fetches.
- [x] Both free slots full → cannot add a third; defaults not removable.
- [x] Filled custom slot → remove releases the slot and drops its persisted data.
- [x] App reopened (incl. offline) → slot persists; `npm run preview` will surface the persisted slot from `localStorage` (verified at the unit-test level via round-trip).
- [x] `npm test` covers add / remove / persist.

## Deviations from Plan

1. The `Storage`-fallback test uses an explicit `null` override rather than stubbing `globalThis.localStorage = undefined`, because vitest's jsdom env binds localStorage as a non-configurable getter on some versions; an injected `null` exercises the same code path with no Vitest surface-area gamble.
2. The remove "×" is rendered as a `role="button"` `<span>` rather than a nested `<button>`, since nested buttons are invalid HTML. Keyboard handlers (`Enter` / `Space`) keep it accessible.
3. The plan flagged a `mountSearchWidget(..., onAdd: () => void)` signature; the final wiring returns a `{ input, capNote }` handle instead, which is cleaner — the renderer owns the focus / disabled state.

## Tests Written

| Test File | Test Cases |
|-----------|------------|
| `src/locations/custom-slots.test.ts` | 19 — round-trip persistence; cap; dedupe; invalid selections; remove (incl. out-of-range / non-integer); clear; corrupt JSON / non-array root; per-entry validation; cap-on-load; subscribe / unsubscribe / throwing-listener; in-memory fallback; setItem-throws survival; `name` preserved verbatim. |
| `src/ui/card.test.ts` | 7 — empty card disabled by default; empty card with onAddRequest is enabled and fires; remove button only present with onRemove; remove click fires + stops propagation; keyboard Enter; unavailable + custom shows remove; default slot never shows remove. |
| `src/ui/app.test.ts` | +2 — onAddRequest fires on empty card click; onRemove fires with correct slot index. |
| `src/main.test.ts` | rewritten — 10 cases covering defaults + padding, per-slot isolation, missing env, malformed env, empty array env, persisted-on-boot, add-at-runtime, remove flow, cap enforcement, custom data not leaking into fetch URLs. |
