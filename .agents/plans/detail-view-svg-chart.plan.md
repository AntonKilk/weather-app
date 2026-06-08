# Plan: Detail view — SVG hourly chart + 7-day forecast

## Summary

Replace the Phase-1 detail-view placeholder (`src/ui/detail-view.ts:3-20`) with a
Google-widget-style detail panel built on the mock data already in `src/weather/`:
a hand-rolled inline SVG temperature curve sampled at 3-h cadence across the next
~24 hours, with value labels above each point and time labels below; a precipitation
row that visually marks hours with rain/snow (mm and/or probability %); and a 7-day
strip with weekday short label, WMO icon, and max/min temperatures. The chart's
point-projection — `(samples, options) → { points, pathD }` — is a pure function in
`src/ui/` that gets dedicated unit tests per Acceptance Criterion 5. No chart
libraries, no `innerHTML`, no new runtime dependencies. The SVG uses `viewBox` +
`preserveAspectRatio="xMidYMid meet"` and `width: 100%` so it scales cleanly inside
the 390-px iPhone viewport without horizontal scroll.

## User Story

As a user, I want to see in the detail view a temperature curve at a 2–3-h step,
precipitation marks, and a 7-day forecast (like the Google widget) so that I can
plan my day and the week ahead.

## Metadata

| Field | Value |
|-------|-------|
| Type | NEW_CAPABILITY |
| Complexity | MEDIUM |
| GitHub Issue | #3 (STORY-003) |
| PRD | `.agents/PRDs/offline-weather-pwa.prd.md` (Phase 1 — UI skeleton) |
| Stories | `.agents/stories/offline-weather-pwa.stories.md` → STORY-003 |
| Branch | `claude/vibrant-cray-zVX28` |
| Blocked by | STORY-002 (merged: `a0acad6`) |

---

## Patterns to follow

| Category | File:lines | Pattern |
|----------|-----------|---------|
| LAYERING | `CLAUDE.md` › Architecture | `ui/` may import types from `weather/` + `locations/`; `weather/` must NOT import from `ui/`. Chart projection lives in `src/ui/` (per STORY-003 Technical Notes: "in `src/ui/` or `src/weather/`" — UI side keeps the domain clean). |
| NAMING | `CLAUDE.md` › Code Patterns | Files kebab-case (`hourly-chart.ts`); types PascalCase (`ChartGeometry`); functions/vars camelCase (`buildChartGeometry`). |
| SVG CONSTRUCTION | `src/ui/icon.ts:5-18, 50-98` | `document.createElementNS('http://www.w3.org/2000/svg', tag)` only; `setAttribute` for every attr; never `innerHTML`. Mirror this exactly. |
| TEXT INJECTION | `src/ui/location-card.ts:25,32,36,45,49`; `CLAUDE.md` › Security | All textual content via `textContent`. SVG `<text>` element gets its label via `.textContent`. |
| ARIA / KEYBOARD | `src/ui/location-card.ts:13-15`; `src/ui/home-screen.ts:85-98` | Keep `role="button"` + `tabindex="0"` + `aria-expanded` on cards. The detail panel stays a sibling, toggled via `hidden`; no focus traps. |
| TESTS | `src/weather/wmo-codes.test.ts:1-43`, `src/ui/format.test.ts:1-45` | Vitest, no globals, import `{describe, expect, it}` from `'vitest'`; co-locate `*.test.ts`. Focus on pure logic (point projection), not DOM snapshots. |
| ERROR HANDLING | `CLAUDE.md` › Error handling; `src/ui/home-screen.ts:20-30` | A bad slot must not break others. Detail-view construction goes inside the same try/catch flow at the home-screen level. |
| FAULT TOLERANCE | `CLAUDE.md` › Fault Tolerance | If hourly or daily arrays are short/empty/NaN, render the section that does work and skip the section that doesn't with a friendly fallback line — never throw. |
| TS STRICTNESS | `tsconfig.json:9-13` | `strict`, `noUncheckedIndexedAccess`, `noUnusedLocals`/`Parameters`. All `arr[i]` accesses must be guarded; no `!` unless after an explicit length check. No `any`. |

Greenfield rows (no prior precedent — establish the pattern here):

- **Pure UI projection function** with unit tests — first one in the repo.
- **Responsive inline SVG with `viewBox` + 100% width** — extends the icon pattern from a fixed 36×36 to a scalable chart.

---

## Visual reference (verbatim from `examples/weather-lahti.png`)

8 evenly-spaced points along the curve. For each point:

