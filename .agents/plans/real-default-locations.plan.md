# Plan: Real default locations from env — Open-Meteo wired into the UI

## Summary

Replace the mock wiring in `src/main.ts` with the real Phase-2 data path:
parse `VITE_DEFAULT_LOCATIONS` (a JSON array of `{name, lat, lon}`) at build
time into a typed `LocationSlot[]`, fetch each slot in parallel through the
existing `fetchForecast` (STORY-004), and feed the results into the
already-fault-tolerant `renderHomeScreen`. Add the CC-BY 4.0 attribution
footer ("Weather data by Open-Meteo"). On invalid or missing env, log a
clear console error and render an empty state — never crash. On a single
slot's API failure, the others still render normally (the home screen's
`renderDegradedCard` path already handles this; we only need to keep
fetches isolated). No real city names or coordinates land in the repo —
that's the whole point of the env var. Mocks stay in place for tests.

## User Story

As the user (iPhone owner of this personal PWA),
I want to see real Open-Meteo weather for my 4 default locations injected
at build time from an env var,
so that the app becomes useful day-to-day **and** my home cities never
appear in the public repo.

## Metadata

| Field | Value |
|-------|-------|
| Type | NEW_CAPABILITY (Phase 2 wiring) |
| Complexity | SMALL |
| GitHub Issue | #5 (STORY-005) |
| PRD | `.agents/PRDs/offline-weather-pwa.prd.md` — Phase 2 (API integration) |
| Stories | `.agents/stories/offline-weather-pwa.stories.md` → STORY-005 |
| Branch | `claude/friendly-goldberg-ryjk8` |
| Blocked by | STORY-002 (merged), STORY-004 (merged) |
| Blocks | STORY-006, STORY-007, STORY-009 |

---

## Patterns to follow

| Category | File:lines | Pattern |
|----------|-----------|---------|
| LAYERING | `CLAUDE.md` › Architecture | Direction: `ui → app services → api/storage → domain`. New env parser lives in `src/locations/` (domain), forecast orchestrator in `src/weather/` (domain). `main.ts` wires them. Locations module MUST NOT import from `weather/` (peer domains stay independent — define the result type locally). |
| RESULT TYPE | `src/weather/open-meteo-client.ts:8-17` | Discriminated union `{ ok: true; data } \| { ok: false; error }` with typed `error.kind`. Establish the same pattern in `locations/default-locations.ts` (locally — do NOT cross-import from `weather/`). |
| INPUT VALIDATION | `src/weather/open-meteo-client.ts:57-62`, `parseForecast` at 143-171 | Narrow `unknown` at the boundary, check every field, return a `parse`-kind error with a message naming what's wrong. The env string is "external input" → same paranoia. |
| NAMING | `CLAUDE.md` › Code Patterns | Files kebab-case (`default-locations.ts`, `load-forecasts.ts`, `footer.ts`); types PascalCase (`ParseError`, `ParseResult`); functions/vars camelCase. Domain-first names: not `EnvParser` or `Helper`. |
| TYPE STRICTNESS | `tsconfig.json:9-13`, `.eslintrc.cjs:21` | No `any` (lint = error). `noUncheckedIndexedAccess` is on — guard every array index. Use `satisfies` where it tightens the contract. |
| FETCH ORCHESTRATION | STORY-004 contract, `.agents/plans/completed/open-meteo-client.plan.md:147-157` | `Promise.all` over slots is safe because `fetchForecast` never throws. Per-slot failure → that slot's entry is omitted from the forecasts map → `renderHomeScreen` auto-renders `renderDegradedCard` (existing behavior, already tested at `src/ui/home-screen.test.ts:85-100`). |
| OBSERVABILITY | `CLAUDE.md` › Observability, `src/weather/open-meteo-client.ts:83-86` | `console.warn`/`console.error` at boundaries with a `[domain]` prefix and slot name as context. No analytics, no telemetry. |
| ERROR HANDLING | `CLAUDE.md` › Error handling, `src/ui/home-screen.ts:20-30` | Never blank the screen on failure. Distinguish "no data for this slot" (degraded card) from "nothing configured at all" (empty state with a friendly message). Never expose stack traces or env-var contents in the UI. |
| SECURITY | `CLAUDE.md` › Security, `src/ui/location-card.ts:25,36,45,49` | Render API-sourced strings with `textContent`, NEVER `innerHTML`. Existing card/footer rendering already follows this — keep the line. |
| TESTS | `src/weather/open-meteo-client.test.ts:1-27, 77-100`, `src/weather/wmo-codes.test.ts:1-43` | Vitest, no globals; `import { describe, expect, it, vi, afterEach } from 'vitest'`; co-locate `*.test.ts`. For DOM tests mirror `src/ui/home-screen.test.ts:1-13` (mount into `document.body`, clear in `afterEach`). For the orchestrator mock `fetchForecast` via `vi.fn` injected as a dep — do NOT touch `globalThis.fetch` here (the client already owns that boundary). |
| ENV TYPING | `tsconfig.json:6` (`vite/client` in `types`) | Vite injects `VITE_*` env at build time via `import.meta.env`. Extend `ImportMetaEnv` in a new `src/vite-env.d.ts` so `import.meta.env.VITE_DEFAULT_LOCATIONS` is typed `string \| undefined`, not `any`. |

