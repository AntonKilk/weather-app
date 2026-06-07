# Plan: UI skeleton on mock data — location cards

## Summary

Render the home screen of the PWA as four location cards on mock data, shaped exactly
like Open-Meteo's real response so STORY-004's API client drops in without touching
the UI layer. The work introduces the canonical `weather/` domain types
(`ForecastResponse`, `LocationSlot`, `WeatherCondition`), a pure WMO weather-code →
icon/description mapping with unit tests, a typed mock fixture, and a vanilla-DOM
renderer that builds the grid via `document.createElement`/`textContent` (never
`innerHTML`). Tapping a card toggles an inline detail-view placeholder that
STORY-003 will replace with the SVG chart + 7-day strip. CSS is mobile-first, sized
for an iPhone 13/14 viewport (390×844) with no horizontal scroll.

## User Story

As a user, I want to see a screen with cards for all my locations (name, current
temperature, weather icon, humidity, wind) so that I can read the weather at a
glance — and so the owner can demo and discuss the visual today.

## Metadata

| Field | Value |
|-------|-------|
| Type | NEW_CAPABILITY |
| Complexity | MEDIUM |
| GitHub Issue | #2 |
| PRD | `.agents/PRDs/offline-weather-pwa.prd.md` (Phase 1 — UI skeleton) |
| Stories | `.agents/stories/offline-weather-pwa.stories.md` → STORY-002 |
| Branch | `claude/wizardly-carson-m7bJk` |

---

## Patterns to follow

| Category | File:lines | Pattern |
|----------|-----------|---------|
| LAYERING | `CLAUDE.md` › Architecture | `ui/` may import from `weather/` (types) and `locations/` (slots); `weather/` must NOT import from `ui/` or `storage/`. Verified by code review — no lint rule enforces it. |
| NAMING | `CLAUDE.md` › Code Patterns | Files kebab-case (`location-card.ts`); types PascalCase (`ForecastResponse`); functions/vars camelCase (`renderLocationCard`). |
| ENTRY WIRING | `src/main.ts:5-20` | Resolve `#app` once, log via `console.error` if missing, build subtree with `document.createElement` + `textContent`, `.append(...)` it. **No `innerHTML`.** Wiring-only — no business logic. |
| TYPES | `CLAUDE.md` › Code Patterns › Types | Model Open-Meteo response shape explicitly. Validation/narrowing happens at the API boundary (STORY-004 owns it). For STORY-002, mocks satisfy the same types so the type wall is real from day one. |
| TESTS | `src/smoke.test.ts:1-16` | Vitest, jsdom env (already wired in `vite.config.ts:7-11`), co-located `*.test.ts`, `globals: false` → import `{describe, expect, it}` from `vitest`. Focus on domain logic (WMO map), not DOM snapshots. |
| SECURITY | `CLAUDE.md` › Security | Render API-sourced strings with `textContent`. Mock location names are placeholders — never commit real defaults. |
| ERROR HANDLING | `CLAUDE.md` › Error handling | One bad slot must not break the others. Even on mocks, isolate per-card rendering in a try/catch so future fault-tolerance is baked in. |

