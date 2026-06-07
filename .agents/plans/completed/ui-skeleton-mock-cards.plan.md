# Plan: UI Skeleton — Mock-Data Location Cards (STORY-002)

## Summary

Build the Phase-1 UI skeleton: a list of 4 location cards (Lahti / Helsinki / Tallinn / Käsmu) showing
current temperature, WMO weather icon, humidity, and wind in m/s — fed from mock data shaped exactly
like a real Open-Meteo `forecast` response. Tapping a card opens an in-page detail view (placeholder
for STORY-003). All Open-Meteo response TypeScript types and the WMO-code → icon/label mapping land
in `src/weather/` so STORY-004 (real API client) can reuse them without redefinition. Pure DOM
rendering (`textContent` only), mobile-first layout fits a 390×844 iPhone viewport without horizontal
scroll. UI in English, no ads, no analytics.

## User Story

As a user
I want to open the app and immediately see weather cards for all my locations (with the option to tap one for more detail)
So that I can read the conditions at a glance and demo the visual to the owner before the real API is wired up

## Metadata

| Field | Value |
|-------|-------|
| Type | NEW_CAPABILITY |
| Complexity | MEDIUM |
| Systems Affected | `src/weather/`, `src/ui/`, `src/locations/`, `src/main.ts`, `index.html` |
| GitHub Issue | #2 |

---

## Constraints from CLAUDE.md (non-negotiable)

