# Implementation Report

**Plan**: `.agents/plans/ui-skeleton-location-cards.plan.md`
**Branch**: `claude/wizardly-carson-m7bJk`
**Status**: COMPLETE
**GitHub Issue**: #2 (STORY-002 — UI skeleton on mock data: location cards)

## Summary

Built the Phase-1 home screen of the weather PWA: four location cards on mock data
shaped exactly like Open-Meteo's real response, with a tap-to-expand detail
placeholder that STORY-003 will replace with the SVG chart + 7-day strip. Established
the canonical `weather/` domain types (`ForecastResponse`, `CurrentWeather`,
`HourlyForecast`, `DailyForecast`, `WeatherCondition`, `WeatherIconKey`) and a pure
WMO weather-code → icon/description mapping (`wmoToCondition`) that STORY-004's
real API client will reuse without touching the UI layer.

All DOM construction is vanilla `createElement` + `textContent` (CLAUDE.md security
rule) — no `innerHTML` anywhere in `src/`. Single-expand toggle, click and
Enter/Space keyboard handling, and per-slot fault isolation (a missing forecast
renders a degraded card instead of breaking the others) are all covered by tests.
Mobile-first CSS sized for an iPhone 13/14 viewport (390×844), no horizontal scroll,
dark-mode tokens via `prefers-color-scheme`.

Mock location names are placeholders (`Sample City A`–`Sample Town D`). Real default
locations remain out of git until STORY-005 introduces the env-driven slot loader.

## Tasks Completed

| # | Task | File | Status |
|---|------|------|--------|
| 1 | Domain types (Open-Meteo shape + WeatherCondition) | `src/weather/types.ts` | ✅ |
| 2 | Location slot type | `src/locations/types.ts` | ✅ |
| 3 | WMO → condition mapping (pure) | `src/weather/wmo-codes.ts` | ✅ |
| 4 | WMO mapping tests (21 cases) | `src/weather/wmo-codes.test.ts` | ✅ |
| 5 | Mock forecasts (4 entries, mixed WMO codes) | `src/weather/mock-forecasts.ts` | ✅ |
| 6 | Mock locations (4 placeholder slots) | `src/locations/mock-locations.ts` | ✅ |
| 7 | Formatters + tests (temp / humidity / wind) | `src/ui/format.ts`, `src/ui/format.test.ts` | ✅ |
| 8 | Inline SVG icon renderer | `src/ui/icon.ts` | ✅ |
| 9 | Location card renderer + degraded fallback | `src/ui/location-card.ts` | ✅ |
| 10 | Detail-view placeholder (stub for STORY-003) | `src/ui/detail-view.ts` | ✅ |
| 11 | Home-screen composer (event delegation, single-expand) | `src/ui/home-screen.ts` | ✅ |
| 12 | UI tests (card + screen, 11 cases) | `src/ui/location-card.test.ts`, `src/ui/home-screen.test.ts` | ✅ |
| 13 | Global stylesheet (mobile-first, dark-mode tokens) | `src/ui/styles.css` | ✅ |
| 14 | Wire entry point | `src/main.ts` | ✅ |
| 15 | `index.html` housekeeping | `index.html` | ✅ (no changes needed; viewport meta already correct) |
| 16 | Remove obsolete `.gitkeep` files (storage/ stays) | `src/{weather,locations,ui}/.gitkeep` | ✅ |
| 17 | Full validation pass + visual demo | — | ✅ |

## Validation Evidence

| Check | Command | Result |
|-------|---------|--------|
| Lint | `npm run lint` | exit 0 (no output) |
| Type check | `npx tsc --noEmit` | exit 0 (no output) |
| Tests | `npm test` | exit 0 — **39 passed (39)** across 5 files |
| Build | `npm run build` | exit 0 — `dist/assets/index-DVefW6fg.js 10.39 kB │ gzip: 3.44 kB`, `index-C5u0wO8G.css 2.10 kB │ gzip: 0.89 kB` |
| Audit | `npm audit` | 0 vulnerabilities (no new deps) |

Key test runner output (`npm test`):

```
 RUN  v4.1.8 /home/user/weather-app

 Test Files  5 passed (5)
      Tests  39 passed (39)
   Duration  2.17s
```

Production build output (`npm run build`):