- Value label sits **above** the curve (e.g. `19`, `21`, `21`, `17`, `12`, `9`, `13`, `19`).
- Time label sits **below** the curve (e.g. `14.00`, `17.00`, `20.00`, `23.00`, `2.00`, `5.00`, `8.00`, `11.00`).
- A faint accent fill below the curve.

We mirror this geometry but format hours in English `HH:00` (the reference's Finnish
`14.00` is a locale artifact — the project mandates English UI). The "as shown in
reference" wording in STORY-003 AC1 refers to layout, not locale punctuation.

Below the chart sits a row of precipitation marks aligned with the same 8 columns;
each mark is a small SVG drop (reuse the `droplet` shape philosophy from
`src/ui/icon.ts:100-105`) with the probability `%` (or mm) appearing only when
meaningful (precip > 0 mm OR probability ≥ 20 %).

Below that, the 7-day strip: 7 equally-wide cells, each containing weekday short
name (`Sun`/`Mon`/…), weather icon (re-use `renderIconSvg`), and `max° min°`. The
cell whose date matches "today" gets an accent border and the label `Today`.

---

## Data wiring (no new types — re-use what STORY-002 established)

We use the existing `HourlyForecast` / `DailyForecast` shapes verbatim:

```ts
// src/weather/types.ts (existing)
interface HourlyForecast {
  time: string[];                       // ISO-8601 local
  temperature_2m: number[];             // °C
  precipitation: number[];              // mm
  precipitation_probability: number[];  // %
  weather_code: number[];               // WMO
}
interface DailyForecast {
  time: string[];                       // 'YYYY-MM-DD'
  weather_code: number[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  precipitation_sum: number[];
}
```

A small **internal** type lives in `src/ui/hourly-chart.ts` for the projection
output. It is private to the chart module — no other UI code consumes the
intermediate shape.

```ts
// src/ui/hourly-chart.ts (new — interface exported for the test only)
export interface ChartPoint {
  x: number;          // viewBox units
  y: number;          // viewBox units (inverted: top = high temp)
  tempC: number;      // raw temperature (for labels)
  timeLabel: string;  // 'HH:00'
  precipMm: number;
  precipProb: number; // %
}

export interface ChartGeometry {
  points: ChartPoint[];
  pathD: string;      // smooth polyline path 'M ... L ... L ...'
  width: number;      // viewBox width (matches options.width)
  height: number;     // viewBox height (matches options.height)
  minTempC: number;   // for debug + tests
  maxTempC: number;
}

export interface ChartOptions {
  width: number;        // default 320
  height: number;       // default 120
  paddingX: number;     // default 16 — leave room for first/last labels
  paddingTop: number;   // default 22 — room for the value label above the curve
  paddingBottom: number;// default 30 — room for the time label below the curve
}
```

### Sampling rule (matches the reference)