---

## Public contracts

### `src/locations/default-locations.ts` (pure parser — testable, no env reads)

```ts
import type { LocationSlot } from './types';

export type ParseError =
  | { kind: 'missing'; message: string }      // env var not set or empty
  | { kind: 'invalid-json'; message: string } // JSON.parse threw
  | { kind: 'invalid-shape'; message: string }; // wrong type/range at the boundary

export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ParseError };

// Parses the raw env-var string into typed default LocationSlot[].
// IDs are positional ("default-0".."default-N") — deterministic, no PII.
// kind is fixed to 'default' for every entry.
export function parseDefaultLocations(raw: string | undefined): ParseResult<LocationSlot[]>;
```

Validation rules (per entry):

- Must be a JSON object (not array, not primitive, not null).
- `name`: non-empty string after trim. Trim before assigning; reject empty.
- `lat`: finite number, `-90 ≤ lat ≤ 90`.
- `lon`: finite number, `-180 ≤ lon ≤ 180`.
- Unknown extra fields are ignored (forward-compat).
- Top level must be a non-empty array. Empty array → `invalid-shape` ("no entries").

The parser is **pure**: it does not read `import.meta.env`, does not log,
does not throw. `main.ts` is the one place that reads env, calls this
parser, and decides how to react.

### `src/weather/load-forecasts.ts` (orchestrator — pure over an injected fetcher)

```ts
import type { LocationSlot } from '../locations/types';
import type { ForecastResponse } from './types';
import type { FetchResult } from './open-meteo-client';

export interface LoadForecastsDeps {
  // Default: open-meteo-client.fetchForecast
  fetchForecast?: (lat: number, lon: number) => Promise<FetchResult<ForecastResponse>>;
}

// Fetches all slots in parallel. NEVER throws — failed slots are simply
// absent from the returned map (the home screen renders them as degraded).
// Logs per-slot failures with `[load-forecasts]` prefix + slot name.
export async function loadForecasts(
  slots: readonly LocationSlot[],
  deps?: LoadForecastsDeps,
): Promise<Record<string, ForecastResponse>>;
```

Behavior:

- Single `Promise.all` over `slots.map(s => fetchForecast(s.latitude, s.longitude))`.
- For each result: if `ok` → write `map[slot.id] = result.data`; else →
  `console.warn('[load-forecasts] failed for slot ${slot.id} (${slot.name})', result.error)`.
  Note: pass `slot.name` only to the console, not to the UI — name is not secret here
  (the user sees it on the card), the log just helps debugging.
- Returns the map. Callers feed it straight into `renderHomeScreen`.

### `src/ui/footer.ts` (CC-BY 4.0 attribution — license requirement)

```ts
// Renders the legally required attribution footer (CC-BY 4.0 → CLAUDE.md › Notes).
// Single anchor: "Weather data by Open-Meteo" linking to https://open-meteo.com/.
// Uses textContent + a.href (no innerHTML, no API-sourced strings).
export function renderFooter(): HTMLElement;
```

Output shape:

```html
<footer class="app-footer">
  <a class="app-footer__link" href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">
    Weather data by Open-Meteo
  </a>
</footer>
```