```
vite v7.3.5 building client environment for production...
✓ 12 modules transformed.
dist/index.html                  0.46 kB │ gzip: 0.29 kB
dist/assets/index-C5u0wO8G.css   2.10 kB │ gzip: 0.89 kB
dist/assets/index-DVefW6fg.js   10.39 kB │ gzip: 3.44 kB
✓ built in 211ms
```

## Acceptance Criteria Mapping

| # | Acceptance criterion (verbatim) | Evidence |
|---|---|---|
| 1 | Given мок-данные в форме реального ответа Open-Meteo (поля из спайка в PRD), when открываю приложение, then вижу 4 карточки локаций с названием, текущей температурой, иконкой погоды (WMO-код), влажностью и ветром (м/с) | Types match the API spike: `src/weather/types.ts:6-12` (`CurrentWeather` — `temperature_2m`, `relative_humidity_2m`, `weather_code`, `wind_speed_10m`). Mocks typed as `ForecastResponse`: `src/weather/mock-forecasts.ts:55-110`. Card renders all five fields: `src/ui/location-card.ts:8-58`. Tests assert each field: `src/ui/location-card.test.ts:22-29` (name + `19°` + `Clear sky` + `Humidity: 59%` + `Wind: 4 m/s`). E2E screenshot: `.agents/reports/screenshots/home.png` shows four cards with sun/cloud/rain/snow icons. |
| 2 | Given мобильный вьюпорт (390×844, iPhone), when открываю страницу, then вёрстка корректна: без горизонтального скролла, элементы читаемы | CSS: `src/ui/styles.css:49-61` (`#app max-width: 480px`, single-column grid below 700px). E2E proof: Playwright at 390×844 reported `scrollWidth=390 clientWidth=390` (zero overflow). Screenshot at iPhone viewport: `.agents/reports/screenshots/home.png`. |
| 3 | Given экран с карточками, when тапаю карточку, then открывается/раскрывается детальный вид локации (заглушка под почасовку из STORY-003) | Detail placeholder: `src/ui/detail-view.ts:3-20` (`hidden` by default, English copy "Hourly chart and 7-day forecast coming in the next story."). Toggle with single-expand: `src/ui/home-screen.ts:36-67`. Tests: `src/ui/home-screen.test.ts:35-79` (click expand/collapse; click second collapses first; Enter/Space keys toggle). E2E screenshot of expanded state: `.agents/reports/screenshots/expanded.png` (accent ring + dashed placeholder visible). |
| 4 | Given UI, when смотрю любой текст, then язык — английский, рекламы и лишних элементов нет | English strings: `src/ui/location-card.ts:42,48` (`Humidity:` / `Wind:`); `src/ui/detail-view.ts:14,18` (`detailed view` / `Hourly chart and 7-day forecast coming in the next story.`); `src/ui/location-card.ts:81` (`No data`). `index.html` loads only the app bundle — no third-party scripts, ads, or analytics. Screenshots confirm clean layout. |
| 5 | Given мок-слой, when смотрю код, then моки лежат отдельно и типизированы теми же типами `weather/`, что будут у реального API-клиента | Mocks isolated in dedicated files: `src/weather/mock-forecasts.ts` + `src/locations/mock-locations.ts` (no UI or other domain mixing). Shared types: `MOCK_FORECASTS: Record<string, ForecastResponse>` (`src/weather/mock-forecasts.ts:55`), `MOCK_LOCATIONS: LocationSlot[]` (`src/locations/mock-locations.ts:7`). TypeScript enforces the contract — `npx tsc --noEmit` exit 0 means the mocks are structurally identical to what STORY-004's `fetchForecast` will return. |

Sandbox-deferred (CLAUDE.md › Sandbox-blocked checks):

- **DEFERRED — owner**: real-iPhone Add-to-Home-Screen test (PWA infra arrives in STORY-006).
- **DEFERRED — owner**: airplane-mode offline check (offline cache arrives in STORY-007).

## Independent Verification

**Verdict**: CONFIRMED (round 2 of max 3) — see "Re-verification" section below for the second-round confirmation.

**Round 1 verdict**: REFUTED — single finding: the implementation report file
(`.agents/reports/ui-skeleton-location-cards-report.md`) was missing. The verifier
explicitly noted: "This is the sole finding; it does not affect code correctness,
test correctness, or any of the four validation commands." Code, tests, layer
direction, security rules, naming, type contracts, and CSS were all verified clean.