- Validation commands: `npm run lint && npx tsc --noEmit && npm test`
- Architecture: `ui → app services → api/storage → domain types`. `weather/` domain MUST NOT import from `ui/`.
- Files: kebab-case; types: PascalCase; functions/vars: camelCase. Name after domain, not tech.
- Render API-sourced strings with `textContent`, never `innerHTML` (security).
- No new runtime deps (bundle must stay small).
- TypeScript strict, no `any`. `noUncheckedIndexedAccess` is on — index access yields `T | undefined`.
- Default locations live in env (`VITE_DEFAULT_LOCATIONS`) — but this story is mock-data, so we ship
  hard-coded **mock** locations (Lahti/Helsinki/Tallinn/Käsmu are public city names, not the
  owner's secret slots). The real env-driven slots arrive in STORY-005. `.env.local` is not touched.

## Open-Meteo response shape (from PRD spike, 2026-06-07)

Endpoint used in production later (for reference only — not called here):
`https://api.open-meteo.com/v1/forecast?latitude=…&longitude=…&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&hourly=temperature_2m,precipitation,precipitation_probability,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto&wind_speed_unit=ms`

The response is one JSON object with these top-level fields used by this story (and STORY-003/004):

- `latitude`, `longitude`, `timezone`, `timezone_abbreviation`, `utc_offset_seconds`, `elevation`
- `current_units` (object of strings) and `current` (object with `time`, `interval`,
  `temperature_2m`, `relative_humidity_2m`, `weather_code`, `wind_speed_10m`)
- `hourly_units` and `hourly` (parallel arrays under `time`, `temperature_2m`, `precipitation`,
  `precipitation_probability`, `weather_code`)
- `daily_units` and `daily` (parallel arrays under `time`, `weather_code`, `temperature_2m_max`,
  `temperature_2m_min`, `precipitation_sum`)

All weather codes are integers from WMO 4677 (subset). Mapping per PRD spike / Open-Meteo docs:

| Code(s) | Group | Label | Icon |
|---------|-------|-------|------|
| 0 | clear | Clear sky | sun |
| 1, 2 | partly | Partly cloudy | sun-behind-cloud |
| 3 | overcast | Overcast | cloud |
| 45, 48 | fog | Fog | fog |
| 51, 53, 55 | drizzle | Drizzle | drizzle |
| 56, 57 | freezing-drizzle | Freezing drizzle | drizzle-freezing |
| 61, 63, 65 | rain | Rain | rain |
| 66, 67 | freezing-rain | Freezing rain | rain-freezing |
| 71, 73, 75, 77 | snow | Snow | snow |
| 80, 81, 82 | rain-showers | Rain showers | rain-showers |
| 85, 86 | snow-showers | Snow showers | snow-showers |
| 95 | thunderstorm | Thunderstorm | thunderstorm |
| 96, 99 | thunderstorm-hail | Thunderstorm with hail | thunderstorm-hail |

Unknown codes fall back to `unknown` / "Unknown" / a neutral cloud icon — never crash.

---

## Patterns to Follow

### File / directory layout (CLAUDE.md "Architecture")

```
src/
├── weather/
│   ├── types.ts                  # Open-Meteo response types (reused by STORY-004)
│   ├── wmo.ts                    # weather_code → {group, label, icon}
│   ├── wmo.test.ts
│   └── mocks.ts                  # mock OpenMeteoForecast objects, one per location
├── locations/
│   └── types.ts                  # Location, LocationSlot ({kind: 'default' | 'custom'})
├── ui/
│   ├── format.ts                 # number → "19°", wind → "4 m/s", etc.
│   ├── format.test.ts
│   ├── icons.ts                  # icon name → inline SVG string (built via DOM, no innerHTML)
│   ├── card.ts                   # renderLocationCard(location, forecast)
│   ├── detail.ts                 # renderLocationDetail(location, forecast) — STORY-003 placeholder
│   ├── app.ts                    # renderApp(root, slots) — owns list ↔ detail navigation
│   └── styles.css                # mobile-first, 390×844 friendly
└── main.ts                       # wiring: import mocks + slots, call renderApp
```

### Module style (mirrored from scaffold)

`src/main.ts:1-20` — `const heading = document.createElement('h1'); heading.textContent = '…';`
Always create elements + set `textContent`. No template strings injected as HTML.

### Test style (mirrored from `src/smoke.test.ts`)

```ts
// SOURCE: src/smoke.test.ts:1-16
import { describe, expect, it } from 'vitest';
describe('…', () => { it('…', () => { expect(x).toBe(y); }); });
```

Tests live next to the source file as `*.test.ts`. Vitest runs them via `npm test` (jsdom env).

### Types / discriminated unions

```ts
// SOURCE: stories/STORY-005 hint + general project convention
export type LocationSlot =
  | { readonly kind: 'default'; readonly location: Location }
  | { readonly kind: 'custom'; readonly location: Location | null };
```

No `any`. Use `readonly` on shared shapes. `noUncheckedIndexedAccess` means
`array[0]` is `T | undefined` — handle with a guard, do not bang (`!`).

---

## Files to Change

| File | Action | Purpose |
|------|--------|---------|
| `src/weather/types.ts` | CREATE | Open-Meteo response shape types (shared with STORY-004) |
| `src/weather/wmo.ts` | CREATE | WMO weather-code → `{group, label, icon}` mapping |
| `src/weather/wmo.test.ts` | CREATE | Unit tests for the mapping |
| `src/weather/mocks.ts` | CREATE | Mock `OpenMeteoForecast` objects for the 4 default locations |
| `src/locations/types.ts` | CREATE | `Location`, `LocationSlot` types |
| `src/locations/defaults.ts` | CREATE | Hard-coded mock default-location list (public city names only) |
| `src/ui/format.ts` | CREATE | `formatTemperature`, `formatHumidity`, `formatWind` |
| `src/ui/format.test.ts` | CREATE | Unit tests for formatters |
| `src/ui/icons.ts` | CREATE | `createWeatherIcon(name): SVGElement` — built with `createElementNS`, no `innerHTML` |
| `src/ui/card.ts` | CREATE | `renderLocationCard(slot, forecast, onTap): HTMLElement` |
| `src/ui/detail.ts` | CREATE | `renderLocationDetail(slot, forecast, onBack): HTMLElement` (STORY-003 placeholder) |
| `src/ui/app.ts` | CREATE | `renderApp(root, items)` — owns list ↔ detail toggle |
| `src/ui/styles.css` | CREATE | Mobile-first styles, viewport-safe, no ads/extras |
| `src/main.ts` | UPDATE | Replace placeholder content; wire mocks + slots into `renderApp` |
| `index.html` | UPDATE | Link `styles.css` (or rely on `main.ts` importing it via Vite); no other change |

---

## Tasks

Execute in order. Validate `npm run lint && npx tsc --noEmit && npm test` after each task that
produces code; skip the validate step only on docs-only or stub-only commits.

### Task 1: `src/weather/types.ts`

- **Action**: CREATE
- **Implement**: Export discriminator-free interfaces matching the Open-Meteo `/v1/forecast`
  response from the PRD spike. Top-level: `latitude`, `longitude`, `generationtime_ms`, `utc_offset_seconds`,
  `timezone`, `timezone_abbreviation`, `elevation`, `current_units`, `current`, `hourly_units`,
  `hourly`, `daily_units`, `daily`. `current` has `time: string`, `interval: number`,
  `temperature_2m: number`, `relative_humidity_2m: number`, `weather_code: number`,
  `wind_speed_10m: number`. `hourly` arrays under `time: string[]`, `temperature_2m: number[]`,
  `precipitation: number[]`, `precipitation_probability: number[]`, `weather_code: number[]`.
  `daily` arrays under `time: string[]`, `weather_code: number[]`, `temperature_2m_max: number[]`,
  `temperature_2m_min: number[]`, `precipitation_sum: number[]`. Make all fields `readonly`. Export
  the umbrella type `OpenMeteoForecast`.
- **Mirror**: standard TS interface style (no project examples yet).
- **Validate**: `npx tsc --noEmit`

### Task 2: `src/weather/wmo.ts` + `src/weather/wmo.test.ts`

- **Action**: CREATE
- **Implement**: Export `type WeatherIconName = 'sun' | 'sun-behind-cloud' | 'cloud' | 'fog' | …`,
  `type WeatherGroup = 'clear' | 'partly' | … | 'unknown'`, and
  `interface WeatherSummary { group: WeatherGroup; label: string; icon: WeatherIconName }`.
  Export `describeWeatherCode(code: number): WeatherSummary`. Use the table in this plan. Unknown
  codes return `{ group: 'unknown', label: 'Unknown', icon: 'cloud' }`. Pure function, no I/O.
  Test: at least one case per group + an unknown code + a non-integer / out-of-range input.
- **Mirror**: `src/smoke.test.ts:1-16` for test style.
- **Validate**: `npm test && npx tsc --noEmit`

### Task 3: `src/locations/types.ts` + `src/locations/defaults.ts`

- **Action**: CREATE
- **Implement**:
  - `types.ts`: `export interface Location { readonly name: string; readonly lat: number; readonly lon: number }` and
    `export type LocationSlot = { readonly kind: 'default'; readonly location: Location } | { readonly kind: 'custom'; readonly location: Location | null }`.
  - `defaults.ts`: export `MOCK_DEFAULT_LOCATIONS: readonly Location[]` — Lahti, Helsinki, Tallinn,
    Käsmu with coordinates rounded to 2 decimals (already public per PRD: Lahti 60.98, 25.66 etc.). Add a
    comment that these are mock fixtures; real values come from `VITE_DEFAULT_LOCATIONS` in STORY-005.
- **Validate**: `npx tsc --noEmit`

### Task 4: `src/weather/mocks.ts`

- **Action**: CREATE
- **Implement**: Export `MOCK_FORECASTS: Readonly<Record<string, OpenMeteoForecast>>` keyed by
  location name (Lahti, Helsinki, Tallinn, Käsmu). Each mock has full shape (current + 24 hourly +
  7 daily) with realistic numbers and varied WMO codes (one clear, one partly, one rain, one
  overcast — so we can demo all icon paths). `time` strings ISO-like (`2026-06-07T14:00`). Helper
  `pickForecastFor(location: Location): OpenMeteoForecast` returns the matching mock or, if none,
  the first mock as a safe fallback (`noUncheckedIndexedAccess` requires the guard).
- **Validate**: `npx tsc --noEmit && npm test`

### Task 5: `src/ui/format.ts` + `src/ui/format.test.ts`

- **Action**: CREATE
- **Implement**: Pure formatters:
  - `formatTemperature(c: number): string` → `"19°"` (rounded, no decimals, no space before °).
  - `formatHumidity(p: number): string` → `"59%"` (rounded, clamped 0–100).
  - `formatWind(ms: number): string` → `"4 m/s"` (rounded to 1 decimal if < 10, integer otherwise; never negative).
  - `formatTime(iso: string): string` → `"14:00"` (HH:MM — used by detail placeholder for "last updated"
    style strings; safe parser, returns `"--:--"` on bad input).
  Test each formatter incl. edge cases (NaN, negative, > 100 humidity).
- **Validate**: `npm test`

### Task 6: `src/ui/icons.ts`

- **Action**: CREATE
- **Implement**: `createWeatherIcon(name: WeatherIconName, options?: { size?: number }): SVGElement`.
  Build SVG via `document.createElementNS('http://www.w3.org/2000/svg', …)` and `setAttribute` —
  never `innerHTML` (CLAUDE.md security rule, even for SVG markup we author). Each icon is a tiny
  symbolic shape (sun = circle + rays; cloud = ellipse + circles; rain = cloud + drops; snow =
  cloud + stars; fog = three lines; thunderstorm = cloud + zig-zag). Default size 40 px. Add
  ARIA: `role="img"` and `aria-label={summary.label}` set by the caller.
- **Mirror**: pure DOM construction matches `src/main.ts:13-19`.
- **Validate**: `npx tsc --noEmit`

### Task 7: `src/ui/card.ts`

- **Action**: CREATE
- **Implement**: `renderLocationCard(slot: LocationSlot, forecast: OpenMeteoForecast | null,
  onTap: () => void): HTMLElement`. Returns a `<button type="button" class="card">` (button so it's
  keyboard-tappable and screen-reader announces it as actionable). If `slot.location` is null
  (empty custom slot) — render an "Add a location" placeholder card, no onTap. Otherwise show:
  location name (h2.textContent), weather icon (from `describeWeatherCode(current.weather_code)`),
  current temperature (`formatTemperature`), label (e.g. "Mostly sunny"), humidity row, wind row.
  Click handler calls `onTap()`. No `innerHTML` anywhere.
- **Validate**: `npx tsc --noEmit`

### Task 8: `src/ui/detail.ts`

- **Action**: CREATE
- **Implement**: `renderLocationDetail(slot: LocationSlot, forecast: OpenMeteoForecast,
  onBack: () => void): HTMLElement`. Returns a `<section class="detail">` with a back button (text:
  "← Back"), the location header (name + current temp + label + icon), and a placeholder block
  with `textContent = 'Hourly chart and 7-day forecast — STORY-003.'` so the navigation works and
  the next story can swap in real content.
- **Validate**: `npx tsc --noEmit`

### Task 9: `src/ui/app.ts`

- **Action**: CREATE
- **Implement**: `renderApp(root: HTMLElement, items: ReadonlyArray<{ slot: LocationSlot;
  forecast: OpenMeteoForecast | null }>): void`. Builds two views as separate DOM subtrees:
  - **List view**: `<header>` with title "Weather", a `<main class="list">` containing one
    `renderLocationCard` per item, and a `<footer>` with the CC-BY attribution text
    "Weather data by Open-Meteo" rendered as an `<a>` to `https://open-meteo.com/` (open in
    new tab, `rel="noopener noreferrer"`).
  - **Detail view**: built lazily when a card is tapped. Calls `renderLocationDetail` for the
    selected item; back button toggles back to list view.
  Navigation is in-page (no router): replace root's children with the requested view.
  Per-card failure isolation: if `forecast` is null for a slot, render an "Unavailable" state
  card (still tappable but shows no detail — STORY-005 will handle real errors).
- **Validate**: `npx tsc --noEmit && npm test`

### Task 10: `src/ui/styles.css`

- **Action**: CREATE
- **Implement**: Mobile-first CSS. Box-sizing border-box everywhere. Body: dark navy bg (`#0b1726`)
  + warm off-white text — matches existing theme-color in `index.html`. Container max-width 480px,
  centered, with 16px side padding. `.card` is a vertical stack (icon + temp on top row, then
  metadata rows); `display: grid`, `grid-template-columns: auto 1fr auto`, 12px gap; cursor: pointer;
  border-radius 16px; padding 16px; tap-highlight off. `.detail` mirrors. No horizontal scroll
  (`overflow-x: hidden` on `html, body`). Safe-area padding via `env(safe-area-inset-*)`. Buttons
  reset (no default browser chrome). Use `system-ui` font stack — no web fonts.
- **Validate**: visually via vite dev / preview screenshot (Phase 4 E2E)

### Task 11: `src/main.ts`

- **Action**: UPDATE
- **Implement**: Replace the scaffold's heading/note with:
  ```ts
  import './ui/styles.css';
  import { MOCK_DEFAULT_LOCATIONS } from './locations/defaults';
  import type { LocationSlot } from './locations/types';
  import { pickForecastFor } from './weather/mocks';
  import { renderApp } from './ui/app';

  const root = document.getElementById('app');
  if (root === null) { console.error('[main] #app root element not found'); }
  else {
    const slots: LocationSlot[] = MOCK_DEFAULT_LOCATIONS.map((loc) =>
      ({ kind: 'default', location: loc }));
    const items = slots.map((slot) => ({
      slot,
      forecast: slot.location ? pickForecastFor(slot.location) : null,
    }));
    renderApp(root, items);
  }
  ```
  (We render only 4 default cards here; the 2 custom slots arrive in STORY-009.)
- **Validate**: `npm run build` (full type check + vite build)

### Task 12: `index.html`

- **Action**: UPDATE
- **Implement**: No structural changes; the existing `<div id="app">` and viewport meta are right.
  Only widen the meta description (optional) and ensure no inline scripts. CSS is imported via
  `main.ts`, so no `<link>` here. If untouched after review, leave as is.
- **Validate**: `npm run build`

### Task 13: Full validation pass

- **Action**: VALIDATE
- **Implement**: Run all three commands from CLAUDE.md and capture output:
  ```bash
  npm run lint
  npx tsc --noEmit
  npm test
  ```
  All must pass (exit 0).

### Task 14: E2E visual smoke (agent-browser)

- **Action**: VERIFY
- **Implement**:
  1. `npm run build` → `npm run preview` (background).
  2. Use `agent-browser` to open the preview URL at viewport 390×844.
  3. Capture a screenshot of the list view; confirm: 4 cards visible, names match
     mock locations, no horizontal scroll, footer attribution present.
  4. Tap the first card; capture screenshot of the detail placeholder.
  5. Tap back; confirm we are back in the list.
  6. Stop the preview server.
- **If agent-browser is unavailable**, defer-and-record — append to report under "Sandbox-blocked".

---

## Verification matrix

| Verification | Runs in env? | If blocked: where/when verified |
|--------------|--------------|---------------------------------|
| `npm run lint` | yes | — |
| `npx tsc --noEmit` | yes | — |
| `npm test` (Vitest) | yes | — |
| `npm run build` (vite) | yes | — |
| `npm run preview` + agent-browser screenshot | likely yes | If browser tool blocked: deferred to owner for manual check |
| Real iPhone 390×844 viewport check | no | Owner manual (CLAUDE.md › Sandbox-blocked) |

---

## Risks

| Risk | Mitigation |
|------|------------|
| STORY-004 (concurrent worktree) redefines overlapping types | Keep `src/weather/types.ts` minimal and exactly match Open-Meteo response shape from the PRD spike. Owner reconciles at merge. |
| Inline SVG drift from CLAUDE.md "no chart libs" → being overly ambitious | This story does no charts. Hourly SVG curve is STORY-003. Here icons are tiny, hand-rolled, ≤ 40 px. |
| Card click vs scroll on iOS (300 ms tap delay) | Use a real `<button>` (built-in handling) and `touch-action: manipulation`. |
| Käsmu glyph ("ä") render issue | `index.html` already `<meta charset="UTF-8">`. Use UTF-8 source files (default). |
| Bundle bloat | No new dependencies. CSS file < 3 KB; no fonts. |

---

## Validation

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
```

End-to-end (agent-browser, sandboxed best-effort):
```bash
npm run preview &
# open http://localhost:4173 at viewport 390x844, screenshot, tap card, screenshot
```

---

## Acceptance Criteria (mapped to STORY-002)

- [x] Mocks shaped as real Open-Meteo response, in `src/weather/`, typed → Task 1 + 4.
- [x] 4 cards with name / temp / icon / humidity / wind on first render → Task 7 + 9 + 11.
- [x] Mobile viewport 390×844 — no horizontal scroll, readable → Task 10 + Task 14.
- [x] Tapping a card opens a detail view (STORY-003 stub) → Task 8 + 9.
- [x] All text English, no ads or extras, footer = Open-Meteo attribution → Task 9 + 10.
- [x] All `weather/` types are reused by STORY-004 → Task 1 (kept clean of UI concerns).
- [x] WMO mapping has unit tests → Task 2.
- [x] Renders via `textContent` and `createElementNS`, never `innerHTML` → enforced in Tasks 6–9.
- [x] Type check, lint, tests pass → Task 13.
- [x] Independent verification (verifier subagent if available; otherwise owner) → Phase 4.5.