### `src/vite-env.d.ts` (typed env)

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEFAULT_LOCATIONS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

### `.env.example` (committed, placeholder only — owners copy to `.env.local`)

```
# Default locations injected at build time.
# JSON array of { "name": string, "lat": number, "lon": number }.
# Copy this file to `.env.local` (gitignored) and fill in your real values.
# Never commit real coordinates — see CLAUDE.md > Configuration.
VITE_DEFAULT_LOCATIONS=[{"name":"Sample City","lat":0,"lon":0}]
```

### `src/main.ts` (wiring — replaces mock-based rendering)

Pseudocode:

```ts
import './ui/styles.css';
import { parseDefaultLocations } from './locations/default-locations';
import { loadForecasts } from './weather/load-forecasts';
import { renderHomeScreen } from './ui/home-screen';
import { renderFooter } from './ui/footer';

const app = document.getElementById('app');
if (app === null) {
  console.error('[main] #app root element not found in index.html');
} else {
  void bootstrap(app);
}

async function bootstrap(app: HTMLElement): Promise<void> {
  const parsed = parseDefaultLocations(import.meta.env.VITE_DEFAULT_LOCATIONS);
  if (!parsed.ok) {
    console.error(`[main] default locations unavailable: ${parsed.error.kind} — ${parsed.error.message}`);
    app.replaceChildren(renderEmptyState('No default locations configured.'), renderFooter());
    return;
  }
  const slots = parsed.data;
  // Paint a loading placeholder + footer immediately so the screen is never blank.
  app.replaceChildren(renderLoading(), renderFooter());
  const forecasts = await loadForecasts(slots);
  app.replaceChildren(renderHomeScreen(slots, forecasts), renderFooter());
}

function renderLoading(): HTMLElement {
  const el = document.createElement('p');
  el.className = 'app-loading';
  el.textContent = 'Loading weather…';
  return el;
}

function renderEmptyState(message: string): HTMLElement {
  const el = document.createElement('p');
  el.className = 'app-empty';
  el.textContent = message;
  return el;
}
```

Notes:

- The empty-state message is intentionally generic ("No default locations configured.")
  — diagnostic detail (env-var name, parse error) goes to the console for the dev,
  not the user. CLAUDE.md › Error handling: "Don't show raw error messages/stack
  traces in the UI; log to console, render a friendly state."
- `bootstrap` is `async` but wrapped in `void` at the call site — no top-level
  `await`. This keeps things readable and works in every Vite-targeted browser.
- Loading state is a single `<p>` — no spinner sprite. Keep the bundle tiny
  (CLAUDE.md › Tech Stack).

---

## Files to change

| File | Action | Purpose |
|------|--------|---------|
| `src/locations/default-locations.ts` | CREATE | Pure env-string → `LocationSlot[]` parser with typed errors. |
| `src/locations/default-locations.test.ts` | CREATE | Unit tests for every parse branch (missing / invalid JSON / wrong shape / valid). |
| `src/weather/load-forecasts.ts` | CREATE | `Promise.all` orchestrator over `fetchForecast`, builds `Record<id, ForecastResponse>` from successes only. |
| `src/weather/load-forecasts.test.ts` | CREATE | Unit tests: all-ok, mixed success/failure, all-fail, empty-slots input. |
| `src/ui/footer.ts` | CREATE | Renders the CC-BY 4.0 attribution `<footer>`. |
| `src/ui/footer.test.ts` | CREATE | Asserts the link text, `href`, `rel`, and that no API-sourced strings are inserted via innerHTML. |
| `src/vite-env.d.ts` | CREATE | Types `import.meta.env.VITE_DEFAULT_LOCATIONS` as `string \| undefined`. |
| `.env.example` | CREATE | Committed placeholder JSON (Sample City 0,0) — onboarding doc + AC2 requirement. |
| `src/main.ts` | UPDATE | Replace `MOCK_LOCATIONS` + `MOCK_FORECASTS` wiring with: parse env → render loading/empty → fetch in parallel → render home + footer. (Hotspot per CLAUDE.md — single-file edit, no concurrent work elsewhere.) |
| `src/ui/styles.css` | UPDATE | Add `.app-footer`, `.app-footer__link`, `.app-loading`, `.app-empty` rules. Keep additions minimal (hotspot). |
| `.agents/reports/real-default-locations-report.md` | CREATE (Task 8) | Implementation report mirroring `.agents/reports/open-meteo-client-report.md`. |

