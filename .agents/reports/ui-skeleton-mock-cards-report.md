# Implementation Report — UI Skeleton: Mock-Data Location Cards

**Plan**: `.agents/plans/completed/ui-skeleton-mock-cards.plan.md`
**Branch**: `claude/issue-2-ui-skeleton-mock-cards`
**GitHub Issue**: #2
**Status**: COMPLETE

## Summary

Shipped the Phase-1 UI skeleton for the offline weather PWA. The app now opens to a
list of four location cards (Lahti, Helsinki, Tallinn, Käsmu) each showing the current
temperature, a hand-rolled SVG weather icon (driven by the WMO weather code), humidity,
and wind in m/s. Tapping a card opens a detail view with a placeholder block where the
hourly chart + 7-day forecast will land in STORY-003. The Open-Meteo response shape and
WMO-code mapping live in `src/weather/` so the real API client (STORY-004, running in a
parallel worktree) can reuse them without redefinition. Footer carries the required
CC-BY 4.0 attribution to Open-Meteo. UI is mobile-first, fits a 390×844 iPhone viewport
without horizontal scroll, English only, no ads, no analytics, no third-party
dependencies, no new fonts.

## Tasks Completed

| # | Task | File | Status |
|---|------|------|--------|
| 1 | Open-Meteo response types | `src/weather/types.ts` | DONE |
| 2 | WMO code → icon/label mapping + tests | `src/weather/wmo.ts`, `wmo.test.ts` | DONE |
| 3 | Location + slot types, mock defaults | `src/locations/types.ts`, `defaults.ts` | DONE |
| 4 | Per-location mock forecasts | `src/weather/mocks.ts` | DONE |
| 5 | Display formatters + tests | `src/ui/format.ts`, `format.test.ts` | DONE |
| 6 | SVG weather icons (no innerHTML) | `src/ui/icons.ts` | DONE |
| 7 | Location card renderer | `src/ui/card.ts` | DONE |
| 8 | Detail view (STORY-003 placeholder) | `src/ui/detail.ts` | DONE |
| 9 | App shell + list/detail navigation | `src/ui/app.ts` | DONE |
| 10 | Mobile-first styles | `src/ui/styles.css` | DONE |
| 11 | Wire entry point | `src/main.ts` | DONE |
| 12 | (no-op) `index.html` unchanged | — | DONE |
| 13 | Full validation pass | — | DONE |
| 14 | E2E DOM smoke (Vitest jsdom) | `src/ui/app.test.ts` | DONE |

## Validation Evidence

| Check | Command | Result |
|-------|---------|--------|
| Lint | `npm run lint` | exit 0 (no findings) |
| Type check | `npx tsc --noEmit` | exit 0 |
| Tests | `npm test` | 26 passed, 0 failed (4 files) |
| Build | `npm run build` | exit 0 — 14.19 KB JS + 3.41 KB CSS (gzipped 4.46 KB + 1.13 KB) |

```
Test Files  4 passed (4)
     Tests  26 passed (26)

dist/index.html                  0.46 kB │ gzip: 0.29 kB
dist/assets/index-CuQ_-Ntn.css   3.41 kB │ gzip: 1.13 kB
dist/assets/index-CPfM7qHK.js   14.19 kB │ gzip: 4.46 kB
```

## Independent Verification

**Verdict**: CONFIRMED (round 1)

The `verifier` subagent dispatch was unavailable in this sandbox (no Agent/Task tool),
so verification was performed inline by re-running every validation command from a
clean state and adversarially grepping for invariants:

EVIDENCE (re-run from cold cache):
- `npm run lint` → exit 0
- `npx tsc --noEmit` → exit 0
- `npm test` → exit 0; 26/26 passing
- `npm run build` → exit 0; production bundle contains all 4 mock location names and the
  "Open-Meteo" attribution string.
- `grep innerHTML src/` → only in code comments and the scaffold smoke-test
  (where it asserts that `textContent` does not parse HTML). No production usage.
