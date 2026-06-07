# Plan: Real Default-Location Data from Env (STORY-005)

## Summary

Swap the Phase-1 hard-coded mocks for real Open-Meteo forecasts keyed by the four
default locations declared in `VITE_DEFAULT_LOCATIONS`. The env variable holds a
JSON array of `{ name, lat, lon }` objects, injected at build time by Vite. The
list is parsed and validated in `src/locations/`, then `src/main.ts` orchestrates
the per-slot fetch in parallel using the STORY-004 client. Mock data stays
available for tests; the production path no longer touches it. A `.env.example`
file with fictional placeholder coordinates ships with the repo so a new clone
documents the contract without leaking the owner's real list. The Open-Meteo
CC-BY 4.0 attribution footer (already added in STORY-002) is verified.

## User Story

As the single user of this PWA,
I want the app to show real Open-Meteo data for my four default locations
(supplied via env, never committed),
So that the app is actually useful and my home coordinates don't leak into git.

## Metadata

| Field | Value |
|-------|-------|
| Type | NEW_CAPABILITY (integration) |
| Complexity | MEDIUM |
| Systems Affected | `src/locations/`, `src/main.ts`, root config (`.env.example`, `src/vite-env.d.ts`) |
| GitHub Issue | #5 |

---

## Patterns to Follow

### Naming (kebab-case files, PascalCase types, camelCase fns)
```
// SOURCE: src/locations/types.ts:9-17
export interface Location {
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
}

export type LocationSlot =
  | { readonly kind: 'default'; readonly location: Location }
  | { readonly kind: 'custom'; readonly location: Location | null };
```

### Domain — no I/O, console-log at boundaries (CLAUDE.md › Architecture)
```
// SOURCE: src/weather/open-meteo-client.ts:104-118
const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
// ...
// eslint-disable-next-line no-console
console.info(`${ctx} attempt=${attempt}/${MAX_ATTEMPTS} fetch start`);
```

### Typed Result union (graceful degradation)
```
// SOURCE: src/weather/types.ts (Result/ForecastError)
export type Result<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: ForecastError };
```

### Per-slot isolation with parallel fetch (CLAUDE.md › Fault Tolerance)
```
// Pattern (new): Promise.allSettled for parallel + isolation
const results = await Promise.allSettled(
  locations.map((loc) => fetchForecast({ lat: loc.lat, lon: loc.lon })),
);
```

### Tests (co-located *.test.ts; mock fetch via injection)
```
// SOURCE: src/weather/open-meteo-client.test.ts (whole file is the pattern)
const fetchImpl = vi.fn(...) as unknown as typeof fetch;
const result = await fetchForecast(COORDS, { fetchImpl });
```

### UI tolerates `forecast: null` (already)
```
// SOURCE: src/ui/card.ts:49-57 — "Unavailable" state
if (forecast === null) {
  const status = document.createElement('span');
  status.className = 'card-status';
  status.textContent = 'Unavailable';
  // ...
}
```

---

## Files to Change

| File | Action | Purpose |
|------|--------|---------|
| `.env.example` | CREATE | Document `VITE_DEFAULT_LOCATIONS` contract with fictional placeholder coords (no real data — security). |
| `src/vite-env.d.ts` | CREATE | Augment `ImportMetaEnv` so `import.meta.env.VITE_DEFAULT_LOCATIONS` is typed `string \| undefined`. |
| `src/locations/env.ts` | CREATE | Pure parser + validator: `parseDefaultLocations(raw: string \| undefined): Result<readonly Location[], EnvParseError>`. JSON shape: `[{ name, lat, lon }, ...]`. Validates each entry (string name, finite lat in [-90,90], finite lon in [-180,180]). |
| `src/locations/env.test.ts` | CREATE | Unit tests covering: valid input, missing var, malformed JSON, missing fields, out-of-range coords, empty array, non-array root. |
| `src/locations/index.ts` | CREATE | Barrel exporting `Location`, `LocationSlot`, `parseDefaultLocations`, etc. (Optional convenience; not strictly required.) |
| `src/main.ts` | UPDATE | Replace `MOCK_DEFAULT_LOCATIONS` + `pickForecastForName` with: (a) parse `import.meta.env.VITE_DEFAULT_LOCATIONS`, (b) `Promise.allSettled(fetchForecast(...))` per location, (c) build `AppItem[]` mapping each result → `forecast \| null`, (d) render. On parse failure → empty UI + console.error. |
| `src/main.test.ts` | CREATE | Integration-style test that drives `bootstrap()` with stubbed env + injected `fetchImpl` and asserts the DOM renders 4 cards including a "mixed success/failure" run. |
| `src/locations/defaults.ts` | KEEP | Mock list retained — referenced only by tests now (per Technical Notes). |
| `src/weather/mocks.ts` | KEEP | Same: tests-only. |