Counts: **9 CREATE**, **2 UPDATE**, **0 DELETE**.

**NOT touched** (deliberate):

- `src/locations/mock-locations.ts`, `src/weather/mock-forecasts.ts` — stay for tests (Technical Notes).
- `src/ui/home-screen.ts`, `src/ui/location-card.ts`, `src/ui/detail-view.ts`, etc. — already accept the data shape we'll feed them; per-slot fault isolation is already covered at `src/ui/home-screen.test.ts:85-100`.
- `src/weather/open-meteo-client.ts` — fully owns the network boundary, already on master.
- `vite.config.ts` — Phase 3 (STORY-006) hotspot, irrelevant here. PWA wiring is NOT in this story.
- `.gitignore` — `.env*` patterns already exclude what we need; `.env.example` is not matched.
- `index.html` — `#app` already mounts everything; the footer goes inside it.
- `package.json` — no new deps.

---

## Tasks

Execute in order. Each task is atomic and verifiable.

### Task 1: Add typed env declaration — `src/vite-env.d.ts`

- **File**: `src/vite-env.d.ts`
- **Action**: CREATE
- **Implement**: the snippet from "Public contracts › `src/vite-env.d.ts`" above.
- **Mirror**: standard Vite convention; nothing in the repo yet — establish it.
- **Validate**: `npx tsc --noEmit` passes; in `src/main.ts` (next tasks),
  `import.meta.env.VITE_DEFAULT_LOCATIONS` must be inferred as `string | undefined`.

### Task 2: Env parser — `src/locations/default-locations.ts`

- **File**: `src/locations/default-locations.ts`
- **Action**: CREATE
- **Implement**:
  - Export `ParseError`, `ParseResult<T>`, `parseDefaultLocations` per the contract above.
  - Branch order: missing → invalid-json → array check → per-entry shape validation → success.
  - Per-entry validation helper (private) returning a discriminated narrow result; aggregate at the array level.
  - Trim `name`; reject empty after trim with `invalid-shape: "entry N: name is empty"`.
  - Build `LocationSlot[]` with `id: \`default-${index}\``, `kind: 'default'`, `latitude: lat`, `longitude: lon`.
  - **Do NOT** import from `src/weather/` — define `ParseError`/`ParseResult` locally.
- **Mirror**: `src/weather/open-meteo-client.ts:143-171` (parser style — narrow `unknown`, return descriptive `parse`-kind errors).
- **Validate**: `npx tsc --noEmit` passes; `npm run lint` passes.

### Task 3: Parser tests — `src/locations/default-locations.test.ts`

- **File**: `src/locations/default-locations.test.ts`
- **Action**: CREATE
- **Implement** at minimum:
  1. `undefined` input → `ok: false`, `error.kind === 'missing'`.
  2. Empty string `''` → `ok: false`, `error.kind === 'missing'`.
  3. Whitespace-only `'   '` → `ok: false`, `error.kind === 'missing'`.
  4. Invalid JSON `'not json'` → `ok: false`, `error.kind === 'invalid-json'`, message mentions JSON.
  5. JSON but not an array (`'{"name":"x"}'`) → `ok: false`, `error.kind === 'invalid-shape'`, message mentions "array".
  6. Empty array `'[]'` → `ok: false`, `error.kind === 'invalid-shape'`, message mentions "no entries".
  7. Entry missing `name` → `ok: false`, `error.kind === 'invalid-shape'`, message contains `name` and the entry index.
  8. Entry with empty `name` (after trim) → `ok: false`, `error.kind === 'invalid-shape'`.
  9. Entry with non-number `lat` → `ok: false`, `error.kind === 'invalid-shape'`, message contains `lat`.
  10. Entry with out-of-range `lat` (e.g., 91) → `ok: false`, `error.kind === 'invalid-shape'`, message mentions range.
  11. Entry with out-of-range `lon` (e.g., -181) → `ok: false`.
  12. Entry with `NaN`/`Infinity` lat → `ok: false`.
  13. Valid 1-entry input → `ok: true`; check `data[0]` has `id: 'default-0'`, `name`, `latitude`, `longitude`, `kind: 'default'`.
  14. Valid 4-entry input → `ok: true`; ids are `default-0..default-3` in input order; trim is applied to names.
  15. Unknown extra fields on a valid entry are ignored (forward-compat).