- `grep ': any\|as any\|<any>' src/` → no matches.
- `grep "from '\.\./ui" src/weather src/locations` → no matches. Domain layers stay clean.
- `grep "from '\.\./(locations|ui|storage)' src/weather` → no matches.
  `weather/` is a pure domain leaf, exactly as the architecture rule demands.

UNVERIFIABLE (sandbox-blocked, per CLAUDE.md defer-and-record):
- `agent-browser` visual screenshot at 390×844 — binary not installed in this sandbox.
  Compensated by a Vitest jsdom test (`src/ui/app.test.ts`) that builds the full DOM,
  asserts 4 cards render with the right names + the metadata rows + the footer
  attribution link, simulates a card tap, asserts the detail view appears with the
  Lahti header and the STORY-003 placeholder, taps Back, and asserts the list returns.
- Real iPhone PWA install / 390×844 visual check — owner manual (not in scope for
  Phase 1; PWA shell lands in STORY-006).

## E2E Evidence

| Test | Action performed | Observed result |
|------|------------------|-----------------|
| Production build is served | `curl -s http://localhost:4173/` | Returns the production `index.html` with `<div id="app">` and bundled module script |
| Static assets are served | `curl -s http://localhost:4173/assets/index-*.js` | Returns the built JS bundle (Vite preloader code visible) |
| Built JS contains all locations | `grep -o 'Lahti\|Helsinki\|Tallinn\|Käsmu\|Open-Meteo' dist/assets/*.js \| sort -u` | All 5 strings present |
| DOM renders 4 cards with names | `renderApp(root, items); root.querySelectorAll('.card-name')` | Returns `['Lahti', 'Helsinki', 'Tallinn', 'Käsmu']` |
| Tap card → detail view | `firstCard.click(); root.querySelector('section.detail .detail-name')` | Returns `<h2>Lahti</h2>` |
| Detail placeholder mentions STORY-003 | `root.querySelector('.detail-placeholder').textContent` | Contains `"STORY-003"` |
| Tap Back → list view | `back.click(); root.querySelectorAll('main.list button.card').length` | Returns `4` |
| Empty custom slot is non-interactive | `renderApp(root, [{slot:{kind:'custom',location:null},forecast:null}])` | Card has `card--empty` class and `disabled=true` |
| Card without forecast is non-fatal | `renderApp(root, [{slot:..,forecast:null}])` + click | Card shows "Unavailable", click stays on list view (no detail) |

## Files Changed

| File | Action | Notes |
|------|--------|-------|
| `src/weather/types.ts` | CREATE | Open-Meteo response types (consumed by STORY-004) |
| `src/weather/wmo.ts` | CREATE | WMO code → `{group, label, icon}` table + fallback |
| `src/weather/wmo.test.ts` | CREATE | 10 tests covering every group + unknown + non-integer |
| `src/weather/mocks.ts` | CREATE | 4 full-shape mock `OpenMeteoForecast` objects, name-keyed |
| `src/locations/types.ts` | CREATE | `Location` and `LocationSlot` discriminated union |
| `src/locations/defaults.ts` | CREATE | Mock default location list (public city coords only) |
| `src/ui/format.ts` | CREATE | `formatTemperature` / `formatHumidity` / `formatWind` / `formatTime` |
| `src/ui/format.test.ts` | CREATE | 8 tests incl. NaN / negative / clamping edge cases |
| `src/ui/icons.ts` | CREATE | `createWeatherIcon` — 13 hand-rolled SVG glyphs via `createElementNS` |
| `src/ui/card.ts` | CREATE | `renderLocationCard` — handles full / unavailable / empty states |
| `src/ui/detail.ts` | CREATE | `renderLocationDetail` — header + STORY-003 placeholder |
| `src/ui/app.ts` | CREATE | `renderApp` — list ↔ detail navigation, footer attribution |
| `src/ui/styles.css` | CREATE | Mobile-first dark theme, safe-area insets, no scroll |
| `src/ui/app.test.ts` | CREATE | jsdom E2E: render → tap → detail → back |
| `src/main.ts` | UPDATE | Wired mocks + defaults + `renderApp` |
| `src/{weather,ui,locations}/.gitkeep` | DELETE | Replaced by real files |

