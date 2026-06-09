# Implementation Report

**Plan**: `.agents/plans/offline-cache-swr.plan.md`
**Branch**: `claude/beautiful-keller-i9r0ta`
**Status**: COMPLETE
**GitHub Issue**: #7 (STORY-007 — Offline data cache + stale-while-revalidate)

## Summary

STORY-007 makes every app open render last-known forecasts instantly
(including offline) with an honest "Updated N min/h/d ago" stamp per
card, then quietly revalidates from Open-Meteo and swaps in the fresh
data:

- **`src/storage/staleness.ts`** — pure helpers: `formatLastUpdated`
  (Just now / N min ago / N h ago / N d ago), `isStale`, `anyStale`,
  plus `REVALIDATE_THRESHOLD_MS = 30 * 60 * 1000` (from PRD). No I/O,
  no side effects.
- **`src/storage/forecast-cache.ts`** — typed cache: `read()` /
  `writeSlot()` / `removeSlot()` / `clear()`. Backed by `localStorage`
  via the injectable `CacheStore` interface (one-line swap to
  IndexedDB later — STORY-009). Storage shape:
  `{ version: 1, slots: { <slot.id>: { forecast, fetchedAt } } }`.
  Discriminated-union `ReadResult` / `WriteResult` (no `any`, never
  throws). Quota errors classified to `{ kind: 'quota' }` and warn-logged;
  malformed entries are dropped per-slot with `[cache] dropping malformed
  entry <slotId>`. Shape narrowing is inlined (mirrors
  `open-meteo-client.ts:143-296`) so storage does NOT depend on the
  network client.
- **`src/storage/revalidate.ts`** — SWR orchestrator: `Promise.all`s
  every slot's fetch (per-slot isolation), writes successes back to the
  cache, returns `{ snapshot, refreshed, failed }`. Per-slot failure
  never affects others and never throws. Defensive try/catch in case a
  fetcher returns a rejected promise. Snapshot merges the post-cycle
  cache read with an in-memory delta — so callers see fresh data even
  when the disk write returned `{ kind: 'quota' }` or `{ kind: 'unsupported' }`.
- **`src/ui/location-card.ts`** — `renderLocationCard` and
  `renderDegradedCard` accept an optional `stamp?: string` arg and
  render it as `<span class="location-card__updated">` via `textContent`
  (XSS-safe). Existing callers without the arg keep working.
- **`src/ui/home-screen.ts`** — accepts optional `lastUpdated` map +
  `nowMs`; computes the stamp per slot via `formatLastUpdated` and
  threads it into each card.
- **`src/ui/styles.css`** — appended `.location-card__updated`
  (12 px muted text, 4 px top margin). Hotspot-rule: append-only,
  no edits to existing rules.
- **`src/main.ts`** — new bootstrap: read cache → paint immediately
  (or show "Loading…" when the cache is empty) → `await revalidate(…)`
  → swap in the merged snapshot → register a `visibilitychange`
  listener gated on `visibilityState === 'visible'` + `navigator.onLine`
  + `anyStale(now, snapshot, slotIds, 30 min)` + an in-flight
  `revalidating` boolean.
- **`src/weather/types.ts`** — `FetchError` and `FetchResult<T>`
  relocated here (their natural domain-types home);
  `open-meteo-client.ts` re-exports them for back-compat. This keeps
  `src/storage/revalidate.ts` strictly within the allowed import set
  (storage → `weather/types.ts` only — no dependency on the network
  client).

Workbox runtime caching of Open-Meteo responses is **deliberately NOT
used** — the HTTP cache hides the per-slot freshness signal we need to
surface. We cache the parsed `ForecastResponse` at the application
layer, where `fetchedAt` is a first-class field.

## Tasks Completed