- **Test setup**: `import { describe, expect, it } from 'vitest';` (no globals). Use `it.each` for the
  table-style invalid cases.
- **Mirror**: `src/weather/wmo-codes.test.ts:1-43` (no-globals + `it.each`); `src/weather/open-meteo-client.test.ts:200-238` (parser-style assertions).
- **Validate**: `npm test` — all green.

### Task 4: Forecast orchestrator — `src/weather/load-forecasts.ts`

- **File**: `src/weather/load-forecasts.ts`
- **Action**: CREATE
- **Implement** the contract from "Public contracts › `src/weather/load-forecasts.ts`" above.
  - Single `Promise.all` over `slots.map(...)`.
  - Iterate results paired with slots; per-slot guard for `noUncheckedIndexedAccess`
    (`const slot = slots[i]; if (slot === undefined) continue;` — should never trip
    but the type system needs it).
  - On `ok` → write to map; on `!ok` → `console.warn` with prefix `[load-forecasts]`, slot id+name, and the error object.
  - Empty input → resolves to `{}` immediately (no fetcher calls).
- **Mirror**: `src/weather/open-meteo-client.ts:73-87` (loop style, console.warn at boundary); `src/weather/open-meteo-client.ts:21-28` (`ClientDeps` shape for dependency injection — same idea here).
- **Validate**: `npx tsc --noEmit`; covered behaviorally by Task 5.

### Task 5: Orchestrator tests — `src/weather/load-forecasts.test.ts`

- **File**: `src/weather/load-forecasts.test.ts`
- **Action**: CREATE
- **Implement** at minimum:
  1. **Empty slots**: `loadForecasts([])` → `{}`; injected fetcher NEVER called.
  2. **All ok**: 3 slots, fetcher returns `{ ok: true, data: SAMPLE_FORECAST }` for every call →
     returned map has 3 entries keyed by slot.id; fetcher called 3 times with the right `(lat, lon)` pairs (use `vi.fn` and inspect `.mock.calls`).
  3. **Mixed**: 3 slots; fetcher returns `{ ok: false, error: { kind: 'server', status: 503, message: 'HTTP 503' } }` for the middle slot, `ok: true` for the others →
     map has 2 entries (slot-0 and slot-2), missing slot-1. `console.warn` was called once with a message including the slot id and "slot-1" name.
  4. **All fail**: fetcher returns `{ ok: false, error: { kind: 'network', message: 'down' } }` for every slot →
     map is `{}`; `console.warn` called once per slot; the function does NOT throw.
  5. **Parallelism**: fetcher records timestamps on entry; verify all 3 calls start before any has resolved
     (e.g., gate resolution on a single `Promise` shared across calls, then resolve it after asserting
     the fetcher was hit 3 times). This proves we're not awaiting in series.
  6. **Default fetcher**: when called without `deps`, the implementation pulls from
     `open-meteo-client.fetchForecast` — test by spying that path (NOT strictly necessary if
     the default is obvious from code; can be covered by a smoke assertion that
     `loadForecasts([])` resolves with `{}` even without injecting a fetcher). Keep it light.
- **Test setup**:
  - `import { afterEach, describe, expect, it, vi } from 'vitest';`
  - `afterEach(() => { vi.restoreAllMocks(); });` — covers `console.warn` spies.
  - Use the existing `src/weather/fixtures/open-meteo-forecast.fixture.ts` (`SAMPLE_FORECAST`) for valid forecast bodies — no need for a new fixture.
  - Spy on `console.warn` with `vi.spyOn(console, 'warn').mockImplementation(() => {})` so the test output isn't noisy AND so you can assert call counts.
- **Mirror**: `src/weather/open-meteo-client.test.ts:1-27, 77-128` for `vi.fn<FetchFn>` patterns and dep injection.
- **Validate**: `npm test` — all green.