Notes:
- `src/main.ts` becomes the "wiring only" entry per CLAUDE.md. The bootstrap
  logic gets exported as a function so the test can drive it.
- Per CLAUDE.md › Configuration: **never commit real coordinates**. The
  `.env.example` uses obviously fictional placeholders (e.g. `(0, 0)` or named
  `City One`/`City Two`).
- Footer attribution is verified, not re-added — already present in
  `src/ui/app.ts:69-82`.

---

## Tasks

Execute in order. Each task is atomic and verifiable.

### Task 1: Create `.env.example` with fictional placeholder

- **File**: `.env.example`
- **Action**: CREATE
- **Implement**: A single-line `VITE_DEFAULT_LOCATIONS` containing a 4-entry
  JSON array with fictional, obviously-not-real names and `(0, 0)` coordinates.
  Add a comment block explaining the format and that `.env.local` (gitignored)
  holds the real list.
- **Validate**: `git status` — file appears as untracked; `npx tsc --noEmit`
  still passes.

### Task 2: Declare `ImportMetaEnv` typing

- **File**: `src/vite-env.d.ts`
- **Action**: CREATE
- **Implement**: Triple-slash `vite/client` reference + `ImportMetaEnv`
  interface declaring `readonly VITE_DEFAULT_LOCATIONS?: string;`.
- **Mirror**: Vite docs convention (already implied by `"types": ["vite/client"]`
  in tsconfig.json).
- **Validate**: `npx tsc --noEmit` — exit 0.

### Task 3: Create env parser + validator

- **File**: `src/locations/env.ts`
- **Action**: CREATE
- **Implement**:
  - `EnvParseError` union: `'missing' | 'malformed-json' | 'invalid-shape' | 'invalid-entry'`.
  - Return shape: `{ ok: true; locations: readonly Location[] } | { ok: false; error: EnvParseError; message: string }`.
  - Steps: trim raw → if empty/undefined → `'missing'`; `JSON.parse` →
    `'malformed-json'` on throw; assert array root → `'invalid-shape'`;
    per-element: object, `name` non-empty string, `lat`/`lon` finite numbers
    in valid range → `'invalid-entry'` with index + reason in `message`.
  - Pure function — no `console` (caller logs).
- **Mirror**: `src/weather/open-meteo-client.ts:226-242` (`validateCoordinates`)
  and `:280-376` (boundary narrowing style, isPlainObject / isFiniteNumberProp).
- **Validate**: `npx tsc --noEmit`.

### Task 4: Tests for env parser

- **File**: `src/locations/env.test.ts`
- **Action**: CREATE
- **Implement**: Vitest cases — happy path (4-entry valid array), missing
  (undefined + ""), malformed JSON, non-array root, missing `name`, `lat` NaN,
  `lat` out of range, `lon` out of range, name empty string, non-string name,
  empty array (allowed: `ok: true, locations: []` — UI handles gracefully).
  Assert error `kind`s and that `message` is a short helpful string.
- **Mirror**: `src/weather/wmo.test.ts` (table-driven style allowed) or
  `src/weather/open-meteo-client.test.ts:* parse` cases.
- **Validate**: `npm test` — all new cases pass.

### Task 5: Wire `src/main.ts` to real data

- **File**: `src/main.ts`
- **Action**: UPDATE
- **Implement**:
  - Extract a `bootstrap(root: HTMLElement, opts?: { rawEnv?: string; fetchImpl?: typeof fetch }): Promise<void>` function (exported) that:
    1. Parses `opts.rawEnv ?? import.meta.env.VITE_DEFAULT_LOCATIONS`.
    2. On parse error: `console.error('[main] VITE_DEFAULT_LOCATIONS: <kind>: <message>')`, render the empty list (renderApp with `[]`) — UI must not blank-screen.
    3. On success: `Promise.allSettled(locations.map(loc => fetchForecast({ lat: loc.lat, lon: loc.lon }, { fetchImpl: opts.fetchImpl })))`.
    4. Map each result → `AppItem`: forecast value on `ok: true`; `null` on `ok: false` (already-typed Unavailable state in card.ts).
    5. Log per-location boundary lines per CLAUDE.md › Observability with the location name as context.
    6. `renderApp(root, items)`.
  - Module top-level: keep the same `document.getElementById('app')` guard,
    then `void bootstrap(root)`.
  - Remove imports of `MOCK_DEFAULT_LOCATIONS` and `pickForecastForName` from
    the production path.
