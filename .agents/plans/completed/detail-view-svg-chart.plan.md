# Plan: Detail View — SVG Hourly Chart + 7-Day Forecast (STORY-003)

## Summary

Replace the Phase-1 placeholder in `src/ui/detail.ts` with the full detail view: a hand-rolled
SVG hourly temperature curve over ~24 h (3-hour time labels and value labels), a precipitation
indicator row directly below the curve (drop icons + mm/% where present), and a 7-day forecast
strip (weekday name + weather icon + max/min). All built from existing `OpenMeteoForecast` mock
data — no API changes. The point-projection math (`(time, temp)[] → SVG path/coords`) is
extracted as a pure function in `src/ui/hourly-chart.ts` and unit-tested per the issue's
Acceptance Criteria. No chart libraries (CLAUDE.md).

## User Story

As a user
I want to see a temperature curve for the next ~24 hours, precipitation marks, and a 7-day strip in the detail view
So that I can plan today and the week without leaving the app

## Metadata

| Field | Value |
|-------|-------|
| Type | NEW_CAPABILITY |
| Complexity | MEDIUM |
| Systems Affected | `src/ui/detail.ts`, `src/ui/hourly-chart.ts` (new), `src/ui/daily-strip.ts` (new), `src/ui/styles.css`, plus tests |
| GitHub Issue | #3 |

---

## Constraints from CLAUDE.md (non-negotiable)

- Validation commands: `npm run lint && npx tsc --noEmit && npm test`.
- Architecture: `ui → app services → api/storage → domain types`. `weather/` MUST NOT import from `ui/`.
  The pure projection function lives in `src/ui/` (it is a UI primitive over already-shaped
  Open-Meteo data) — it does not pull `ui/` types into `weather/`.
- Render API-sourced strings via `textContent`. SVG nodes built with `document.createElementNS`,
  never `innerHTML` (consistent with `src/ui/icons.ts`).
- No new runtime deps — bundle stays small. SVG is hand-rolled.
- TypeScript strict, `noUncheckedIndexedAccess` on — index access returns `T | undefined`; guard,
  never use `!`.
- Per-slot isolation: a malformed forecast object must not blank the detail view; degrade
  gracefully (skip the chart, render the rest).
- Hotspot: `src/ui/styles.css` is shared with #8 (geocoding). Append a new section at the bottom
  rather than reflowing existing rules to minimise merge conflicts.

---

## Patterns to Follow

### SVG construction (mirror `src/ui/icons.ts:22-28`)

```ts
// SOURCE: src/ui/icons.ts:22-28
const SVG_NS = 'http://www.w3.org/2000/svg';

function el(tag: string, attrs: Readonly<Record<string, string>>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    node.setAttribute(k, v);
  }
  return node;
}
```

Use the same `createElementNS` + `setAttribute` shape. Never `innerHTML`. SVGs get
`role="img"` + `aria-label` when meaningful, `aria-hidden="true"` otherwise.

### Pure formatters / fallbacks (mirror `src/ui/format.ts:1-15`)

```ts
// SOURCE: src/ui/format.ts:7-10
export function formatTemperature(celsius: number): string {
  if (!Number.isFinite(celsius)) return '--°';
  return `${Math.round(celsius)}°`;
}
```

Validate input at the boundary, return a sentinel on garbage, never throw.

### Mapping over Open-Meteo arrays with `noUncheckedIndexedAccess` (mirror `src/ui/app.ts:56-60`)

```ts
// SOURCE: src/ui/app.ts:56-60
for (let i = 0; i < items.length; i += 1) {
  const item = items[i];
  if (item === undefined) continue; // noUncheckedIndexedAccess guard
  ...
}
```

Always guard `array[i]` — parallel arrays from Open-Meteo (`hourly.time[i]`,
`hourly.temperature_2m[i]`, etc.) must be checked for `undefined` before use.

### Test style (mirror `src/weather/wmo.test.ts:1-10`)