- Source: `HourlyForecast.time` + `temperature_2m` (and matching `precipitation` / `precipitation_probability` arrays — same indices).
- Starting index: **0** (the first available hour from the mock; STORY-004 will narrow this to "now or next hour" against the real `current.time`).
- Step: **3 hours** (every 3rd element).
- Count: **8 points** (covers 21 h, matching the reference's 8-point widget).
- Guards: if the hourly arrays are shorter than 8×3 = 24 entries, sample as many as
  `Math.min(8, Math.floor(time.length / 3))` give. If 0 → return `points: []` and
  the renderer shows a single "Hourly data unavailable" line.
- If any sampled `tempC` is `NaN`/missing, drop that sample (do not interpolate);
  the path becomes a polyline across the remaining points.

### Projection rule (pure, deterministic — fully unit-testable)

- X: linear spacing across `[paddingX, width - paddingX]`. With `n` points and
  `n > 1`, the i-th x is `paddingX + i * (width - 2*paddingX) / (n - 1)`. With
  `n === 1`, the single x is at the horizontal centre.
- Y: invert the temperature range into `[paddingTop, height - paddingBottom]`.
  Let `tMin = min(temps)`, `tMax = max(temps)`. If `tMax === tMin` (flat day), all
  points land on the vertical centre between `paddingTop` and
  `height - paddingBottom`. Otherwise:
  `y = paddingTop + (1 - (tempC - tMin) / (tMax - tMin)) * (height - paddingTop - paddingBottom)`.
- `pathD`: simple polyline `M x0 y0 L x1 y1 L x2 y2 …`. (Smooth bezier rendering is
  a UI nicety — keep the geometry deterministic for the unit test; rendering can
  prettify the same `points` separately in a later issue.)

Acceptance check: **`buildChartGeometry` is the function STORY-003 AC5 demands be
unit-tested** — pure, in/out, no DOM, no time, no randomness.

---

## Files to change

| File | Action | Purpose |
|------|--------|---------|
| `src/ui/hourly-chart.ts` | CREATE | `buildChartGeometry(samples, options)` (pure) + `renderHourlyChart(hourly, options)` (DOM). |
| `src/ui/hourly-chart.test.ts` | CREATE | Unit tests for the pure projection — point count, x spacing, y inversion, flat-day handling, NaN drop, empty input, custom options. |
| `src/ui/daily-strip.ts` | CREATE | `renderDailyStrip(daily)` — 7-cell row with weekday short name, icon, max/min. |
| `src/ui/daily-strip.test.ts` | CREATE | Renders a daily strip on a mock fixture; asserts cell count, "Today" highlight, max/min text, icon presence. |
| `src/ui/format.ts` | UPDATE | Add `formatHourLabel(iso: string): string` ("HH:00") and `formatWeekdayShort(iso: string, todayIso?: string): string` ("Sun" / "Today"). |
| `src/ui/format.test.ts` | UPDATE | Tests for the two new formatters (DST-agnostic — use UTC-only parsing for the test fixtures). |
| `src/ui/detail-view.ts` | UPDATE | Replace the placeholder with a real detail view (header line + chart + precip row + daily strip). Rename `renderDetailPlaceholder` → `renderDetailView`. Hosts a `try/catch` per sub-section so a broken chart doesn't take down the strip and vice versa. |
| `src/ui/home-screen.ts` | UPDATE | Adapt the import + call to `renderDetailView(slot, forecast)`. Pass the forecast (or `undefined` for a missing slot — then render an "Unavailable" detail body). Update the `.detail-placeholder` class lookup to `.location-detail`. |
| `src/ui/home-screen.test.ts` | UPDATE | Switch all `.detail-placeholder` queries to `.location-detail`. Add one assertion that an expanded detail panel contains an `<svg class="hourly-chart">` and a 7-day strip with 7 cells. |
| `src/ui/styles.css` | UPDATE | Append `.location-detail`, `.hourly-chart`, `.hourly-chart__*`, `.precip-row`, `.daily-strip`, `.daily-strip__cell` rules. Remove or repurpose the dashed-border `.detail-placeholder` rule block. **Hotspot per CLAUDE.md — keep edits scoped to appended rules + the one removal.** |

Counts: **4 CREATE**, **5 UPDATE**, **0 DELETE**.

`src/main.ts`, `vite.config.ts`, `index.html`, types under `src/weather/`,
`src/locations/`, the WMO mapping, and the icon renderer are NOT touched. (Per
CLAUDE.md hotspot rules, avoiding `src/main.ts` and `vite.config.ts` is deliberate.)

---

## Pure function contract (write this exactly)

```ts
// src/ui/hourly-chart.ts

import type { HourlyForecast } from '../weather/types';

export interface ChartPoint { x: number; y: number; tempC: number; timeLabel: string; precipMm: number; precipProb: number; }
export interface ChartGeometry { points: ChartPoint[]; pathD: string; width: number; height: number; minTempC: number; maxTempC: number; }
export interface ChartOptions { width: number; height: number; paddingX: number; paddingTop: number; paddingBottom: number; }

export const DEFAULT_CHART_OPTIONS: ChartOptions = {
  width: 320, height: 120, paddingX: 16, paddingTop: 22, paddingBottom: 30,
};

export function buildChartGeometry(
  hourly: Pick<HourlyForecast, 'time' | 'temperature_2m' | 'precipitation' | 'precipitation_probability'>,
  options?: Partial<ChartOptions>,
): ChartGeometry;

export function renderHourlyChart(
  hourly: HourlyForecast,
  options?: Partial<ChartOptions>,
): SVGElement;
```

Implementation notes:

- The pure function must read its index-aligned arrays with guards
  (`noUncheckedIndexedAccess` is on). Use a single loop that pushes a sample only
  when every required field at that index is a finite number; otherwise skip.
- Sample step constant `STEP_HOURS = 3` and target count `TARGET_POINTS = 8` are
  module-level `const`s — change them in one place if the sampling cadence is
  ever revisited.
- `pathD` for an empty `points` array → `''`; the caller decides what to render.

---

## Renderer contract

`renderHourlyChart` builds an `<svg class="hourly-chart" viewBox="0 0 W H" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Hourly temperature">`
containing, in order:

1. An optional `<path class="hourly-chart__fill" d="<pathD + closing to baseline>">` for the soft accent fill.
2. `<path class="hourly-chart__line" d="<pathD>">` — the curve.
3. For each `ChartPoint`:
   - `<text class="hourly-chart__value" x="px" y="py - 8" text-anchor="middle">` with `textContent = formatTemperature(tempC)`.
   - `<text class="hourly-chart__time"  x="px" y="height - 14" text-anchor="middle">` with `textContent = timeLabel`.

The precipitation row is a **separate sibling element** (an HTML `<div class="precip-row">`)
because mixing flow-content alignment with SVG text positioning is fragile. It has
the same number of cells as the chart's columns (8 by default) — CSS uses
`display: grid; grid-template-columns: repeat(var(--cols), 1fr);` and the
container CSS variable `--cols` is set inline from the actual point count
(via `style.setProperty('--cols', String(points.length))`). Cells where
`precipMm > 0 || precipProb >= 20` render a drop SVG + a small label
(`{precipProb}%` if probability dominates, else `{precipMm.toFixed(1)} mm`).
Empty cells get an `aria-hidden` blank to preserve alignment.

---

## Daily strip contract

```ts
// src/ui/daily-strip.ts

import type { DailyForecast } from '../weather/types';

export function renderDailyStrip(
  daily: DailyForecast,
  todayIso?: string, // 'YYYY-MM-DD'; defaults to today in the local zone
): HTMLElement;
```

Implementation:

- One `<ul class="daily-strip">` with one `<li class="daily-strip__cell">` per
  daily entry (cap at 7 — sample only the first 7 indices). Each cell:
  - `<span class="daily-strip__day">` with `textContent = formatWeekdayShort(iso, todayIso)`.
    When the date equals `todayIso`, return literal `'Today'` and the cell gets
    an extra class `daily-strip__cell--today`.
  - `renderIconSvg(condition.iconKey, condition.description)` — reused from
    `src/ui/icon.ts`. Wrap each icon `<svg>` to constrain CSS size.
  - `<span class="daily-strip__temps">` containing two `<span>`s: max and min
    (`formatTemperature` each). Side-by-side via flexbox so visually you get
    `21° 9°` like the reference.
- All text via `textContent`. No `innerHTML`.

CSS uses `display: grid; grid-template-columns: repeat(7, minmax(0, 1fr));` so the
strip scales horizontally on narrow viewports without overflow (cells shrink, no
horizontal scroll). On the iPhone 390-px viewport this gives ~52 px per cell,
which fits the day label + 24-px icon + temp pair comfortably.

---

## Detail-view contract (the panel itself)

```ts
// src/ui/detail-view.ts

import type { LocationSlot } from '../locations/types';
import type { ForecastResponse } from '../weather/types';

export function renderDetailView(
  slot: LocationSlot,
  forecast: ForecastResponse | undefined,
): HTMLElement;
```

Structure (all built with `createElement` + `textContent`):

```
<section class="location-detail" id="detail-${slot.id}" hidden aria-label="${slot.name} detailed view">
  <h3 class="location-detail__title">${slot.name}</h3>
  <!-- when forecast === undefined → just a <p>No data available for this location.</p> -->
  <div class="location-detail__chart">
    <svg class="hourly-chart" ...>…</svg>
    <div class="precip-row">…</div>
  </div>
  <ul class="daily-strip">…</ul>
</section>
```

Sub-sections each wrapped in their own try/catch — if `renderHourlyChart` throws,
log to console and render `<p class="location-detail__fallback">Hourly chart
unavailable.</p>`; same for the daily strip. The title row always renders so the
panel never goes blank.

`renderHomeScreen` no longer needs to pass extra wiring — `aria-controls`
already comes from `detail-${slot.id}`, which `renderDetailView` keeps as its `id`.

---

## Tasks

Execute in order. Each task is atomic and verifiable.

### Task 1: Format helpers — `src/ui/format.ts` (+ tests)

- **File**: `src/ui/format.ts`, `src/ui/format.test.ts`
- **Action**: UPDATE both
- **Implement**:
  - `export function formatHourLabel(iso: string): string` — parse the ISO string,
    return `${hh}:00` where `hh` is the local `getHours()` zero-padded. (For the
    mock-data tests, the inputs already include explicit `Z` so `getHours()` may
    differ by env timezone — write the test to call the function with both Z and
    non-Z inputs and assert the format `/^\d{2}:00$/`, plus one DST-agnostic
    fixed-zone-style check using a hand-crafted `YYYY-MM-DDTHH:00:00` string
    without `Z` so it's interpreted in local time deterministically.)
  - `export function formatWeekdayShort(iso: string, todayIso?: string): string` —
    if `iso` parses to the same calendar date as `todayIso` (also ISO-date, accept
    either `YYYY-MM-DD` or full ISO), return `'Today'`. Otherwise return
    `Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(date)`
    (`'Sun'`, `'Mon'`, …).
- **Mirror**: `src/ui/format.ts:1-13` for tone and signature style.
- **Validate**: `npm test` (the format file's tests must pass — they did before).

### Task 2: Pure chart projection — `src/ui/hourly-chart.ts` (function only, no DOM)

- **File**: `src/ui/hourly-chart.ts`
- **Action**: CREATE
- **Implement**:
  - The interfaces and constants in the "Pure function contract" section.
  - `STEP_HOURS = 3`, `TARGET_POINTS = 8` as module-level constants.
  - A private `sample(hourly)` helper that returns `{ time, tempC, precipMm, precipProb }[]`
    indexed at `[0, 3, 6, …]` and guarded by `Number.isFinite` on the temperature.
  - `buildChartGeometry(hourly, options?)`:
    - Merge with `DEFAULT_CHART_OPTIONS`.
    - Sample.
    - Compute `minTempC`/`maxTempC` (`Math.min/max(...samples.map(s => s.tempC))`).
    - Compute x per the spacing rule; y per the inversion rule (with flat-day
      special case).
    - Build `pathD` (empty string if no points).
    - Return `ChartGeometry`.
  - **Do NOT** import or call any DOM API in this part of the file (keeps the
    pure function testable in any environment).
- **Mirror**: pure-module style of `src/weather/wmo-codes.ts:3-56`.
- **Validate**: covered by Task 3 tests.

### Task 3: Pure-function unit tests — `src/ui/hourly-chart.test.ts`

- **File**: `src/ui/hourly-chart.test.ts`
- **Action**: CREATE
- **Implement** at minimum:
  1. **Happy path (24-hour mock)**: pass the `MOCK_FORECASTS['mock-1'].hourly`
     fixture; expect exactly 8 points; assert that `points[0].x === paddingX` and
     `points[7].x === width - paddingX` (or whatever the spacing rule yields —
     compute the expected values directly in the test from the same constants
     so the test isn't a tautology). Assert `points[i].y` lies within
     `[paddingTop, height - paddingBottom]` for every i.
  2. **Y inversion**: of the 8 sampled temps from `mock-1`, the warmest sample's
     `y` must be the smallest number and the coldest's must be the largest.
  3. **Flat day**: pass an hourly object where all temps equal 15; expect every
     point's `y` to equal the vertical midpoint
     `paddingTop + (height - paddingTop - paddingBottom) / 2`.
  4. **NaN drop**: inject `NaN` at index 6 of `temperature_2m` (a sampled index);
     expect the geometry's `points.length === 7`.
  5. **Short input**: pass `time: []` + empty arrays; expect `points` to be `[]`
     and `pathD === ''`.
  6. **Custom options**: pass `{ width: 200, height: 80, paddingX: 10 }`; assert
     `geometry.width === 200`, `geometry.height === 80`, and the first/last point
     respect the custom `paddingX`.
  7. **Path matches points**: split `pathD` on whitespace and verify the count
     matches `1 + 2 * points.length` tokens (one `M`, `(2 * n - 1)` more), and
     the first two numeric tokens equal `points[0].x` and `points[0].y`.
- **Mirror**: `src/weather/wmo-codes.test.ts:1-43` (no globals; `it.each` is OK).
- **Validate**: `npm test`.

### Task 4: Chart renderer — extend `src/ui/hourly-chart.ts`

- **File**: `src/ui/hourly-chart.ts`
- **Action**: UPDATE (same file, append renderer below the pure function)
- **Implement** `renderHourlyChart(hourly, options?)`:
  - Compute geometry via `buildChartGeometry`.
  - Build the `<svg>` element via `createElementNS` (mirror `src/ui/icon.ts:5-18`).
    Set `viewBox = '0 0 W H'`, `preserveAspectRatio = 'xMidYMid meet'`,
    `role = 'img'`, `aria-label = 'Hourly temperature'`, and `class = 'hourly-chart'`.
  - Append the fill path (closed to the bottom baseline) and the line path.
  - Append one `<text>` per point for the value (use `formatTemperature`).
  - Append one `<text>` per point for the time (use `formatHourLabel`).
  - Build a sibling HTML `<div class="precip-row">` (via `createElement`) with
    `--cols` set inline from `points.length`; for each point append a `<div
    class="precip-row__cell">` whose contents are either a drop SVG + small text
    (when `precipMm > 0 || precipProb >= 20`) or an empty `<span aria-hidden="true">`.
  - Return a **document fragment** (`document.createDocumentFragment()`) holding
    both children, so the caller can append once. (Alternatively wrap in a
    container `<div class="location-detail__chart">` — chosen here for explicit
    CSS targeting.) **Decision: return a `<div class="location-detail__chart">`
    container** — easier for the caller and matches the structure in the
    detail-view contract above.
- **Validate**: covered by Task 7 + Task 9 tests + dev-server smoke.

### Task 5: Daily-strip renderer — `src/ui/daily-strip.ts`

- **File**: `src/ui/daily-strip.ts`
- **Action**: CREATE
- **Implement** per the "Daily strip contract" section. Uses `wmoToCondition`
  + `renderIconSvg`. `todayIso` defaults to
  `new Date().toISOString().slice(0, 10)` when omitted — but **the renderer
  accepts an explicit `todayIso` so tests are deterministic** (don't depend on
  the system clock).
- **Guards**: `daily.time.length === 0` → return `<ul class="daily-strip
  daily-strip--empty">` with a single `<li>Daily forecast unavailable.</li>`.
  Cap iteration at `Math.min(7, daily.time.length)`. Skip any index where
  `temperature_2m_max[i]` or `temperature_2m_min[i]` is not finite.
- **Validate**: covered by Task 6.

### Task 6: Daily-strip tests — `src/ui/daily-strip.test.ts`

- **File**: `src/ui/daily-strip.test.ts`
- **Action**: CREATE
- **Implement**:
  - Render a strip from `MOCK_FORECASTS['mock-1'].daily` with `todayIso = '2026-06-07'`
    (matches `START_DAY` in the mock).
  - Assert `querySelectorAll('.daily-strip__cell').length === 7`.
  - Assert the first cell has the `daily-strip__cell--today` modifier class and
    its day label `textContent === 'Today'`.
  - Assert the second cell's day label matches `/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/`
    (locale-agnostic weekday check — we don't pin the literal string because
    `Intl` weekday output is locale-stable but the test should not be brittle).
  - Assert each cell contains an `<svg class^="weather-icon">` (icon present).
  - Assert each cell's temps text matches `/-?\d+°\s+-?\d+°/`.
  - Empty-daily case: render with `{ time: [], … }` → expect the
    `daily-strip--empty` class and a single fallback `<li>`.
- **Mirror**: `src/ui/location-card.test.ts:1-44` (jsdom-driven element queries).
- **Validate**: `npm test`.

### Task 7: Detail view — `src/ui/detail-view.ts`

- **File**: `src/ui/detail-view.ts`
- **Action**: UPDATE
- **Implement**:
  - Replace `renderDetailPlaceholder` with `renderDetailView(slot, forecast)` per
    the "Detail-view contract" section.
  - Section element: `<section class="location-detail" id="detail-${slot.id}"
    hidden aria-label="${slot.name} detailed view">`.
  - Always append the title (`<h3 class="location-detail__title">`); when
    `forecast === undefined`, append a `<p class="location-detail__empty">No
    data available for this location.</p>` and return.
  - Otherwise, build the chart subtree in a try/catch (Catch path: `console.error('[ui]
    hourly chart failed', err)` + append a `<p class="location-detail__fallback">Hourly
    chart unavailable.</p>`). Repeat for the daily strip.
  - Return the section element.
- **Validate**: covered by Task 8 + the home-screen tests in Task 8.

### Task 8: Home-screen wiring + tests — `src/ui/home-screen.ts` / `.test.ts`

- **File**: `src/ui/home-screen.ts`, `src/ui/home-screen.test.ts`
- **Action**: UPDATE
- **Implement** (`home-screen.ts`):
  - Change the import to `import { renderDetailView } from './detail-view';`.
  - Change the call to `renderDetailView(slot, forecasts[slot.id])` — pass the
    forecast directly so the detail view can render its empty state when missing
    instead of duplicating the missing-data logic at the home-screen level.
  - The rest of the toggle/event-delegation logic is unchanged.
- **Implement** (`home-screen.test.ts`):
  - Update every `.detail-placeholder` query to `.location-detail`.
  - Update the assertion that compared with `detail-${MOCK_LOCATIONS[0]!.id}` to
    keep working (the id stays the same).
  - Add a new test: after expanding the first card, query
    `document.getElementById('detail-mock-1')` and assert it contains exactly one
    `svg.hourly-chart` and one `ul.daily-strip` with 7 cells.
  - Add an extra test for the missing-forecast case: a slot without a forecast
    expands to a detail panel showing the "No data available for this location."
    fallback text.
- **Mirror**: existing tests in `src/ui/home-screen.test.ts:1-101` — same import
  patterns, same `mount` helper.
- **Validate**: `npm test`.

### Task 9: Styles — `src/ui/styles.css`

- **File**: `src/ui/styles.css`
- **Action**: UPDATE (append + replace one block)
- **Implement**:
  - **Remove** the dashed-border `.detail-placeholder*` rules (lines ~148–166 of
    the current file). They referred to a placeholder we just deleted.
  - **Append** these blocks (keep total file under ~250 lines):
    - `.location-detail` — solid container styled like the card (padding 14px 16px,
      border 1px solid var(--border), border-radius var(--radius), background
      var(--card-bg), margin: -4px 4px 4px to nest under its card visually).
    - `.location-detail__title` — h3, 1rem, margin 0 0 10px.
    - `.location-detail__empty`, `.location-detail__fallback` — muted small text.
    - `.location-detail__chart` — block container; `svg.hourly-chart { width: 100%;
      height: auto; display: block; }`.
    - `.hourly-chart__line` — `fill: none; stroke: var(--accent); stroke-width: 2;
      stroke-linecap: round; stroke-linejoin: round;`.
    - `.hourly-chart__fill` — `fill: var(--accent); fill-opacity: 0.18; stroke: none;`.
    - `.hourly-chart__value` — `font-size: 11px; fill: var(--fg); font-weight: 600;`.
    - `.hourly-chart__time` — `font-size: 11px; fill: var(--muted);`.
    - `.precip-row` — `display: grid; grid-template-columns: repeat(var(--cols, 8),
      1fr); gap: 4px; margin-top: 4px;`. `.precip-row__cell` — small, centred,
      `min-height: 18px`.
    - `.daily-strip` — `display: grid; grid-template-columns: repeat(7,
      minmax(0, 1fr)); list-style: none; padding: 0; margin: 12px 0 0; gap: 4px;`.
    - `.daily-strip__cell` — flex column, centred, padding 6px 2px, border-radius
      10px. `.daily-strip__cell--today` — `background: rgba(247, 181, 0, 0.12);
      border: 1px solid var(--accent);`.
    - `.daily-strip__day`, `.daily-strip__temps` — small font sizes (12px / 11px).
    - The icons inside cells are constrained: `.daily-strip__cell .weather-icon
      { width: 28px; height: 28px; }`.
- **Validate**: agent-browser screenshot at 390×844 → no horizontal scroll, chart
  visible end-to-end, daily strip wraps to one row of 7 cells. `npm run build`
  output stays small (CSS gzip target: ≲ 2 KB).

### Task 10: Full validation pass + visual demo

- **Implement**:
  1. `npm run lint && npx tsc --noEmit && npm test` — all green.
  2. `npm run build` — succeeds.
  3. `npm run dev -- --port 5173 --strictPort` (background); use the
     `agent-browser` skill to load `http://localhost:5173/` at viewport `390×844`,
     screenshot the home screen, click the first card, screenshot the expanded
     detail view (chart + precip row + 7-day strip visible). Save under
     `.agents/reports/screenshots/`.
  4. Record everything in
     `.agents/reports/detail-view-svg-chart-report.md` mirroring
     `.agents/reports/ui-skeleton-location-cards-report.md` structure (Summary,
     Tasks Completed, Validation Evidence, Acceptance Criteria Mapping, Tests
     Written, Files Changed, Re-verification).
- **Validate**: every command in `## Validation` exits 0; the report file exists;
  screenshots show the chart curve, 8 time labels, the precipitation row, and 7
  daily cells.

---

## Risks

| Risk | Mitigation |
|------|------------|
| `noUncheckedIndexedAccess` makes `hourly.temperature_2m[i]` `number \| undefined` — easy to forget a guard | The pure `sample()` helper is the single point of array indexing; it filters by `Number.isFinite`. Everything downstream sees the narrowed `ChartPoint[]`. |
| Timezone surprises in `formatHourLabel` (jsdom uses host TZ) | Tests assert the *format* with a regex (`/^\d{2}:00$/`) plus one deterministic case using a non-Z ISO ("local time" string). We do NOT pin specific hour values, so the test passes in UTC, Europe/Helsinki, or any CI runner zone. STORY-004 will revisit this when the real API returns `timezone=auto`. |
| Chart SVG breaks layout on narrow viewport | `viewBox` + `preserveAspectRatio="xMidYMid meet"` + `width: 100%; height: auto` keep it within the parent. Verified by agent-browser screenshot at 390×844. |
| Mocks' `precipitation_probability` is always 60% (when precip > 0) or 5% — visually flat | Acceptable for STORY-003: the renderer's branching is testable on these mock values (rain/snow slots get visible markers; clear-sky slots stay blank). STORY-004's real data exercises the variation naturally. |
| Renaming `renderDetailPlaceholder` → `renderDetailView` and `.detail-placeholder` → `.location-detail` cascades | Captured in Task 8: only `home-screen.ts` and `home-screen.test.ts` import/query the old names. Single grep confirms scope. CSS replacement is one block (Task 9). |
| `src/ui/styles.css` grows beyond the "hotspot" comfort zone | Constrained to ~80 new lines + removal of ~20. Final file still well under 300 lines. |
| `Intl.DateTimeFormat` output may vary slightly across Node versions | Test asserts via regex `/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/`, not literal equality. Acceptable. |
| Sandbox can't take a real-device iPhone screenshot | Defer-and-record per CLAUDE.md › Sandbox-blocked checks. agent-browser at 390×844 is the in-sandbox proxy. |
| Previous attempt's branch (`claude/issue-3-detail-view-svg-chart`, referenced in the issue's stale comment) exists upstream | We are NOT touching it. All work lands on `claude/vibrant-cray-zVX28`. The old branch's files are not in the current working tree, so there's no merge conflict to manage. |

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
# Then via the agent-browser skill:
#   - open http://localhost:5173/ at viewport 390x844
#   - screenshot home → save under .agents/reports/screenshots/home.png
#   - click the first .location-card
#   - screenshot expanded → save under .agents/reports/screenshots/detail-mock-1.png
```

Deferred (CLAUDE.md › Sandbox-blocked checks — recorded, NOT failed):

- Real-iPhone Add-to-Home-Screen test (PWA infra arrives in STORY-006).
- Real-iPhone airplane-mode offline check (offline cache arrives in STORY-007).

---

## Acceptance criteria

Issue #3 ACs → tasks/tests mapping (every AC maps to ≥ 1 task or test):

- [ ] **AC1**: SVG temperature curve over ~24 h with value + time labels at 3-h step,
      matching the reference layout.
      → Task 2 (`buildChartGeometry` 8 points × 3-h cadence), Task 3
      (point-count / spacing / inversion tests), Task 4 (renderer emits
      `<text class="hourly-chart__value">` + `<text class="hourly-chart__time">`
      per point), Task 9 (CSS), Task 10 (screenshot).
- [ ] **AC2**: Precipitation visually marked on hours with rain/snow (mm and/or %).
      → Task 4 (precip row built from `precipMm` / `precipProb`), Task 9 (CSS for
      `.precip-row`), Task 6 (covers icon presence indirectly), Task 10 (screenshot
      shows the rainy mock slot's row).
- [ ] **AC3**: 7-day strip with weekday + WMO icon + max/min.
      → Task 5 (`renderDailyStrip`), Task 6 (7 cells + icon + temps + Today), Task 9
      (CSS), Task 10 (screenshot).
- [ ] **AC4**: Mobile viewport — SVG scales, no horizontal scroll.
      → Task 4 (viewBox + preserveAspectRatio), Task 9 (`width: 100%; height: auto`),
      Task 10 (agent-browser at 390×844 records `scrollWidth === clientWidth`).
- [ ] **AC5**: Pure point-projection function is unit-tested.
      → Task 2 (function), Task 3 (≥ 7 unit-test cases).

Process gates:

- [ ] All tasks completed
- [ ] `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build` pass
- [ ] Follows the patterns table (esp. `textContent`-only, `createElementNS` for
      SVG, layer direction, naming)
- [ ] Issue #3 acceptance criteria → tasks/tests mapping above is complete
- [ ] agent-browser screenshot at 390×844 attached to the implementation report
- [ ] Sandbox-blocked checks (real-iPhone install, airplane-mode) recorded as
      defer-and-record, NOT treated as failures
- [ ] No new runtime dependencies added (`package.json` `dependencies` stays empty)
- [ ] No `innerHTML` anywhere in new code (grep confirms)
- [ ] No real default locations (Lahti / Helsinki / Tallinn / Käsmu) committed