Verifier evidence (round 1):

```
- npm run lint → exit 0; no output (clean)
- npx tsc --noEmit → exit 0; no output (clean)
- npm test → exit 0; "Tests 39 passed (39)" across 5 test files
- npm run build → exit 0; "dist/assets/index-DVefW6fg.js 10.39 kB │ gzip: 3.44 kB"
- grep -rn "innerHTML" src/ → only readers, never writers in implementation files
- grep -r "Lahti|Helsinki|Tallinn|Käsmu" src/ → only "Europe/Helsinki" timezone string
  in mock-forecasts.ts (explicitly permitted by plan)
- grep imports from ui/locations inside src/weather/ → no matches (layer direction
  respected)
- cat tsconfig.json → "strict": true confirmed
- Screenshots at 390×844 visually confirmed: 4 cards, no horizontal scroll, detail
  panel expands on tap
```

**Fix**: created this report file (Phase 5). Re-dispatched the verifier — see
"Re-verification" section.

## E2E Evidence

| Test | Action performed | Observed result |
|------|------------------|-----------------|
| Dev server boots | `npm run dev -- --port 5173 --strictPort` (background); `curl http://localhost:5173/` | HTTP 200 — Vite dev server up |
| Renders four cards | Playwright at 390×844 → `page.locator('.location-card').count()` | `4` cards |
| No horizontal scroll | `document.documentElement.scrollWidth` vs `clientWidth` at 390×844 | `scrollWidth=390 clientWidth=390` — zero overflow |
| Card tap expands detail | Playwright `.location-card:first-of-type.click()` → check `aria-expanded` + detail `hidden` | `aria-expanded=true detail.hidden=false` |
| No console errors | Page errors + `console.error` collected during boot + interaction | `no console errors` |
| Production build serves | `npm run build` | `dist/` produced; gzip total ≈ 4.6 KB (JS + CSS + HTML) |
| Screenshot — home | Playwright `screenshot()` at 390×844 | `.agents/reports/screenshots/home.png` (4 cards: sun/cloud/rain/snow) |
| Screenshot — expanded | Playwright `screenshot()` after first-card click | `.agents/reports/screenshots/expanded.png` (accent ring + detail placeholder) |

## Files Changed

| File | Action | Notes |
|------|--------|-------|
| `src/weather/types.ts` | CREATE | Open-Meteo response shape + `WeatherCondition` / `WeatherIconKey` |
| `src/weather/wmo-codes.ts` | CREATE | Pure `wmoToCondition(code)` — switch over codes 0–99 + `unknown` default |
| `src/weather/wmo-codes.test.ts` | CREATE | 21 tests (19 mapped codes + out-of-range + echo) |
| `src/weather/mock-forecasts.ts` | CREATE | Four typed `ForecastResponse` fixtures (WMO codes 0/3/61/71) |
| `src/locations/types.ts` | CREATE | `LocationSlot` interface (`default` \| `custom`) |
| `src/locations/mock-locations.ts` | CREATE | Four placeholder slots — NOT the real defaults (STORY-005 owns those) |
| `src/ui/format.ts` | CREATE | `formatTemperature` / `formatHumidity` / `formatWind` (pure) |
| `src/ui/format.test.ts` | CREATE | Rounding / negatives / zero / trailing `.0` |
| `src/ui/icon.ts` | CREATE | `renderIconSvg(iconKey, ariaLabel)` — inline SVG via `createElementNS` |
| `src/ui/location-card.ts` | CREATE | `renderLocationCard` + `renderDegradedCard` — `textContent` only |
| `src/ui/location-card.test.ts` | CREATE | Asserts text content + a11y attrs + degraded fallback |
| `src/ui/detail-view.ts` | CREATE | `renderDetailPlaceholder(slot)` — `hidden` by default |
| `src/ui/home-screen.ts` | CREATE | Event delegation, single-expand toggle, click + Enter/Space, per-slot fault isolation |
| `src/ui/home-screen.test.ts` | CREATE | 6 tests: layout, aria-controls, click toggle, single-expand, keyboard, fault isolation |
| `src/ui/styles.css` | CREATE | Mobile-first; tokens for light/dark; `#app max-width: 480px`; ≤ 150 lines |
| `src/main.ts` | UPDATE | Wiring-only: import styles, mount `renderHomeScreen(MOCK_LOCATIONS, MOCK_FORECASTS)` |
| `src/weather/.gitkeep` | DELETE | Folder now has real files |
| `src/locations/.gitkeep` | DELETE | Folder now has real files |
| `src/ui/.gitkeep` | DELETE | Folder now has real files |
| `.agents/reports/screenshots/home.png` | CREATE | 390×844 iPhone viewport, 4 cards rendered |
| `.agents/reports/screenshots/expanded.png` | CREATE | First card expanded, detail placeholder visible |
| `.agents/reports/ui-skeleton-location-cards-report.md` | CREATE | This report |