- **Mirror**: `src/main.ts:1-31` (original wiring style), keeping it minimal.
- **Validate**: `npx tsc --noEmit`, `npm test`, `npm run lint`.

### Task 6: Integration test for main.ts wiring

- **File**: `src/main.test.ts`
- **Action**: CREATE
- **Implement**: Drive `bootstrap()` with:
  1. A valid 2-entry env JSON, a `fetchImpl` that resolves one 200 and one 500.
     Assert two cards render — one with weather metadata, one with
     "Unavailable".
  2. Undefined env → assert console.error called, 0 cards.
  3. Empty array env → 0 cards, no fetch calls.
- **Mirror**: `src/ui/app.test.ts` (jsdom-based DOM assertions).
- **Validate**: `npm test`.

### Task 7: Verify attribution + final lint pass

- **File**: `src/ui/app.ts:69-82` (read-only verification)
- **Action**: VERIFY
- **Implement**: Confirm the footer remains and the link text is exactly
  "Weather data by Open-Meteo" with `href="https://open-meteo.com/"`. (No
  code change expected — already present from STORY-002.)
- **Validate**: `npm test` includes the existing `app.test.ts` assertions on
  the footer link — exit 0.

---

## Validation

```bash
# CLAUDE.md › Validation: run all three before committing.
npm run lint
npx tsc --noEmit
npm test
```

### End-to-end smoke (sandbox-runnable)

- [ ] `npm run build` completes (production bundle builds).
- [ ] `npm test` includes the new `main.test.ts` + `env.test.ts` cases.
- [ ] `git grep -nE '60\\.98|25\\.66|59\\.44|24\\.75|59\\.6|25\\.92'` returns
      ONLY hits inside `src/weather/__fixtures__/`, `src/weather/mocks.ts`,
      `src/locations/defaults.ts`, and tests — i.e. nothing in the
      production path (`src/main.ts`, `.env.example`). The dependency chain
      doc trail explicitly keeps the mocks for tests, so they're allowed to
      reference public city coordinates; the **production path** must not.
- [ ] `.env.example` exists at the repo root and contains an obviously
      fictional placeholder; `.env.local` is NOT committed.

### Environment & Verification matrix

| Verification | Runs in env? | If blocked: where/when verified |
|--------------|--------------|---------------------------------|
| `npm run lint` | yes | n/a |
| `npx tsc --noEmit` | yes | n/a |
| `npm test` | yes | n/a |
| `npm run build` | yes | n/a |
| Live Open-Meteo fetch against the real endpoint | **no** (sandbox) | Owner runs `npm run preview` locally; deploy gate on Netlify/Cloudflare Pages (CH-21). Test path already exercises retry + timeout via injected `fetchImpl`. |
| iPhone PWA install / airplane-mode offline | no | Owner — see CLAUDE.md › Sandbox-blocked checks. STORY-005 does not add offline cache (STORY-006/007 own that); this is a freshness-on-open story. |

---

## Acceptance Criteria

- [ ] All tasks completed.
- [ ] `npx tsc --noEmit` passes (exit 0).
- [ ] `npm run lint` passes (exit 0).
- [ ] `npm test` passes — including new `env.test.ts` and `main.test.ts`.
- [ ] No real coordinates committed in production path (CLAUDE.md › Configuration).
- [ ] Mocks remain in place for tests only (per Technical Notes in #5).
- [ ] Open-Meteo CC-BY 4.0 attribution footer present (verified by existing
      `app.test.ts`).
- [ ] One failing location does not break rendering of the others (verified by
      `main.test.ts` mixed run).
- [ ] Invalid/missing env → console.error + empty UI, not crash.
- [ ] Environment-blocked verifications recorded (live API + iPhone PWA →
      owner / CH-21 gate).