| # | Task | File(s) | Status |
|---|------|---------|--------|
| 1 | Staleness module — formatter, threshold, `anyStale` | `src/storage/staleness.ts` | ✅ |
| 2 | Staleness tests (22 cases: boundaries, clock skew, NaN, anyStale matrix) | `src/storage/staleness.test.ts` | ✅ |
| 3 | Forecast cache module — typed, injectable, never-throws | `src/storage/forecast-cache.ts` | ✅ |
| 4 | Forecast cache tests (15 cases: unsupported/absent/corrupt/wrong-version, round-trip, merge, overwrite, remove, clear, quota, unknown, default jsdom path) | `src/storage/forecast-cache.test.ts` | ✅ |
| 5 | SWR orchestrator — parallel fetch + per-slot writes + merged snapshot | `src/storage/revalidate.ts` | ✅ |
| 6 | Revalidate tests (8 cases: empty/all-ok/partial/all-fail/quota-non-fatal/unsupported-cache/parallelism/never-throws) | `src/storage/revalidate.test.ts` | ✅ |
| 7 | `renderLocationCard` + `renderDegradedCard` accept optional `stamp` | `src/ui/location-card.ts` | ✅ |
| 8 | Card tests: stamp-on/off + degraded-with-stamp + XSS guard | `src/ui/location-card.test.ts` | ✅ |
| 9 | `renderHomeScreen` accepts `lastUpdated` + `nowMs`, threads stamps | `src/ui/home-screen.ts` | ✅ |
| 10 | Home-screen tests: stamps everywhere / nowhere / on degraded with cache | `src/ui/home-screen.test.ts` | ✅ |
| 11 | Append `.location-card__updated` CSS rule | `src/ui/styles.css` | ✅ |
| 12 | Wire SWR + visibilitychange in `main.ts` (drops `loadForecasts` import) | `src/main.ts` | ✅ |
| 13 | E2E verification + this report | `.agents/reports/offline-cache-swr-report.md`, screenshots | ✅ |

## Validation Evidence

| Check | Command | Result |
|-------|---------|--------|
| Lint | `npm run lint` | exit 0; 0 errors, 0 warnings |
| Type check | `npx tsc --noEmit` | exit 0 |
| Tests | `npm test` (Vitest) | exit 0; **173 passed** (54 new + 119 prior), 0 failed |
| Build | `npm run build` (`tsc --noEmit && vite build`) | exit 0; precache 16 entries / 83.44 KiB; `dist/sw.js` + `dist/manifest.webmanifest` + CSS containing `.location-card__updated` |

```
 RUN  v4.1.8 /home/user/weather-app
 Test Files  15 passed (15)
      Tests  173 passed (173)
   Duration  ~4.3s

vite v7.3.5 building client environment for production...
✓ 22 modules transformed.
dist/manifest.webmanifest                         0.50 kB
dist/index.html                                   0.95 kB │ gzip: 0.45 kB
dist/assets/index-C0z6_f0G.css                    3.94 kB │ gzip: 1.35 kB
dist/assets/workbox-window.prod.es5-BBnX5xw4.js   5.75 kB │ gzip: 2.36 kB
dist/assets/index-C0MogDtC.js                    30.24 kB │ gzip: 8.78 kB
✓ built in 267ms
PWA v1.3.0 — precache 16 entries (83.44 KiB)
```

Layering gate (storage must not import from `ui/`, `sw/`, or `weather/open-meteo-client`):

```
$ grep -nE "from '\.\./(ui|sw|weather/open-meteo)" src/storage/*.ts
(no matches; exit 1 — green)
```

CSS bundle contains the new stamp selector:

```
$ grep -c 'location-card__updated' dist/assets/index-*.css
1
```

City-name regression gate (STORY-005):

```
$ grep -rE '(Lahti|Helsinki|Tallinn|Käsmu)' \
    src/storage src/ui src/main.ts src/vite-env.d.ts .env.example
(no matches; exit 1 — green)
```

## Acceptance Criteria Mapping