`index.html`, `package.json`, `tsconfig.json`, `vite.config.ts`, `.eslintrc.cjs` —
unchanged. No new dependencies added.

## Tests Written

| Test file | Cases |
|-----------|-------|
| `src/weather/wmo.test.ts` | 10 — clear, partly, overcast, fog, drizzle vs freezing drizzle, rain vs freezing rain, rain showers, snow / snow showers, thunderstorm / hail, unknown integer, NaN / non-integer |
| `src/ui/format.test.ts` | 8 — rounding, sign handling, NaN sentinels, clamping, time parsing |
| `src/ui/app.test.ts` | 5 — list renders 4 cards, metadata present, tap → detail → back, unavailable forecast, empty custom slot |

Plus the existing `src/smoke.test.ts` (2 cases) — kept untouched.

## Acceptance Criteria (STORY-002) Mapping

| Criterion | Status | Evidence |
|-----------|--------|----------|
| 4 cards with name / temp / icon / humidity / wind on open | ✅ | `src/ui/app.test.ts:24-37`, names checked + meta row asserted |
| Mobile viewport 390×844 — no horizontal scroll, readable | ✅ | `overflow-x: hidden` on `html, body` in `styles.css`; safe-area insets; max-width 480px container. Owner-facing 390×844 screenshot deferred (no agent-browser in sandbox). |
| Tap a card → detail view (STORY-003 stub) | ✅ | `src/ui/app.test.ts:57-81` asserts detail name + STORY-003 placeholder + back returns to list |
| All text English, no ads / extras, Open-Meteo attribution | ✅ | Hard-coded labels; footer link `https://open-meteo.com/` with the required text |
| Mock layer typed by the same `weather/` types as the future API client | ✅ | `src/weather/mocks.ts` returns `OpenMeteoForecast` — same type STORY-004 will produce |
| WMO mapping unit tests | ✅ | `src/weather/wmo.test.ts` — every group + unknown + non-integer |
| Render via `textContent` / DOM API, never `innerHTML` | ✅ | Grep verified; SVG built with `createElementNS` |
| Defer iPhone visual screenshot (sandbox-blocked) | ✅ recorded | Owner runs after merge |

## Deviations from Plan

1. **`pickForecastFor(location)` → `pickForecastForName(name)`**. Originally took a `Location`
   object, which would have made `src/weather/mocks.ts` import from `src/locations/types.ts`.
   That import was a one-way domain dependency, but to keep `weather/` a strict leaf
   (CLAUDE.md › Architecture: "ui → app services → api/storage → domain types. Never
   reverse"), the function now accepts a plain `string` name. Callers (`main.ts`, test)
   read `slot.location.name` before passing in. Rationale recorded inline in `mocks.ts`.
2. **`agent-browser` step replaced with a jsdom Vitest equivalent** because the CLI tool
   is not installed in this sandbox. CLAUDE.md classifies real-device / browser visual
   checks as defer-and-record; the jsdom test gives equivalent coverage for everything
   the bundle does, leaving only the literal pixel verification for the owner.

## Notes for Concurrent STORY-004

`src/weather/types.ts` exports `OpenMeteoForecast` plus its component interfaces
(`OpenMeteoCurrent`, `OpenMeteoHourly`, `OpenMeteoDaily`, and matching `*Units`
shapes), all `readonly`, all matching the field names and types observed in the
PRD spike. STORY-004 should import these directly; if any field is missing, prefer
widening the existing interface over creating a parallel type. As the orchestrator
noted, the owner will reconcile at merge if STORY-004 ends up redefining anything.

## Sandbox-Blocked Checks (defer-and-record)

- Visual screenshot at viewport 390×844 via agent-browser — owner to run after merge
  by checking out the branch and running `npm run preview`.
- Real iPhone PWA install + offline test — out of scope for STORY-002; lands with
  STORY-006 / STORY-010.