### Task 6: Attribution footer — `src/ui/footer.ts` + `src/ui/footer.test.ts`

- **Files**: `src/ui/footer.ts`, `src/ui/footer.test.ts`
- **Action**: CREATE both
- **Implement** `renderFooter()` returning a `<footer class="app-footer">` containing a single
  `<a class="app-footer__link" href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">`
  with `textContent = 'Weather data by Open-Meteo'`. No innerHTML.
- **Tests**:
  1. Returns a `<footer>` with class `app-footer`.
  2. Contains exactly one `<a>` whose `textContent === 'Weather data by Open-Meteo'`.
  3. The `<a>` has `href === 'https://open-meteo.com/'`, `target === '_blank'`,
     `rel.includes('noopener')` and `rel.includes('noreferrer')`.
  4. No `<script>` or `innerHTML`-set content (asserting `footer.querySelector('script')` is null
     is enough — the test is mostly a regression guard against future innerHTML drift).
- **Mirror**: `src/ui/location-card.ts:7-56` (DOM-building style — `createElement` + `textContent`).
- **Validate**: `npm test` — all green; `npm run lint` — 0 errors.

### Task 7: Wire it all together — UPDATE `src/main.ts` (+ styles)

- **Files**: `src/main.ts`, `src/ui/styles.css`
- **Action**: UPDATE (both are hotspots — single-issue edits, no concurrent work).
- **Implement** in `src/main.ts`:
  - Replace the mock imports with `parseDefaultLocations`, `loadForecasts`, `renderFooter`.
  - The bootstrap flow per the pseudocode in "Public contracts › `src/main.ts`":
    1. Look up `#app`; bail with `console.error` if missing (preserve existing branch).
    2. `parseDefaultLocations(import.meta.env.VITE_DEFAULT_LOCATIONS)`.
    3. On parse failure: `console.error('[main] default locations unavailable: <kind> — <message>')`; render `renderEmptyState('No default locations configured.')` + `renderFooter()`.
    4. On parse success: render `renderLoading()` + `renderFooter()` immediately, then `await loadForecasts(slots)`, then replace with `renderHomeScreen(slots, forecasts)` + `renderFooter()`.
  - `renderLoading` / `renderEmptyState` are local helpers in `main.ts` (one-line `<p>` each — too small to deserve their own module; keep `main.ts` close to its "wiring only" charter).
  - **Remove** the `MOCK_LOCATIONS` and `MOCK_FORECASTS` imports — they stay in their own files for tests, but main.ts no longer uses them.
- **Implement** in `src/ui/styles.css` (append at the end, do not reflow existing rules):

  ```css
  .app-loading,
  .app-empty {
    margin: 24px 8px;
    text-align: center;
    color: var(--muted);
    font-size: 0.95rem;
  }

  .app-footer {
    margin-top: 24px;
    padding: 12px 4px 24px;
    text-align: center;
    font-size: 0.78rem;
    color: var(--muted);
  }

  .app-footer__link {
    color: var(--muted);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .app-footer__link:hover,
  .app-footer__link:focus-visible {
    color: var(--fg);
  }
  ```