Greenfield notes — these rows have no prior in-repo precedent, so the row above
"establishes" the pattern (don't mirror anything older):

- WMO mapping → first domain mapping in the repo.
- Location card → first UI component in the repo.
- CSS layout → first stylesheet in the repo (and `src/ui/` global styles file is the
  CLAUDE.md hotspot — keep it tight, mobile-first).

---

## Open-Meteo response shape (verified by PRD spike 2026-06-07)

The forecast call used in the project is:

```
https://api.open-meteo.com/v1/forecast
  ?latitude={lat}&longitude={lon}
  &current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m
  &hourly=temperature_2m,precipitation,precipitation_probability,weather_code
  &daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum
  &timezone=auto&wind_speed_unit=ms&forecast_days=7
```

STORY-002 only needs `current` for the card; `hourly`/`daily` shapes are included
in the types so STORY-003 and STORY-004 don't have to redefine them. The exact field
names above ARE the contract between mocks and the future API client.

Units:
- temperature: °C (default)
- humidity: % (integer-ish)
- wind: m/s (via `wind_speed_unit=ms`)
- precipitation: mm
- precipitation_probability: %

---

## Files to change

| File | Action | Purpose |
|------|--------|---------|
| `src/weather/types.ts` | CREATE | Open-Meteo `ForecastResponse` (current + hourly + daily) + derived `WeatherCondition`. |
| `src/weather/wmo-codes.ts` | CREATE | Pure `wmoToCondition(code)` → `WeatherCondition` (no DOM, no IO). |
| `src/weather/wmo-codes.test.ts` | CREATE | Unit tests for the WMO mapping. |
| `src/weather/mock-forecasts.ts` | CREATE | Four typed `ForecastResponse` fixtures shaped like the real API. |
| `src/weather/.gitkeep` | DELETE | Folder now has real files. |
| `src/locations/types.ts` | CREATE | `LocationSlot` (`default` \| `custom`, name/lat/lon). |
| `src/locations/mock-locations.ts` | CREATE | Four placeholder `LocationSlot`s (NOT the real defaults). Pairs slot → mock forecast key. |
| `src/locations/.gitkeep` | DELETE | Folder now has real files. |
| `src/ui/icon.ts` | CREATE | `renderIconSvg(iconKey)` — returns a tiny inline `<svg>` element per `iconKey`. |
| `src/ui/format.ts` | CREATE | Pure formatters: temperature (°C, 0-decimals), humidity (%), wind (m/s, 1-decimal). |
| `src/ui/format.test.ts` | CREATE | Tests for formatters (rounding/edge cases). |
| `src/ui/location-card.ts` | CREATE | `renderLocationCard(slot, forecast)` → `HTMLElement`. Pure DOM construction; `textContent` only. |
| `src/ui/detail-view.ts` | CREATE | `renderDetailPlaceholder(slot)` → `HTMLElement`. Stub for STORY-003. |
| `src/ui/home-screen.ts` | CREATE | `renderHomeScreen(slots, forecasts)` — builds list of cards, wires tap → toggle detail panel. Returns `HTMLElement`. |
| `src/ui/location-card.test.ts` | CREATE | Renders a card from a mock and asserts text content + ARIA-friendly structure. |
| `src/ui/home-screen.test.ts` | CREATE | Renders the grid, simulates a click, asserts toggle behaviour. |
| `src/ui/styles.css` | CREATE | Mobile-first stylesheet, 390-wide viewport target, no horizontal scroll. **Hotspot (per CLAUDE.md).** |
| `src/ui/.gitkeep` | DELETE | Folder now has real files. |
| `src/main.ts` | UPDATE | Import styles, build slot+forecast pairs from mocks, mount `renderHomeScreen` into `#app`. |
| `index.html` | UPDATE | Add `<meta name="color-scheme" content="light dark">` if missing; keep viewport meta; nothing else. |

Counts: **15 CREATE**, **2 UPDATE**, **3 DELETE** (`.gitkeep` files).

---

## Type contracts (authoritative — write these exactly)

`src/weather/types.ts`:

```ts
export interface CurrentWeather {
  time: string;            // ISO-8601 local (timezone=auto)
  temperature_2m: number;  // °C
  relative_humidity_2m: number; // %
  weather_code: number;    // WMO code
  wind_speed_10m: number;  // m/s
}

export interface HourlyForecast {
  time: string[];                       // ISO-8601 local
  temperature_2m: number[];             // °C, aligned with time[]
  precipitation: number[];              // mm
  precipitation_probability: number[];  // %
  weather_code: number[];               // WMO code
}

export interface DailyForecast {
  time: string[];                  // ISO-8601 dates
  weather_code: number[];          // WMO code
  temperature_2m_max: number[];    // °C
  temperature_2m_min: number[];    // °C
  precipitation_sum: number[];     // mm
}

export interface ForecastResponse {
  latitude: number;
  longitude: number;
  timezone: string;
  current: CurrentWeather;
  hourly: HourlyForecast;
  daily: DailyForecast;
}

export type WeatherIconKey =
  | 'clear'
  | 'mostly-clear'
  | 'partly-cloudy'
  | 'cloudy'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'freezing-rain'
  | 'snow'
  | 'snow-showers'
  | 'thunderstorm'
  | 'unknown';

export interface WeatherCondition {
  code: number;
  description: string;     // human English, e.g. "Mostly sunny"
  iconKey: WeatherIconKey;
}
```

`src/locations/types.ts`:

```ts
export interface LocationSlot {
  id: string;              // stable key: 'mock-1' for now; real impl uses slug
  name: string;            // display name
  latitude: number;
  longitude: number;
  kind: 'default' | 'custom';
}
```

---

## WMO mapping (authoritative)

Defined once in `src/weather/wmo-codes.ts`. Source: Open-Meteo docs (verified PRD).

| Codes | description | iconKey |
|-------|-------------|---------|
| 0 | "Clear sky" | `clear` |
| 1 | "Mainly clear" | `mostly-clear` |
| 2 | "Partly cloudy" | `partly-cloudy` |
| 3 | "Overcast" | `cloudy` |
| 45, 48 | "Fog" | `fog` |
| 51, 53, 55 | "Drizzle" | `drizzle` |
| 56, 57 | "Freezing drizzle" | `freezing-rain` |
| 61, 63, 65 | "Rain" | `rain` |
| 66, 67 | "Freezing rain" | `freezing-rain` |
| 71, 73, 75 | "Snow" | `snow` |
| 77 | "Snow grains" | `snow` |
| 80, 81, 82 | "Rain showers" | `rain` |
| 85, 86 | "Snow showers" | `snow-showers` |
| 95 | "Thunderstorm" | `thunderstorm` |
| 96, 99 | "Thunderstorm with hail" | `thunderstorm` |
| anything else | "Unknown" | `unknown` |

Function signature:

```ts
export function wmoToCondition(code: number): WeatherCondition;
```

---

## Mock fixtures

`src/weather/mock-forecasts.ts` exports `MOCK_FORECASTS: Record<string, ForecastResponse>`,
keyed by the same `id` used in `LocationSlot`. Provide four entries (`mock-1` …
`mock-4`) covering a variety of WMO codes (clear / partly cloudy / rain / snow) so the
icon mapping is visually exercised. Each entry must include realistic shapes:
- `current`: one observation.
- `hourly`: 24 evenly-spaced hours (filler — STORY-003 uses it).
- `daily`: 7 days.
- `timezone`: `"Europe/Helsinki"` (no real city tied; it's just a sane default).

`src/locations/mock-locations.ts` exports `MOCK_LOCATIONS: LocationSlot[]` with four
**placeholder** names (e.g. `"Sample City A"`, `"Sample City B"`, `"Sample Town C"`,
`"Sample Town D"`). Coordinates can be `0` or anodyne — they are not used until
STORY-005 introduces real env-driven slots. **Do not commit Lahti / Helsinki /
Tallinn / Käsmu here.**

---

## Layout & CSS (`src/ui/styles.css`)

Mobile-first; aim for iPhone 13/14 size (390×844). Specifics:

- `:root` defines a small token set: `--bg`, `--card-bg`, `--fg`, `--muted`, `--accent` (Google-widget yellow `#f7b500`), `--radius: 14px`, `--gap: 12px`.
- `body`: full viewport, sans-serif system stack, `color-scheme: light dark`, default light palette + a `@media (prefers-color-scheme: dark)` override for the same tokens.
- `#app`: `max-width: 480px; margin: 0 auto; padding: 16px;`.
- `.locations-grid`: `display: grid; gap: var(--gap);` — single column on mobile (acceptance criterion is "no horizontal scroll"). On wider screens (>700px) use 2 columns — purely a nicety for desktop demos.
- `.location-card`: rounded card, padding 16px, flex row with icon (~48px) + temp (large), supporting text below. Tap target ≥ 44px (iOS HIG). `cursor: pointer`. Use `:focus-visible` for keyboard focus ring.
- `.location-card[aria-expanded="true"]`: subtle accent ring; the detail panel sits below.
- `.detail-placeholder`: muted background, single line of English copy ("Hourly chart and 7-day forecast coming in the next story.").
- No global resets beyond `box-sizing: border-box;` + zeroing default margins on `body`/`h1`/`p`.

---

## Tap → detail toggle

- The home screen tracks one `expandedId: string | null` in a closure inside
  `renderHomeScreen`. Single-expand behaviour: tapping a different card collapses
  the previous one. Tapping the same card collapses it.
- Each card carries `role="button"`, `tabindex="0"`, `aria-expanded` and
  `aria-controls` linking it to the detail panel id (a11y baseline).
- Click handler + `keydown` (Enter/Space) handler — both routes call the same
  toggle function so keyboards work.
- The detail panel is a sibling element appended right after the card, hidden via
  the `hidden` attribute when not expanded (so layout doesn't reserve space).

---

## Tasks

Execute in order. Each task is atomic and verifiable.

### Task 1: Domain types — `src/weather/types.ts`

- **File**: `src/weather/types.ts`
- **Action**: CREATE
- **Implement**: Exactly the interfaces in the "Type contracts" section above. No
  implementation, no functions — pure type module.
- **Mirror**: N/A — first domain types in the repo.
- **Validate**: `npx tsc --noEmit` (will pass once Tasks 2+ exist).

### Task 2: Location slot type — `src/locations/types.ts`

- **File**: `src/locations/types.ts`
- **Action**: CREATE
- **Implement**: `LocationSlot` interface per "Type contracts". No implementation.
- **Validate**: `npx tsc --noEmit`.

### Task 3: WMO mapping — `src/weather/wmo-codes.ts`

- **File**: `src/weather/wmo-codes.ts`
- **Action**: CREATE
- **Implement**: `export function wmoToCondition(code: number): WeatherCondition`.
  Use a `switch` on `code` covering the table above. Default branch returns
  `{ code, description: 'Unknown', iconKey: 'unknown' }`. Imports `WeatherCondition`
  + `WeatherIconKey` from `./types`. No `any`; no DOM.
- **Validate**: `npx tsc --noEmit`.

### Task 4: WMO mapping unit tests — `src/weather/wmo-codes.test.ts`

- **File**: `src/weather/wmo-codes.test.ts`
- **Action**: CREATE
- **Implement**: Vitest tests:
  - one assertion per representative code in each group (0, 1, 2, 3, 45, 51, 56, 61, 66, 71, 80, 85, 95, 96).
  - one assertion for an out-of-range code (e.g. 999) → `iconKey: 'unknown'`, `description: 'Unknown'`.
  - assert the returned `code` echoes the input.
- **Mirror**: `src/smoke.test.ts:1-16` (Vitest import style, no globals).
- **Validate**: `npm test` includes this file and passes.

### Task 5: Mock forecasts — `src/weather/mock-forecasts.ts`

- **File**: `src/weather/mock-forecasts.ts`
- **Action**: CREATE
- **Implement**: `export const MOCK_FORECASTS: Record<string, ForecastResponse>` with
  four entries (`mock-1` … `mock-4`). Pick a mix of weather codes (0, 3, 61, 71).
  Hourly arrays have length 24; daily arrays have length 7. ISO strings can be
  hard-coded relative to `2026-06-07T00:00:00`. No `any`.
- **Validate**: `npx tsc --noEmit`. Visual sanity: importing the file in a test
  should give a typed object with the right keys.

### Task 6: Mock locations — `src/locations/mock-locations.ts`

- **File**: `src/locations/mock-locations.ts`
- **Action**: CREATE
- **Implement**: `export const MOCK_LOCATIONS: LocationSlot[]` — four entries with
  placeholder names ("Sample City A/B/C/D"), `kind: 'default'`, `id` matching the
  `mock-N` keys in `MOCK_FORECASTS`. Coordinates can be `0` / a dummy island.
- **Critical**: do NOT use Lahti / Helsinki / Tallinn / Käsmu — that would leak the
  real defaults into the public repo (CLAUDE.md › Security).
- **Validate**: `npx tsc --noEmit`.

### Task 7: Formatters — `src/ui/format.ts` + tests

- **File**: `src/ui/format.ts`, `src/ui/format.test.ts`
- **Action**: CREATE
- **Implement**:
  - `formatTemperature(c: number): string` → e.g. `"19°"` (round nearest integer; matches Google widget).
  - `formatHumidity(pct: number): string` → e.g. `"59%"` (rounded int).
  - `formatWind(ms: number): string` → e.g. `"4 m/s"` (rounded to one decimal then strip trailing `.0`).
  - Pure, no `any`, no DOM.
  - Tests: rounding (`.4` down, `.5` up), negatives (`-3.5°C`), zero, integer passthrough.
- **Validate**: `npm test`.

### Task 8: Icon renderer — `src/ui/icon.ts`

- **File**: `src/ui/icon.ts`
- **Action**: CREATE
- **Implement**: `export function renderIconSvg(iconKey: WeatherIconKey): SVGElement`.
  Each `iconKey` returns a small inline SVG (24×24 viewBox) built via
  `document.createElementNS('http://www.w3.org/2000/svg', ...)`. Keep shapes simple:
  sun = circle + rays, cloud = ellipse, rain = cloud + droplet line, snow = cloud +
  asterisk, thunderstorm = cloud + bolt, fog = three horizontal lines, etc.
  - Add `role="img"` and `aria-label` (the description from `wmoToCondition` —
    accepted as a second arg, or set by the caller). To keep `icon.ts` decoupled,
    accept `(iconKey, ariaLabel)` and set `aria-label = ariaLabel`.
  - No `innerHTML`. No external assets. No `any`.
- **Validate**: `npx tsc --noEmit`. Visual check via dev server.

### Task 9: Location card renderer — `src/ui/location-card.ts`

- **File**: `src/ui/location-card.ts`
- **Action**: CREATE
- **Implement**: `export function renderLocationCard(slot: LocationSlot, forecast: ForecastResponse): HTMLElement`:
  - `<article class="location-card" role="button" tabindex="0" aria-expanded="false">`.
  - Set `dataset.slotId = slot.id`.
  - Children: icon (from `renderIconSvg`), a column with:
    - `.location-card__name` — `textContent = slot.name`.
    - `.location-card__temp` — `textContent = formatTemperature(forecast.current.temperature_2m)`.
    - `.location-card__desc` — `textContent = wmoToCondition(forecast.current.weather_code).description`.
    - `.location-card__meta` — two spans: humidity + wind, joined visually by ` · `.
  - All values via `textContent` (security rule).
  - Returns the element; does NOT attach event handlers (`home-screen.ts` owns them so all state lives in one place).
- **Validate**: covered by Task 12 tests + dev-server screenshot.

### Task 10: Detail placeholder — `src/ui/detail-view.ts`

- **File**: `src/ui/detail-view.ts`
- **Action**: CREATE
- **Implement**: `export function renderDetailPlaceholder(slot: LocationSlot): HTMLElement`:
  - `<section class="detail-placeholder" hidden>` with two paragraphs:
    - `textContent = ${slot.name} — detailed view`.
    - `"Hourly chart and 7-day forecast coming in the next story."`
  - Returns the element. Caller manages `hidden`.
- **Validate**: covered by Task 12.

### Task 11: Home-screen composer — `src/ui/home-screen.ts`

- **File**: `src/ui/home-screen.ts`
- **Action**: CREATE
- **Implement**:
  - `export function renderHomeScreen(slots: LocationSlot[], forecasts: Record<string, ForecastResponse>): HTMLElement`.
  - Builds `<main class="locations-grid">`.
  - For each slot:
    - Get forecast via `forecasts[slot.id]`. **If missing, render a degraded card** showing slot name + "No data" (per CLAUDE.md fault tolerance — one slot must not break others). Wrap card construction in try/catch; on error, `console.error('[ui] failed to render slot', slot.id, err)` and inject a fallback element with the name and an "Error" hint.
    - Append card + detail panel sibling. Detail panel id = `detail-${slot.id}`. Card gets `aria-controls="detail-${slot.id}"`.
  - Single-expand state via closure variable `expandedId: string | null = null`.
  - One `click` and one `keydown` listener at the grid level (event delegation):
    - On `click`, find `closest('.location-card')`, read `dataset.slotId`, toggle.
    - On `keydown`, if `event.key === 'Enter' || event.key === ' '` and target is a card, prevent default and toggle.
  - Toggle: collapse the previously expanded card's detail (`hidden = true`, `aria-expanded = false`); if same id → leave collapsed; else expand the new card.
  - No `innerHTML`. No `any`.
- **Validate**: covered by Task 12 + manual dev-server check.

### Task 12: UI tests — `location-card.test.ts` + `home-screen.test.ts`

- **File**: `src/ui/location-card.test.ts`, `src/ui/home-screen.test.ts`
- **Action**: CREATE
- **Implement**:
  - **`location-card.test.ts`**: import `MOCK_LOCATIONS[0]` and `MOCK_FORECASTS['mock-1']`, render a card, assert:
    - element has class `location-card`.
    - text content contains the slot name, the formatted temperature, the WMO description, the humidity string, the wind string.
    - `role="button"`, `tabindex="0"`, `aria-expanded="false"`.
  - **`home-screen.test.ts`**: render the screen with the four mocks, assert:
    - four cards exist.
    - their detail panels are all `hidden`.
    - dispatching a `click` on the first card sets its `aria-expanded="true"` and its detail panel's `hidden = false`.
    - dispatching a `click` on the second card collapses the first and expands the second.
    - dispatching a `click` on the second card again collapses it back.
    - rendering a screen where one forecast is missing → degraded card is present, other three cards render normally (fault isolation).
- **Mirror**: `src/smoke.test.ts:1-16` (Vitest+jsdom). Use `document.body.append` to host the tree during the test.
- **Validate**: `npm test` — all green.

### Task 13: Global styles — `src/ui/styles.css`

- **File**: `src/ui/styles.css`
- **Action**: CREATE
- **Implement**: Per the "Layout & CSS" section. Keep total under ~150 lines. No
  external fonts.
- **Validate**: Dev-server smoke + agent-browser screenshot at 390×844 shows:
  - no horizontal scrollbar,
  - four cards stacked,
  - tap target ≥ 44px (rough visual check),
  - dark-mode media query inverts cleanly (optional but nice for the demo).

### Task 14: Wire entry — `src/main.ts`

- **File**: `src/main.ts`
- **Action**: UPDATE
- **Implement**: Replace the placeholder content with:
  ```ts
  import './ui/styles.css';
  import { MOCK_LOCATIONS } from './locations/mock-locations';
  import { MOCK_FORECASTS } from './weather/mock-forecasts';
  import { renderHomeScreen } from './ui/home-screen';

  const app = document.getElementById('app');
  if (app === null) {
    console.error('[main] #app root element not found in index.html');
  } else {
    app.replaceChildren(renderHomeScreen(MOCK_LOCATIONS, MOCK_FORECASTS));
  }
  ```
  Wiring-only — preserves the existing pattern at `src/main.ts:5-20`.
- **Validate**: `npm run dev` serves a page with four cards (agent-browser screenshot).

### Task 15: `index.html` housekeeping

- **File**: `index.html`
- **Action**: UPDATE (minimal)
- **Implement**: Keep current `viewport` and `theme-color`. No structural changes.
  Optional: add `<meta name="apple-mobile-web-app-capable" content="yes">` — gated:
  only if it doesn't trigger any tooling warnings. (Real PWA meta lands in STORY-006.)
- **Validate**: `npm run build` still passes; nothing else changes.

### Task 16: Remove obsolete `.gitkeep` files

- **File**: `src/weather/.gitkeep`, `src/locations/.gitkeep`, `src/ui/.gitkeep`
- **Action**: DELETE
- **Note**: `src/storage/.gitkeep` STAYS — that folder is empty until STORY-007.
- **Validate**: `git status` shows the deletions; folders still in git via the new
  files they contain.

### Task 17: Full validation pass + visual demo

- **Implement**:
  1. `npm run lint && npx tsc --noEmit && npm test` — all green.
  2. `npm run build` — succeeds.
  3. `npm run dev` (background) — agent-browser opens `http://localhost:5173/` at
     viewport `390×844`, takes a screenshot, attaches it to the issue/PR comment per
     CLAUDE.md › "Use agent-browser for web inspection". Save the screenshot at
     `.agents/reports/ui-skeleton-location-cards-screenshot.png` (gitignored is fine —
     but commit it if size < 200 KB so the demo survives).
  4. Tap one card in the headless browser; capture a second screenshot showing the
     expanded detail placeholder.
  5. Record everything in `.agents/reports/ui-skeleton-location-cards-report.md`
     (mirrors `.agents/reports/scaffold-vite-typescript-report.md`).
- **Validate**: every command in `## Validation` below exits 0, and the report file
  exists with the captured screenshots' paths.

---

## Risks

| Risk | Mitigation |
|------|------------|
| Mocks drift from the real Open-Meteo shape, breaking STORY-004 silently | Types are the single source of truth — mocks are typed as `ForecastResponse`. STORY-004's `fetchForecast` returns the same type; if the API ever changes shape, both fail TS together. |
| `innerHTML` slipping in via a tempting one-liner | Enforced by code review + ESLint stays loud on any new `any`. Tests don't render HTML strings either. |
| `src/ui/styles.css` becomes a tangle as more screens land | Keep tokens (`:root`) and reset minimal here; later stories add scoped class rules. This file is a CLAUDE.md hotspot — flagged. |
| WMO mapping incomplete (Open-Meteo adds a code) | Default branch returns `unknown`. Adding a code is a one-line `case` in `wmo-codes.ts` + one test. |
| iPhone 13/14 viewport rendering can't be verified on a real device in-sandbox | Defer-and-record per CLAUDE.md › Sandbox-blocked checks. agent-browser screenshot at 390×844 is the in-sandbox proxy and is sufficient for the owner demo. |
| Naming "Sample City A" feels temporary | It IS temporary. STORY-005 deletes mocks-as-defaults and injects real env locations. Comment in `mock-locations.ts` says so explicitly. |
| Click delegation misfires on inner elements (e.g. the SVG icon) | Use `event.target.closest('.location-card')`. Tested in `home-screen.test.ts`. |

---

## Validation

Run before declaring done — exact commands from CLAUDE.md › Commands / Validation:

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
```

Plus the demo step (in-sandbox proxy for the iPhone test, per CLAUDE.md):

```bash
# Background:
npm run dev -- --port 5173 --strictPort &
# Then via agent-browser skill:
#   - open http://localhost:5173/ at viewport 390x844
#   - screenshot home → save
#   - click first .location-card
#   - screenshot expanded → save
```

Deferred (CLAUDE.md › Sandbox-blocked checks, recorded — not failed):

- Real-iPhone Add-to-Home-Screen test (PWA infra not present until Phase 3 / STORY-006).
- Real-iPhone airplane-mode offline check (Phase 3 / STORY-007).

---

## Acceptance criteria

Issue #2 ACs → tasks/tests mapping (every AC must map to ≥ 1 task or test):

- [ ] **AC1**: 4 location cards with name, current temp, WMO icon, humidity, wind (m/s) on Open-Meteo-shaped mocks.
  → Task 5 (mocks), Task 9 (card renderer), Task 12 (`location-card.test.ts` asserts all five fields), Task 14 (wiring).
- [ ] **AC2**: Mobile viewport 390×844, no horizontal scroll, readable.
  → Task 13 (CSS) + Task 17 (agent-browser screenshot at 390×844).
- [ ] **AC3**: Tapping a card opens/expands a detail view (stub for STORY-003).
  → Task 10 (placeholder), Task 11 (toggle logic), Task 12 (`home-screen.test.ts` simulates clicks).
- [ ] **AC4**: All UI text in English, no ads/extra elements.
  → Task 9/10/13 (all `textContent` strings English); manual code review.
- [ ] **AC5**: Mocks live separately and are typed with the same `weather/` types the real client will use.
  → Task 1 (types), Task 5 (mocks typed as `ForecastResponse`), Task 6 (locations typed as `LocationSlot`).

Process gates:

- [ ] All tasks completed
- [ ] `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build` pass
- [ ] Follows the patterns table (esp. `textContent`-only, layer direction, naming)
- [ ] agent-browser screenshot at 390×844 attached to the implementation report
- [ ] Sandbox-blocked checks (real-iPhone install, airplane-mode) recorded as
      defer-and-record, NOT treated as failures
- [ ] No real default locations (Lahti / Helsinki / Tallinn / Käsmu) committed
      anywhere in the repo