```ts
// SOURCE: src/weather/wmo.test.ts:1-10
import { describe, expect, it } from 'vitest';
import { describeWeatherCode } from './wmo';

describe('describeWeatherCode', () => {
  it('maps clear sky (0)', () => {
    const s = describeWeatherCode(0);
    expect(s.group).toBe('clear');
  });
});
```

Co-located `*.test.ts`. Pure-function tests assert numeric outputs and the sentinel paths.

---

## Files to Change

| File | Action | Purpose |
|------|--------|---------|
| `src/ui/hourly-chart.ts` | CREATE | Pure projection `(points) → {coords, pathD, viewBox, gridLines}` + DOM render |
| `src/ui/hourly-chart.test.ts` | CREATE | Unit tests for the projection (per issue AC #5) |
| `src/ui/daily-strip.ts` | CREATE | 7-day strip renderer (weekday + icon + max/min) |
| `src/ui/daily-strip.test.ts` | CREATE | Unit tests for weekday formatting + render shape |
| `src/ui/format.ts` | UPDATE | Add `formatPrecipMm`, `formatPercent`, `formatWeekday(iso)` |
| `src/ui/format.test.ts` | UPDATE | Tests for new formatters |
| `src/ui/detail.ts` | UPDATE | Replace placeholder block with chart + precip row + 7-day strip |
| `src/ui/app.test.ts` | UPDATE | Update existing detail assertion (placeholder text is gone) |
| `src/ui/styles.css` | UPDATE | Append `.detail-chart`, `.detail-precip-row`, `.detail-daily` rules |

---

## Design notes

### Hourly chart: viewport-fit, no overflow

- SVG element uses `viewBox="0 0 W H"` (logical units) + `preserveAspectRatio="none"` is NOT
  desirable because labels would stretch; instead, keep proportional scaling via
  `width="100%"` and `height={H}` (CSS) so the curve scales horizontally to the container while
  values/labels stay legible. Container has `overflow: hidden`.
- W = 600, H = 140 logical units. Reasonable on a 390-px viewport at ~96 DPI without scroll.
- 8 sample points over 24h (step = 3h) — matches the issue's "шаг 2–3 ч" and the reference
  image's 8 labels. We thin from the 24 hourly entries with `selectHourlySamples` (pure).

### Projection function (the pure heart, unit-tested)

`projectHourlyChart(samples, options) → ChartGeometry`:

- Input: `samples: ReadonlyArray<{ time: string; tempC: number; precipMm?: number;
  precipProb?: number }>` plus options `{ width, height, paddingTop, paddingBottom,
  paddingX }` (all optional, sensible defaults).
- Output: `{ width, height, points: { x, y, tempC, time }[], pathD: string,
  minTemp: number, maxTemp: number, midline: number }`.
- Math:
  - `xStep = (width - 2*paddingX) / (samples.length - 1)` when `samples.length > 1`,
    else single point at midpoint.
  - Y range: pad min/max by 1° each side so the curve never touches the frame; if
    `maxTemp === minTemp`, treat span as 2° around the value.
  - `y = paddingTop + (1 - (t - minTemp) / span) * (height - paddingTop - paddingBottom)`.
- `pathD` uses smooth Catmull-Rom→Bezier so the line is curved like the reference (no
  sharp corners) but is still a pure deterministic function (no DOM, no Math.random).
- Defensive: filter out non-finite `tempC` before projecting; if fewer than 2 valid points,
  return `points: []` and `pathD: ''` — the caller renders an empty chart placeholder line
  rather than crashing.

### Precipitation row

Below the chart, one entry per sampled hour (aligned by `x` from projection):

- If `precipMm > 0`: a small blue drop (reuse `dropShape` style — but local, since we're not
  drawing a weather icon; render an inline SVG `path` with `class="detail-precip-drop"`).
- Show `precipMm` rounded to 1 decimal with `"mm"` (only when > 0).
- Always show `precipProb%` below it if > 0 (e.g. "25%").
- Hours with both 0 are blank.

### 7-day strip

A horizontal row of 7 cells, each containing:

- Weekday short label (`Sun`, `Mon`, …) from `formatWeekday(iso)`.
- Weather icon (reuse `createWeatherIcon` from `daily.weather_code[i]`).
- Max/min line: `21° 9°` (use existing `formatTemperature`).

If `daily.time.length < 7`, render whatever is available (graceful degradation).

### Detail view layout

```
[back]
[header card: name • icon • current temp • label • humidity • wind]
[hourly chart card: temp labels above curve, hour labels below; precipitation row below]
[7-day strip card]
```

The shell stays a single mobile-fit column (`max-width: 480px`, 16-px gutter), matching
existing list view; no horizontal scroll.

---

## Tasks

Execute in order. After each task that produces code:
`npm run lint && npx tsc --noEmit && npm test`.

### Task 1: `src/ui/format.ts` + tests — new formatters

- **Action**: UPDATE
- **Implement**:
  - `formatPrecipMm(mm: number): string` → `"0.4 mm"` (1 decimal, sentinel `"-- mm"` for
    NaN / negative).
  - `formatPercent(p: number): string` → `"25%"` (rounded, clamped 0..100, sentinel `"--%"`).
  - `formatWeekday(iso: string, opts?: { todayIso?: string }): string` → `"Sun"` / `"Mon"`.
    Uses `new Date(iso).getDay()` over a fixed `['Sun','Mon',...,'Sat']` table — no
    `Intl.DateTimeFormat`, to keep behaviour deterministic across browsers and easy to
    unit-test. If the parsed date is invalid → return `"--"`. If `opts.todayIso` matches
    `iso` → return `"Today"` (used by the 7-day strip's first cell to mirror the reference
    image's emphasised "Sun" cell).
- **Validate**: `npx tsc --noEmit && npm test`

### Task 2: `src/ui/hourly-chart.ts` — pure projection module

- **Action**: CREATE
- **Implement**:
  - `export interface HourlySample { time: string; tempC: number; precipMm?: number; precipProb?: number; }`
  - `export interface ChartPoint { x: number; y: number; tempC: number; time: string; precipMm: number; precipProb: number; }`
  - `export interface ChartGeometry { width: number; height: number; paddingTop: number; paddingBottom: number; paddingX: number; points: ReadonlyArray<ChartPoint>; pathD: string; areaPathD: string; minTemp: number; maxTemp: number; }`
  - `export function selectHourlySamples(hourly: OpenMeteoHourly, count = 8): ReadonlyArray<HourlySample>` — picks `count` evenly-spaced entries from the first 24 hourly slots (or fewer if the array is shorter).
  - `export function projectHourlyChart(samples: ReadonlyArray<HourlySample>, options?: ChartOptions): ChartGeometry` — math described above. Catmull-Rom-to-Bezier path builder kept as a local pure helper.
  - **No DOM in this file** — the projection is what gets unit-tested. (DOM rendering lives in Task 3.)
- **Mirror**: pure-function shape of `src/weather/wmo.ts:76-80` and `src/ui/format.ts:7-10`.
- **Validate**: `npx tsc --noEmit`

### Task 3: `src/ui/hourly-chart.ts` (extend) — DOM renderer

- **Action**: UPDATE (same file as Task 2)
- **Implement**: `export function renderHourlyChart(geometry: ChartGeometry, options?: { ariaLabel?: string }): SVGSVGElement`.
  Builds SVG via `createElementNS` (mirror `src/ui/icons.ts:257-275`). Renders:
  - One soft-fill `<path d={areaPathD}>` for the highlighted band under the curve.
  - One `<path d={pathD}>` for the temperature line (stroke, no fill).
  - Per-point `<text>` value labels above each point (`19°`, `21°`, …).
  - Per-point `<text>` time labels below the baseline (`14:00`, `17:00`, …) — use
    `formatTime(point.time)`.
  - `role="img"` + `aria-label` if provided, else `aria-hidden="true"`.
  - Also exports `renderPrecipRow(geometry: ChartGeometry): HTMLElement` — a `<div class="detail-precip-row">` with one cell per point, showing a drop SVG + mm + % when present. Empty cells for dry hours keep alignment.
- **Mirror**: `src/ui/icons.ts:31-65` for `<line>`/`<path>` element construction.
- **Validate**: `npx tsc --noEmit`

### Task 4: `src/ui/hourly-chart.test.ts` — projection unit tests

- **Action**: CREATE
- **Implement** (mirror `src/weather/wmo.test.ts:1-10` style):
  - `selectHourlySamples` picks 8 evenly-spaced entries from a 24-length input; first and
    last sample times match `hourly.time[0]` and `hourly.time[21]` (step of 3).
  - `selectHourlySamples` returns fewer than `count` when the input is shorter; never crashes
    on empty input.
  - `projectHourlyChart` with two flat 20°C samples returns `points[i].y` equal (within
    floating epsilon) — flat span handled.
  - `projectHourlyChart` with mixed temps: `points[indexOfMin].y` is the largest `y` value
    (lower temp ⇒ higher y because SVG y grows downward), and `points[indexOfMax].y` is the
    smallest.
  - `pathD` starts with `M ` and contains the same number of segments as input points.
  - Non-finite temps are filtered out; if fewer than 2 valid points remain, `pathD === ''`.
  - X coordinates are in `[paddingX, width - paddingX]` and monotonically non-decreasing.
- **Validate**: `npm test`

### Task 5: `src/ui/daily-strip.ts` + `src/ui/daily-strip.test.ts`

- **Action**: CREATE
- **Implement**:
  - `export function renderDailyStrip(daily: OpenMeteoDaily, todayIso?: string): HTMLElement`.
    Renders `<div class="detail-daily">` with up to 7 child `<div class="detail-daily-cell">`
    blocks: weekday label, weather icon (via `createWeatherIcon` + `describeWeatherCode`),
    max/min row using `formatTemperature`. The first cell with matching `todayIso` gets
    `.is-today`.
  - Defensive: if any of the parallel arrays is shorter than expected, render only as many
    cells as the shortest array supports.
  - Test: feeds a hand-crafted `OpenMeteoDaily` with 7 entries and asserts 7 cells, correct
    weekday labels, correct max/min text, and that the today cell carries `.is-today`.
- **Validate**: `npx tsc --noEmit && npm test`

### Task 6: `src/ui/detail.ts` — replace placeholder with real content

- **Action**: UPDATE
- **Implement**: After the existing header block, append (in order):
  1. `<section class="detail-chart">` containing the hourly SVG and precipitation row,
     built from `selectHourlySamples(forecast.hourly)` → `projectHourlyChart(...)` →
     `renderHourlyChart` + `renderPrecipRow`. Wrap with the header text "Next 24 hours".
  2. `<section class="detail-daily-wrap">` containing the daily strip from
     `renderDailyStrip(forecast.daily, forecast.current.time.slice(0, 10))`.
  Remove the `.detail-placeholder` element entirely.
  Wrap chart/strip building in a `try/catch`; on any error log to `console.error` with the
  location name (CLAUDE.md › Observability) and render a friendly note `Could not render
  the chart` — the rest of the detail view still shows.
- **Mirror**: existing structure in `src/ui/detail.ts:18-78`.
- **Validate**: `npx tsc --noEmit && npm test`

### Task 7: `src/ui/app.test.ts` — drop the placeholder assertion

- **Action**: UPDATE
- **Implement**: The test currently asserts the detail view contains `STORY-003`
  (`src/ui/app.test.ts:80`). Replace that assertion with one that confirms the detail view
  now renders the chart SVG (`section.detail .detail-chart svg`) and the daily strip
  (`section.detail .detail-daily`).
- **Validate**: `npm test`

### Task 8: `src/ui/styles.css` — append chart + daily styles

- **Action**: UPDATE (append-only — hotspot file, see Constraints)
- **Implement**: New rules:
  - `.detail-chart` — surface card style matching `.detail-header`, padding 12–16px, gap 8px.
  - `.detail-chart-title` — small uppercase muted heading.
  - `.detail-chart svg` — `width: 100%; height: auto;` (responsive scaling, no overflow).
  - Chart stroke uses `var(--accent-warm)`; area fill uses a translucent warm shade.
  - `.detail-chart-label-temp` — text above curve (slightly muted, tabular numerals).
  - `.detail-chart-label-time` — text below curve.
  - `.detail-precip-row` — flex/grid row with `grid-template-columns: repeat(N, 1fr)`; each
    cell centred, font-size 12px, color muted; drop SVG sized 12 px.
  - `.detail-daily-wrap` — surface card.
  - `.detail-daily` — horizontal flex / grid with 7 equal columns; mobile-fit (no horizontal
    scroll). Cells use `min-width: 0;` to allow shrink.
  - `.detail-daily-cell` — column flex (weekday, icon, max/min); 4-px gap.
  - `.detail-daily-cell.is-today` — subtle background highlight on the cell.
- **Validate**: `npm run build` (verifies CSS bundling)

### Task 9: Full validation pass

- **Action**: VALIDATE
- **Implement**: Run and capture:
  ```bash
  npm run lint
  npx tsc --noEmit
  npm test
  npm run build
  ```
  All must exit 0.

### Task 10: E2E visual smoke (agent-browser, best-effort)

- **Action**: VERIFY
- **Implement**: `npm run build && npm run preview` (background). With `agent-browser`:
  - Open preview URL at viewport 390×844.
  - Tap the first card; screenshot the detail view.
  - Confirm: SVG curve visible, time labels every 3 h, precipitation drops where mock data
    has them (e.g. Tallinn), 7 weekday cells with icons and max/min.
- **If browser tool unavailable**: defer-and-record in the report under "Sandbox-blocked".

---

## Verification matrix

| Verification | Runs in env? | If blocked: where/when verified |
|--------------|--------------|---------------------------------|
| `npm run lint` | yes | — |
| `npx tsc --noEmit` | yes | — |
| `npm test` (Vitest) | yes | — |
| `npm run build` (vite) | yes | — |
| `npm run preview` + agent-browser screenshot | likely yes | Defer to owner if browser tool blocked |
| Real iPhone 390×844 viewport check | no | Owner manual (CLAUDE.md › Sandbox-blocked) |

---

## Risks

| Risk | Mitigation |
|------|------------|
| SVG path math drift / curve self-intersects on flat data | Pure projection is unit-tested; flat-data branch verified explicitly. |
| Horizontal overflow on 390-px viewport | SVG uses `width: 100%`, `viewBox` 600×140. Daily strip uses 7 equal CSS grid columns. Asserted via screenshot in Task 10. |
| Hotspot conflict in `styles.css` with #8 | Append-only changes at the bottom; #8 also adds at top of file according to its scope. Owner reconciles at merge. |
| Date parsing locale drift (`new Date("2026-06-09")` interpreted as UTC midnight) | Use the fixed weekday table on `getDay()`. Tests pin a specific date and expected weekday. |
| `noUncheckedIndexedAccess` causing many guards in projection | Use a single defensive normalise step (filter to finite `tempC`) then iterate over the local validated array. |
| One bad mock breaks rendering | Whole chart+strip section is in try/catch; on failure log + render text fallback, keep header intact. |

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
# open http://localhost:4173 at 390x844, tap a card, screenshot
```

---

## Acceptance Criteria (mapped to STORY-003)

- [ ] SVG curve over ~24 h with value + time labels at 3-h step — Tasks 2, 3, 6 + Task 10 screenshot.
- [ ] Precipitation marked (mm and/or %) — Task 3 (`renderPrecipRow`) + Task 6 wiring.
- [ ] 7-day strip with icon + max/min — Tasks 5 + 6.
- [ ] SVG scales without overflow / horizontal scroll on mobile — Task 8 CSS + Task 10 screenshot.
- [ ] Unit-tested projection of `(time, temp)[]` → coords/path — Task 4.
- [ ] Type check, lint, tests pass — Task 9.
- [ ] Independent verification (verifier subagent if available; otherwise owner) — Phase 4.5.