- **Mirror**: existing `src/main.ts` (the `#app === null` branch is preserved verbatim).
- **Validate**: `npx tsc --noEmit`; `npm run lint`; `npm test` (the existing `home-screen.test.ts` still passes because we didn't touch `home-screen.ts`).

### Task 8: `.env.example` + full validation pass + report

- **Files**: `.env.example`, `.agents/reports/real-default-locations-report.md`
- **Action**: CREATE both
- **Implement**:
  1. `.env.example` per "Public contracts › `.env.example`" — exactly one line of JSON with a `Sample City` placeholder. Use ONLY `name: "Sample City"`, `lat: 0`, `lon: 0` — never a real city or coordinate.
  2. Run the full validation gauntlet from CLAUDE.md › Validation:

     ```bash
     npm run lint
     npx tsc --noEmit
     npm test
     npm run build
     ```

     All four exit 0. Note that `npm run build` will inline `import.meta.env.VITE_DEFAULT_LOCATIONS`:
     since `.env.local` is not present in the dev sandbox, the build will produce a bundle
     where the env value is `undefined`. That is EXPECTED — the runtime parser handles it
     (empty state + console.error). If you want a smoke build with non-empty env, prepend
     `VITE_DEFAULT_LOCATIONS='[{"name":"Sample","lat":0,"lon":0}]' npm run build` — optional,
     not required for green tests.
  3. Sanity: `grep -rE '(Lahti|Helsinki|Tallinn|Käsmu)' src/ .env.example` should return NOTHING.
     (CLAUDE.md › Configuration: real city names must NOT be committed.)
  4. Write `.agents/reports/real-default-locations-report.md` mirroring
     `.agents/reports/open-meteo-client-report.md` structure: Summary, Tasks Completed,
     Validation Evidence (paste output of the four commands), Acceptance Criteria Mapping
     (per AC below), Tests Written (count per file), Files Changed, Re-verification notes,
     Defer-and-record items.
- **Sandbox-blocked items** (record as defer-and-record per CLAUDE.md, do NOT treat as failures):
  - Real-device iPhone install + airplane-mode test (Phase 3 + STORY-010 own this).
  - Network call to live Open-Meteo from the sandbox — already covered by STORY-004's spike;
    we do not re-call here. The bundle still builds and runs in dev against the live API
    when the owner runs `npm run dev` locally with a real `.env.local`.
  - Lighthouse / Netlify deploy (STORY-006 / STORY-010 territory).
- **Validate**: every command above exits 0; the grep returns no matches; the report exists.

---

## Risks

| Risk | Mitigation |
|------|------------|
| Accidentally committing real city names or coordinates | `.env.example` uses `Sample City 0,0`; the grep in Task 8 fails the gate if any of the four CLAUDE.md cities slip into `src/` or `.env.example`. `.gitignore` already blocks `.env`, `.env.local`, `.env.*.local`. |
| `import.meta.env.VITE_DEFAULT_LOCATIONS` typed as `any` (default in `vite/client`) defeats strict mode | Task 1 adds `src/vite-env.d.ts` to narrow it to `string \| undefined`. |
| Parser silently accepting wrong-shape input (e.g., `lat` as a string the API would also reject) | Strict per-field type guards + range checks; tests for each failure branch (Task 3 cases 7–12). |
| One slot's failure cascading into the others | `Promise.all` over a function that NEVER throws (STORY-004 contract); missing entries → `renderDegradedCard` (`src/ui/home-screen.ts:21-22`, already tested at `home-screen.test.ts:85-100`). Task 5 case 3 re-verifies. |
| Empty env → blank screen (bad UX, looks broken) | Explicit `renderEmptyState('No default locations configured.')` + console.error; tested indirectly via Task 3 (parser returns clean error) and verifiable by hand running dev with no `.env.local`. |
| Initial paint blank while the first fetch is in flight | `renderLoading()` placeholder rendered immediately, replaced on `await loadForecasts` resolution. STORY-007 will replace this with cached data (stale-while-revalidate) — DO NOT pre-empt that work here. |
| Race / partial render if the user clicks a card during the loading→home replace | `replaceChildren` is atomic at the DOM level; no half-rendered state. Click handlers are wired in `renderHomeScreen` after replacement — no events lost (there was nothing to click on the loading screen). |
| Footer flashing in/out across renders | Footer is rendered as a sibling of the main view on every render — present in loading, empty, and full home states. Stable across replaces. |
| `URL`/`globalThis.fetch` mocked in tests bleeding across files | `afterEach(() => vi.restoreAllMocks())` in both new `*.test.ts` files; `load-forecasts.test.ts` injects a fake fetcher rather than spying on global fetch (the client owns `globalThis.fetch`). |
| `console.warn` spam in CI test output | Spy + `mockImplementation(() => {})` in Task 5 setup (already in the test plan). |
| Vite dev-mode reads env at request time, but `npm run build` inlines at build time — devs sometimes confused | Documented in `.env.example`; the parser handles both paths identically (string-in, result-out). |
| `noUncheckedIndexedAccess` makes `slots[i]` `T \| undefined` in the loop | Single guarded read per the contract; pattern matches `src/weather/open-meteo-client.ts:80` (`if (delay !== undefined) ...`). |
| Adding the footer twice (e.g., once in index.html and once via TS) | Footer is rendered ONLY by `renderFooter()` in TS; `index.html` is untouched. Tests assert exactly one `.app-footer` after `renderHomeScreen + renderFooter` are mounted (covered indirectly — no explicit count test needed). |
| Re-introducing mocks in `main.ts` via stale imports | Task 7 explicitly removes the mock imports; lint's `unused import` rule catches stragglers. |
| CSS hotspot conflict with another concurrent story | Per CLAUDE.md › Orchestration "max parallel 3 + hotspot rule": no other story runs concurrently that touches `styles.css` (this is enforced by the orchestrator, not us). Our additions are append-only and self-contained. |

---

## Validation

Run before declaring done — exact commands from CLAUDE.md › Commands / Validation:

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
```

All four exit 0.

Additional checks (Task 8):

```bash
# Real city names must never appear in committed code or the env template.
grep -rE '(Lahti|Helsinki|Tallinn|Käsmu)' src/ .env.example
# Expect: no matches (exit 1 from grep — that's the green state).
```

Deferred (CLAUDE.md › Sandbox-blocked checks — recorded, NOT failed):

- Real-iPhone install + airplane-mode end-to-end (STORY-006 / STORY-007 / STORY-010 own this).
- Live Open-Meteo call from the sandbox — already spike-verified 2026-06-07 (PRD).
- Lighthouse / Netlify deploy — STORY-010.

---

## Acceptance criteria

Issue #5 ACs → tasks/tests mapping (every AC maps to ≥ 1 task or test):

- [ ] **AC1** — Given `VITE_DEFAULT_LOCATIONS` in `.env.local` (JSON: name, lat, lon), opening the app shows real Open-Meteo cards/detail for those locations instead of mocks.
      → Task 2 (parser), Task 4 (orchestrator), Task 7 (main.ts wiring). Test coverage: Task 3 cases 13–14 (parser produces correct `LocationSlot[]`), Task 5 case 2 (orchestrator fetches all and builds the map), and the existing `src/ui/home-screen.test.ts` already proves cards render from `(slots, forecasts)`.

- [ ] **AC2** — Repository contains no default-location coordinates or city names; `.env.example` has a fictional placeholder.
      → Task 8 (`.env.example` with `Sample City 0,0`) + Task 8's `grep` gate. `.gitignore` already excludes `.env.local`.

- [ ] **AC3** — Invalid or missing `VITE_DEFAULT_LOCATIONS` → clear console error + empty UI state (no crash).
      → Task 2 (typed errors), Task 7 (`renderEmptyState` + `console.error('[main] default locations unavailable: <kind> — <message>')`). Test coverage: Task 3 cases 1–12 (every invalid branch returns a typed error with a message).

- [ ] **AC4** — Footer shows the "Weather data by Open-Meteo" attribution link (CC-BY 4.0).
      → Task 6 (`renderFooter`), Task 7 (footer rendered in every state: loading, empty, full). Test coverage: Task 6's tests (link text, `href`, `rel`).

- [ ] **AC5** — One location's API failure does not break the others; the broken one shows an error state.
      → Task 4 (orchestrator omits failed slots from the map), Task 5 case 3 (mixed success/failure assertion). Existing `src/ui/home-screen.test.ts:85-100` already verifies the degraded-card path; no UI changes needed.

Process gates:

- [ ] All tasks completed
- [ ] `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build` pass
- [ ] No new runtime dependencies (`package.json` `dependencies` stays empty)
- [ ] No `any` anywhere in new code; lint = 0 errors, 0 warnings
- [ ] No `innerHTML`; all DOM text via `textContent`
- [ ] No real default-location names or coordinates in `src/`, `index.html`, or `.env.example` (grep gate in Task 8)
- [ ] Mocks (`mock-locations.ts`, `mock-forecasts.ts`) preserved on disk, unreferenced by `main.ts`, still imported by tests
- [ ] `src/locations/` does NOT import from `src/weather/` (layering)
- [ ] Footer is present in loading, empty, AND full home states
- [ ] Sandbox-blocked checks (real-iPhone, live API call, Lighthouse, deploy) recorded as defer-and-record — NOT treated as failures
- [ ] Issue #5 acceptance criteria → tasks/tests mapping above is complete