| # | Acceptance criterion (verbatim) | Evidence |
|---|---|---|
| AC1 | Given previously loaded data, when I open the app offline (airplane mode), then I see all slots with the last data and the stamp "Updated N h ago" — screen never blank | Implementation: `src/main.ts:42-52` (read cache before any network), `src/ui/home-screen.ts:9-28` (thread stamps), `src/storage/staleness.ts:13-29` (`formatLastUpdated`). Unit tests: `staleness.test.ts` cases on formatter; `home-screen.test.ts` `renders "Updated …" stamps on every card when lastUpdated is provided`. **E2E**: seeded cache, set browser offline, reloaded → 2 cards with `Updated 5 min ago` rendered. Screenshot: `.agents/reports/screenshots/offline-cache-swr-offline-cached.png`. **DEFERRED — owner** (real iPhone airplane mode test). |
| AC2 | Given an online start, when the app starts, then the cache renders instantly (< 2 s), parallel requests go out for every slot, the UI and cache silently update after the response, the stamp resets | Implementation: `src/main.ts:46-56` (paint-from-cache BEFORE `await revalidate(...)`; second `render(...)` after the cycle resolves), `src/storage/revalidate.ts:34-66` (`Promise.all` over slots, per-slot writeSlot on success). Unit tests: `revalidate.test.ts` cases `on full success: writes every slot, returns merged snapshot with the injected now()` and `issues every fetch concurrently`. **E2E**: console log `[revalidate] start 2` followed by `[revalidate] done` for every reload, cards rendered from seeded cache instantly. Screenshot: `.agents/reports/screenshots/offline-cache-swr-online-fresh.png`. |
| AC3 | Given the app is minimised and re-opened (`visibilitychange`), when data is older than 30 min and a network is present, then a background refresh is triggered | Implementation: `src/main.ts:60-78` (`document.addEventListener('visibilitychange', …)` + `anyStale(Date.now(), snapshot, slotIds, REVALIDATE_THRESHOLD_MS)` + `navigator.onLine` gate + in-flight `revalidating` boolean). Unit tests: `staleness.test.ts` cases on `anyStale` (missing slot forces true, stale slot returns true) and `isStale` at exact threshold. **E2E**: seeded `fetchedAt = now - 35 min` on disk, reloaded so the in-memory snapshot is 35-min-aged, dispatched `visibilitychange` (hidden → visible), captured `[revalidate] start 2` in console + 4+ requests to `api.open-meteo.com` in the network panel right after the event. Screenshot: `.agents/reports/screenshots/offline-cache-swr-after-revalidate.png`. |
| AC4 | Given an update failure (offline / 5xx after retries), when I open the app, then I continue to see the cache with the stamp and no error overlay | Implementation: `src/storage/revalidate.ts:54-66` (per-slot failure: `failed.push(slot.id)` — cache untouched), `src/main.ts:54-58` (render uses the same merged snapshot whether refresh succeeded or not — no error branch in the UI). Unit tests: `revalidate.test.ts` cases `on partial failure: keeps existing cache for the failed slot` and `on all-fail: never touches the cache, snapshot equals the pre-cycle read`. **E2E**: sandbox blocks Open-Meteo; every revalidate cycle observed in console returned `[revalidate] done {refreshed: 0, failed: 2}`, yet cards continued to render with their existing stamps. No error-state DOM was created (verified via DOM inspection — no error overlay class exists in the codebase). |
| AC5 | Given the staleness and cache merge logic, when I run `npm test`, then age calculation, stamp format, and cache update are covered by unit tests | `staleness.test.ts` 22 cases (formatter table, boundaries, clock skew, NaN, isStale at threshold, anyStale matrix); `forecast-cache.test.ts` 15 cases (unsupported / absent / corrupt / wrong-version / malformed-entry drop / round-trip / merge / overwrite / remove / remove-last / clear / quota / unknown / default jsdom path); `revalidate.test.ts` 8 cases (empty / all-ok / partial / all-fail / quota-non-fatal / unsupported-cache / parallelism / never-throws). All green: `npm test` → 173 passed (54 new + 119 prior). |

## Independent Verification

**Verdict**: CONFIRMED (round 1 of max 3)

Verifier re-ran the full suite (`npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`) — all exit 0; 15 test files, 173 tests passed; vite build + workbox `generateSW` clean. Re-checked the layering gates (`grep -nE "from '\.\./(ui|sw)" src/storage/*.ts` and `grep -n "from '\.\./weather/open-meteo-client" src/storage/*.ts`) — both empty. City-name regression grep empty. CSS bundle contains `location-card__updated` (count = 1). `FetchResult`/`FetchError` relocation to `src/weather/types.ts:64-73` confirmed, with `revalidate.ts` importing from `weather/types`, not from the network client.

AC mapping re-verified by direct code inspection:

- AC1: `src/main.ts:49` paints from cache BEFORE `await revalidate(...)` at `src/main.ts:53`. `src/ui/home-screen.ts:24` type-guards `fetchedAt` with `Number.isFinite` before calling `formatLastUpdated` — no NaN/undefined leak.
- AC2: `src/storage/revalidate.ts:44-60` uses `Promise.all` for parallel fetches; gate-based test `issues every fetch concurrently` confirms it.
- AC3: `src/main.ts:62-82` registers `visibilitychange` with all four gates (`visibilityState === 'visible'`, in-flight flag, `navigator.onLine`, `anyStale`).
- AC4: `src/storage/revalidate.ts:73-75` only pushes to `failed` on fetch failure; `cache.writeSlot` never called for failed slots. Tests `on partial failure` and `on all-fail` confirm.
- AC5: staleness 22, forecast-cache 15+, revalidate 8 (including a defense-in-depth `never throws` case).

UNVERIFIABLE items (sandbox-blocked, per CLAUDE.md — defer-and-record):