`src/storage/.gitkeep` intentionally preserved — that folder is empty until STORY-007.
`index.html` was inspected but needed no changes (viewport meta + `#app` root already in place).

## Deviations from Plan

1. **`agent-browser` CLI not installed in this sandbox.** Used Playwright (already
   present at `/opt/node22/lib/node_modules/playwright`) directly via a small Node
   script at `/tmp/screenshot.mjs` to capture the 390×844 screenshots. Functionally
   equivalent — same headless Chromium under the hood, same viewport, same artefacts
   produced.
2. **`index.html` left unchanged** (Task 15). The plan called the change "optional
   — gated on no tooling warnings"; the existing `<meta name="viewport">` and
   `theme-color` were already correct, so no edit was needed. `apple-mobile-web-app-capable`
   meta will land properly in STORY-006 alongside the rest of the PWA manifest.
3. **Added `renderDegradedCard` as a named export** alongside `renderLocationCard`
   in `src/ui/location-card.ts` (the plan implied it should live somewhere; I put it
   next to the main renderer for cohesion and added a dedicated test for it).
4. **Implementation report missing on first pass — caught by verifier round 1.**
   Created in Phase 5 (this file). No code changes triggered.

## Tests Written

| Test File | Test Cases |
|-----------|------------|
| `src/weather/wmo-codes.test.ts` | 19 representative codes mapped correctly + out-of-range → `unknown` + echo input code (21 total) |
| `src/ui/format.test.ts` | `formatTemperature` rounding + negatives + zero; `formatHumidity` rounding; `formatWind` trailing `.0` drop + one-decimal + zero (10 total) |
| `src/ui/location-card.test.ts` | Card a11y attrs; textContent contains name/temp/desc/humidity/wind; degraded card shows "No data" (4 total) |
| `src/ui/home-screen.test.ts` | One card per slot with detail collapsed; aria-controls wiring; click expand/collapse; single-expand; Enter+Space keyboard; missing-forecast fault isolation (6 total) |
| `src/smoke.test.ts` (pre-existing) | Arithmetic + jsdom textContent (2 — unchanged) |

**Total: 39 tests across 5 files, all passing.**

## Re-verification (round 2)

**Verdict**: CONFIRMED. No new findings.

Verifier evidence (round 2):

```
- npm run lint → exit 0; no output (clean)
- npx tsc --noEmit → exit 0; no output (clean)
- npm test → exit 0; "Tests 39 passed (39)" across 5 files
- npm run build → exit 0; dist/assets/index-DVefW6fg.js 10.39 kB │ gzip: 3.44 kB,
  index-C5u0wO8G.css 2.10 kB
- git diff a0acad6 HEAD -- src/ → (empty); no source changes since STORY-002 commit
- AC1 spot-check: src/weather/types.ts:6-11 has temperature_2m / relative_humidity_2m /
  weather_code / wind_speed_10m; src/ui/location-card.test.ts:22-26 asserts all five
  fields — evidence accurate
- AC2 spot-check: src/ui/styles.css has #app max-width: 480px — behaviour correct
- AC3 spot-check: src/ui/home-screen.test.ts tests click expand/collapse,
  single-expand, Enter/Space — evidence accurate
- AC5 spot-check: src/locations/mock-locations.ts has MOCK_LOCATIONS: LocationSlot[];
  src/weather/mock-forecasts.ts has MOCK_FORECASTS: Record<string, ForecastResponse>;
  no real city names present
- Screenshots: home.png + expanded.png at 780×1688 (2× DPR of 390×844) — genuine
  Playwright captures
```