- Real iPhone airplane-mode offline test (AC1 fully).
- iOS 7-day storage eviction probe (open PRD question).
- Real iPhone `visibilitychange` lifecycle (iOS differs subtly from Chromium DevTools).
- Verifier flagged that the three screenshots are all ~20 KB. Reason: Open-Meteo is blocked from this sandbox by the network policy, so all three captures (online-fresh / offline-cached / after-revalidate) show the same DOM state — 2 cards with `Updated 5 min ago` stamps rendered from the seeded cache, never refreshed by a successful fetch. The captures are real, distinct browser screenshots — they just happen to render identically, which is itself evidence of AC4 (failure preserves the cache + stamp).

## E2E Evidence

| Test | Action performed | Observed result |
|------|------------------|-----------------|
| Sandbox preview server | `VITE_DEFAULT_LOCATIONS='[{"name":"Sample-A","lat":60,"lon":24},{"name":"Sample-B","lat":59.4,"lon":24.7}]' npm run build && npm run preview -- --port 5173` | `dist/` emitted; preview server returns HTTP 200; `/manifest.webmanifest` parses with `name=Weather`. |
| First load — Open-Meteo blocked from sandbox | `agent-browser open http://127.0.0.1:5173/` | 2 degraded cards rendered (cache empty + fetches fail); console: `[revalidate] start 2` → `[open-meteo] all 4 attempts failed` × 2 → `[revalidate] done {refreshed: 0, failed: 2}`. No error overlay. AC4 evidence. |
| Seed cache + reload | Set `localStorage['weather-cache.v1']` to a valid 5-min-old doc with 2 slots, reload | 2 non-degraded cards, each with `<span class="location-card__updated">Updated 5 min ago</span>`. Screenshot: `offline-cache-swr-online-fresh.png`. AC1 / AC2 evidence. |
| Cache shape gate | `localStorage.getItem('weather-cache.v1')` parsed in page | `{ version: 1, slots: { default-0: …, default-1: … } }`. Top-level keys match plan's storage shape. |
| Offline shell + cached data | `agent-browser set offline on` + reload | 2 cards still rendered with `Updated 5 min ago` stamps. Screenshot: `offline-cache-swr-offline-cached.png`. AC1 evidence. |
| Visibility-stale path | Seeded `fetchedAt = now - 35 min` on disk, reloaded so the in-memory snapshot started 35-min stale, cleared console + network logs, dispatched `visibilitychange` (hidden → visible) | Console: `[info] [revalidate] start 2` immediately after the visibility event. Network panel: 4+ GET requests to `https://api.open-meteo.com/v1/forecast?…` right after the event. Cycle resolved with `[revalidate] done {refreshed: 0, failed: 2}` (Open-Meteo blocked from sandbox). Screenshot: `offline-cache-swr-after-revalidate.png`. AC3 evidence. |

## Files Changed

| File | Action | Lines |
|------|--------|-------|
| `src/storage/staleness.ts` | CREATE | +57 |
| `src/storage/staleness.test.ts` | CREATE | +137 |
| `src/storage/forecast-cache.ts` | CREATE | +273 |
| `src/storage/forecast-cache.test.ts` | CREATE | +215 |
| `src/storage/revalidate.ts` | CREATE | +83 |
| `src/storage/revalidate.test.ts` | CREATE | +200 |
| `src/ui/location-card.ts` | UPDATE | +18 / -2 |
| `src/ui/location-card.test.ts` | UPDATE | +40 / -1 |
| `src/ui/home-screen.ts` | UPDATE | +12 / -3 |
| `src/ui/home-screen.test.ts` | UPDATE | +42 / 0 |
| `src/ui/styles.css` | UPDATE | +6 / 0 |
| `src/main.ts` | UPDATE | +75 / -16 |
| `src/weather/types.ts` | UPDATE | +14 / 0 |
| `src/weather/open-meteo-client.ts` | UPDATE | +10 / -10 (relocate `FetchError`/`FetchResult` to `types.ts`, re-export here) |

## Deviations from Plan

- **`FetchError` / `FetchResult` relocated from `open-meteo-client.ts` → `weather/types.ts`**. The plan said `src/weather/open-meteo-client.ts` is "unchanged" and that storage may import only from `weather/types.ts`. Both constraints conflicted: `revalidate.ts` needs the `FetchResult<T>` type to express its `Fetcher` signature, which lived inside the client. I moved the type definitions to `weather/types.ts` (their natural domain-types home) and added a one-line `export type { FetchError, FetchResult } from './types';` re-export in the client to preserve its public API (callers — `load-forecasts.ts`, `load-forecasts.test.ts`, `open-meteo-client.test.ts` — keep working unchanged). Pure type relocation, no behavior change. This respects the plan's intent (no storage→client runtime coupling) while letting `revalidate.ts` import from `weather/types.ts` only.

- **Test counts were targets, not contracts**. Plan: ≥ 14 staleness cases, ≥ 14 cache cases, ≥ 7 revalidate cases. Actual: 22 / 15 / 8. All within or above the floors.

- **`src/weather/load-forecasts.ts` left in the tree**. The plan said `main.ts` would switch to `revalidate` (it did — `loadForecasts` import removed from `main.ts`), but `load-forecasts.ts` and its test file remain on disk for back-compat. No caller imports it from production code now; it's effectively dead. Kept to minimise blast radius — STORY-008/009 can remove it without affecting this story.

- **No `setInterval` ticker for stamp staleness**. The plan flagged this as a known trade-off; not adding it keeps surface area small. Stamps refresh on every revalidate re-render — sufficient for the demo.

## Tests Written

| Test File | Test Cases |
|-----------|------------|
| `src/storage/staleness.test.ts` | 22: formatter (Just now / boundary at 1 min / 5 min / 59 min / 1 h / 23 h 59 min / 24 h / 3 d), clock skew, NaN-fetchedAt, non-finite now; `isStale` at threshold + custom threshold + NaN; `anyStale` fresh/stale/missing/empty |
| `src/storage/forecast-cache.test.ts` | 15: unsupported store, absent key, corrupt JSON, wrong-version, malformed-entry drop (2 entries dropped, 1 kept), round-trip, merge of multiple slots, overwrite, removeSlot, removeSlot deletes key when empty, clear, quota DOMException classification, non-quota throw classification, default jsdom localStorage path |
| `src/storage/revalidate.test.ts` | 8: empty slots, all-success with now() injection, partial failure preserves cache for failed slot, all-fail keeps cache, write-failure non-fatal (in-memory delta carries fresh data), unsupported cache (delta-only snapshot), parallel fetches (gate-based), fetcher-rejection never throws |
| `src/ui/location-card.test.ts` | +5: no-stamp default, stamp rendering, empty-string stamp = no stamp, XSS guard (textContent escapes HTML in the stamp string), degraded card no-stamp + with-stamp |
| `src/ui/home-screen.test.ts` | +3: stamps everywhere when `lastUpdated` provided, no stamps when `lastUpdated` absent, stamp on degraded card when only `lastUpdated[slotId]` is set |

## Re-verification recipe

```bash
# Tooling
npm install

# Full validation
npm run lint
npx tsc --noEmit
npm test
npm run build

# Build + preview with sample env (SW only runs under preview, per CLAUDE.md)
VITE_DEFAULT_LOCATIONS='[{"name":"Sample-A","lat":60,"lon":24},{"name":"Sample-B","lat":59.4,"lon":24.7}]' \
  npm run build && npm run preview -- --port 5173

# Then in a browser:
#  - Open http://127.0.0.1:5173/
#  - In DevTools console: seed a stale cache:
#      const doc = JSON.parse(localStorage.getItem('weather-cache.v1'));
#      for (const k in doc.slots) doc.slots[k].fetchedAt = Date.now() - 35*60*1000;
#      localStorage.setItem('weather-cache.v1', JSON.stringify(doc));
#  - Reload — cards show "Updated 35 min ago".
#  - Switch tab away and back — console logs `[revalidate] start 2` and a new fetch goes out.
#  - DevTools → Network → Offline → reload — cards still render with their stamps; no error UI.
```

## Defer-and-record (CLAUDE.md › Sandbox-blocked checks)

- [ ] **Real iPhone airplane-mode test on installed PWA (AC1 fully)**.
  Owner checklist:
  1. On iPhone, install the deployed app via Add to Home Screen (STORY-006).
  2. Open the installed app once with network so the cache is populated.
  3. Enable Airplane Mode → re-open the installed app → confirm all
     slots show with last-known data + an "Updated …" stamp.
- [ ] **iOS 7-day eviction probe (PRD open question)**. Owner checklist:
  do not open the installed PWA for ~7 days, then open it offline and
  record whether the cached forecasts still render. (This is the
  unresolved PRD question; the report flags it.)
- [ ] **Real iPhone visibilitychange refresh path**. Owner checklist:
  open the installed app, leave it idle for ~35 minutes, switch away to
  another app, come back — confirm the data freshness stamp resets to
  "Just now" (network permitting). iOS lifecycle semantics differ
  subtly from Chromium's `visibilitychange`.
