# Plan: Installable PWA — manifest, icons, service worker

## Summary

Make the app installable on iPhone (Add to Home Screen) and have its **app
shell** (HTML/CSS/JS + icons) survive offline through a precaching service
worker. We add the `vite-plugin-pwa` dev dependency and wire it in
`vite.config.ts` to emit a valid `manifest.webmanifest`, register a Workbox
precache service worker, and produce a maskable + any-purpose PWA icon
set. The home-screen icon and iOS standalone metadata go into
`index.html` (it does not have an "apple-touch-icon" link today). The SW
registration is moved behind a small typed wrapper in `src/main.ts` so we
can log at the boundary (CLAUDE.md › Observability) and unit-test the
lifecycle calls. Runtime caching of Open-Meteo responses is **out of
scope** — that is STORY-007 (offline data + stale-while-revalidate).
This story only guarantees the shell-offline + installability surface
that AC1–AC4 of issue #6 require.

The icon design is a hand-rolled SVG ("sun behind cloud" — matches the
PRD reference `examples/weather-lahti.png`); we render it once to PNGs
(192/512 + apple-touch-icon 180) and commit them to `public/icons/`. No
third-party asset, no runtime icon-generator dependency.

## User Story

As an iPhone user, I want to install this app to my home screen and open
it as a standalone PWA (with the right icon and name), so that the
weather is one tap away — and so that the shell still opens when I have
no network.

## Metadata

| Field | Value |
|-------|-------|
| Type | NEW_CAPABILITY (Phase 3 wiring) |
| Complexity | MEDIUM |
| GitHub Issue | #6 (STORY-006) |
| PRD | `.agents/PRDs/offline-weather-pwa.prd.md` — Phase 3 (PWA + offline) |
| Stories | `.agents/stories/offline-weather-pwa.stories.md` → STORY-006 |
| Branch | `claude/confident-ramanujan-bn4sM` |
| Blocked by | STORY-005 (merged — see `.agents/reports/real-default-locations-report.md`) |
| Blocks | STORY-007 (runtime data cache + SWR) |

---

## Patterns to follow

| Category | File:lines | Pattern |
|----------|-----------|---------|
| LAYERING | `CLAUDE.md` › Architecture | `ui → app services → api/storage → domain`. The SW registration helper lives at app-service altitude (`src/sw/register.ts`), called from `main.ts`. **Domain modules (`weather/`, `locations/`) MUST NOT import from `sw/`.** |
| RESULT TYPE | `src/weather/open-meteo-client.ts:8-17`; `src/locations/default-locations.ts:12-19` | Discriminated union for the lifecycle callback payloads: `RegisterResult = { kind: 'ready' } \| { kind: 'unsupported' } \| { kind: 'error', error: unknown }`. No `any`. |
| INPUT VALIDATION | `CLAUDE.md` › Security | Manifest fields are static strings we author — no API-sourced text in the SW path. iOS metadata strings hard-coded. No `innerHTML` is involved. |
| NAMING | `CLAUDE.md` › Code Patterns | Files kebab-case (`sw/register.ts`); types PascalCase (`RegisterResult`); functions camelCase (`registerServiceWorker`). Domain-first names — not `PWAHelper`, not `WorkboxUtils`. |
| TYPE STRICTNESS | `tsconfig.json:9-13`; `.eslintrc.cjs:21` | No `any`. `noUncheckedIndexedAccess` is on. Use `import type` for type-only imports. Treat `virtual:pwa-register` as a typed module (vite-plugin-pwa ships a `.d.ts`; we re-reference it from `src/vite-env.d.ts`). |
| OBSERVABILITY | `CLAUDE.md` › Observability; `src/weather/open-meteo-client.ts:83-86`; `src/weather/load-forecasts.ts:36-40` | `console.info`/`warn`/`error` at SW lifecycle boundaries with `[sw]` prefix. No analytics. |
| ERROR HANDLING | `CLAUDE.md` › Error handling; `src/main.ts:9-32` | If SW registration fails OR is unsupported (e.g., Safari with SW disabled, dev server) → log and **continue** rendering the app. SW failure must NEVER block paint. |
| SECURITY | `CLAUDE.md` › Security; `src/ui/footer.ts:5-19` | `apple-touch-icon` href is a static path. All metas are author-controlled. SW scope `'/'`. `rel="noopener noreferrer"` on any external link (no new external links in this story). |
| TESTS | `src/locations/default-locations.test.ts:1-15`; `src/weather/load-forecasts.test.ts:1-30`; `src/ui/footer.test.ts:1-30` | Vitest, no globals; `import { describe, expect, it, vi, afterEach } from 'vitest';`. Inject the `registerSW` function as a dep — do NOT touch the global `navigator.serviceWorker` or pull the real virtual module in unit tests. |
| ENV TYPING | `src/vite-env.d.ts:1` | Already has `/// <reference types="vite/client" />`. Extend with `/// <reference types="vite-plugin-pwa/client" />` so `import { registerSW } from 'virtual:pwa-register'` is typed. |
| HOTSPOTS (no concurrent work) | `CLAUDE.md` › Orchestration | `vite.config.ts`, `src/main.ts`, `index.html` (added to the hotspot watchlist for this story). The orchestrator must not run a parallel story touching these while this issue is in flight. |

---

## Public contracts

### `src/sw/register.ts` (app-service wrapper)

```ts
import type { RegisterSWOptions } from 'virtual:pwa-register';

export type RegisterResult =
  | { kind: 'ready' }        // SW controller is active and ready
  | { kind: 'unsupported' }  // import.meta.env.PROD === false, or no SW API in this UA
  | { kind: 'error'; error: unknown };

// Injectable for testability. Default is the virtual:pwa-register module.
export type RegisterSW = (options?: RegisterSWOptions) => (reload?: boolean) => Promise<void>;

export interface RegisterServiceWorkerDeps {
  registerSW?: RegisterSW;
  // import.meta.env.PROD is true under `npm run build` / preview, false under dev.
  isProd?: boolean;
  // navigator.serviceWorker presence — overridable for tests.
  hasServiceWorker?: boolean;
}

// Side-effectful at the boundary: logs to console, never throws.
// Returns a typed result so callers (and tests) can assert behavior.
export function registerServiceWorker(deps?: RegisterServiceWorkerDeps): RegisterResult;
```

Behavior:

- If `!isProd` OR `!hasServiceWorker` → `console.info('[sw] skipped: <reason>')`; return `{ kind: 'unsupported' }`. (SW does not register on the dev server or in test JSDOM — per CLAUDE.md "SW не работает на dev-сервере".)
- Else: call `registerSW({ immediate: true, onRegisteredSW(swUrl) {...}, onRegisterError(error) {...}, onNeedRefresh() {...}, onOfflineReady() {...} })`. The lifecycle callbacks each `console.info`/`warn` with `[sw]` prefix.
- The function does NOT `await` registration (the real `registerSW` is fire-and-forget on first call). It returns `{ kind: 'ready' }` synchronously after invoking — that signals "we tried, no synchronous throw".
- On any synchronous throw from `registerSW` (defensive — the virtual module is well-behaved) → `console.error('[sw] register threw', err)`; return `{ kind: 'error', error: err }`. Never re-throw.

### `src/main.ts` (wiring — minimal addition)

Add **one** call after the existing `bootstrap(app)` kick-off:

```ts
import { registerServiceWorker } from './sw/register';

// (existing #app lookup + bootstrap call stay exactly as they are)

registerServiceWorker();
```

Notes:

- Placed at module top-level (after the `void bootstrap(app)` branch). SW
  registration is independent of the bootstrap render path — paint must
  never wait on it.
- No try/catch needed here: `registerServiceWorker` is contractually total
  (never throws).

### `vite.config.ts` (UPDATE)

```ts
import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      // We register manually from src/sw/register.ts so we can log at the boundary.
      injectRegister: false,
      // SW disabled on dev server — preview-only (CLAUDE.md).
      devOptions: { enabled: false },
      includeAssets: ['icons/apple-touch-icon.png', 'icons/icon.svg'],
      manifest: {
        name: 'Weather',
        short_name: 'Weather',
        description: 'Personal offline-first weather',
        lang: 'en',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#0b1726',
        background_color: '#f5f7fa',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the app shell. Data caching (Open-Meteo) is STORY-007.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,ico,woff2}'],
        // SPA: fall back to the entry HTML for unknown navigations (offline-first shell).
        navigateFallback: '/index.html',
        // Don't intercept data API calls — STORY-007 will add a runtime route for that.
        navigateFallbackDenylist: [/^\/api\//, /^https:\/\//],
        cleanupOutdatedCaches: true,
        // Skip waiting + clientsClaim so a fresh SW takes over without a manual reload.
        skipWaiting: true,
        clientsClaim: true,
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    globals: false,
    css: false,
  },
});
```

Notes:

- `injectRegister: false` so the plugin doesn't sneak a `<script>` import
  into `index.html`; we own registration in `src/main.ts` for
  observability.
- `registerType: 'autoUpdate'` matches the "personal tool, single user"
  posture — no update prompt UX.
- `devOptions.enabled: false` keeps `npm run dev` clean (no SW, no
  precache during development) and respects CLAUDE.md.
- Workbox precache size: roughly `dist/index.html` + 1 CSS + 1 JS +
  manifest + 3 PNGs + 1 SVG ≈ ~50 KB total. Comfortably under Workbox's
  default 2 MB precache limit.

### `index.html` (UPDATE)

Add inside `<head>`, BEFORE the `<title>`:

```html
<link rel="icon" type="image/svg+xml" href="/icons/icon.svg" />
<link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="Weather" />
<meta name="description" content="Personal offline-first weather" />
```

Notes:

- Theme-color meta is already present (`<meta name="theme-color" content="#0b1726">`); we leave it.
- `vite-plugin-pwa` will auto-inject `<link rel="manifest" href="/manifest.webmanifest">` at build time — we do NOT add it manually (the plugin owns the path; manual injection would double-link).
- iOS Safari requires the explicit `apple-touch-icon` link — manifest icons alone are not sufficient for "Add to Home Screen" on iOS.

### `src/vite-env.d.ts` (UPDATE)

```ts
/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_DEFAULT_LOCATIONS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

The added triple-slash reference types the `virtual:pwa-register` module so `import { registerSW } from 'virtual:pwa-register'` does not need `any` or `// @ts-ignore`.

### Icon assets — `public/icons/`

Pre-rendered PNGs committed to the repo, one SVG master alongside:

| File | Size | Purpose |
|------|------|---------|
| `public/icons/icon.svg` | SVG (≤ 2 KB) | Modern browsers favicon + source-of-truth for design |
| `public/icons/icon-192.png` | 192×192 | manifest `any` |
| `public/icons/icon-512.png` | 512×512 | manifest `any` |
| `public/icons/icon-maskable-512.png` | 512×512 | manifest `maskable` — design padded to fit Android safe zone |
| `public/icons/apple-touch-icon.png` | 180×180 | iOS home-screen install |

Design: gradient circle background `#0b1726 → #1e3a5f` + a stylised sun
(`#f7b500`, matches `--accent`) partly behind a soft cloud (`#f5f7fa`).
Matches `examples/weather-lahti.png` mood, no copyrighted glyph.

Generation: at implementation time, render the master SVG → PNGs using a
one-shot Node script `scripts/generate-icons.mjs` (not committed as a
build step — it's run once and the outputs are committed). The script
uses `sharp` invoked via `npx --yes sharp-cli@latest …` so we do NOT add
`sharp` to `package.json` (it's a one-time tool, not a runtime/dev
dependency). If `sharp-cli` is unavailable in the sandbox, fall back to
hand-authored PNGs (the design is simple enough — solid background +
basic shapes — that even an SVG-rasterised-once-via-headless-Chromium is
acceptable; the runtime app does not depend on the generator).

---

## Files to change

| File | Action | Purpose |
|------|--------|---------|
| `package.json` | UPDATE | Add `vite-plugin-pwa` to `devDependencies` (after license + maintenance check). |
| `package-lock.json` | UPDATE (auto) | `npm install` produces it. |
| `vite.config.ts` | UPDATE | Wire `VitePWA` plugin with manifest + workbox precache. (Hotspot — single-issue edit.) |
| `index.html` | UPDATE | Add `apple-touch-icon`, iOS standalone metas, favicon SVG. (Hotspot — single-issue edit.) |
| `src/vite-env.d.ts` | UPDATE | Add `vite-plugin-pwa/client` types reference. |
| `src/sw/register.ts` | CREATE | Typed SW registration wrapper (injectable for tests). |
| `src/sw/register.test.ts` | CREATE | Unit tests for unsupported / prod-only / error paths. |
| `src/main.ts` | UPDATE | Call `registerServiceWorker()` after bootstrap kick-off. (Hotspot — single-issue edit.) |
| `public/icons/icon.svg` | CREATE | Master SVG icon (sun + cloud, gradient bg). |
| `public/icons/icon-192.png` | CREATE | 192×192 manifest icon (`any`). |
| `public/icons/icon-512.png` | CREATE | 512×512 manifest icon (`any`). |
| `public/icons/icon-maskable-512.png` | CREATE | 512×512 manifest icon (`maskable`). |
| `public/icons/apple-touch-icon.png` | CREATE | 180×180 iOS home-screen icon. |
| `.agents/reports/pwa-install-manifest-service-worker-report.md` | CREATE (Task 9) | Implementation report. |

Counts: **8 CREATE**, **5 UPDATE**, **0 DELETE**.

**NOT touched** (deliberate):

- `src/weather/`, `src/locations/`, `src/storage/`, `src/ui/` — no domain
  or UI change. The home screen, footer, location cards stay exactly as
  they are; the SW just precaches their compiled output.
- `src/ui/styles.css` — no new CSS in this story.
- Open-Meteo client — no caching change here. STORY-007 will add a
  runtime route for `api.open-meteo.com`.
- `.env.example`, `.gitignore`, `tsconfig.json`, `.eslintrc.cjs` — already
  correct.

---

## Tasks

Execute in order. Each task is atomic and verifiable.

### Task 0: Pre-flight — verify `vite-plugin-pwa` is safe to add

- **Action**: RESEARCH (no code yet)
- **Implement**:
  - Confirm `vite-plugin-pwa`'s latest version is compatible with Vite 7
    (the repo runs `vite@^7.3.5` per `package.json:24`). Use
    `npm view vite-plugin-pwa peerDependencies versions` (offline mirror
    or registry) — the plugin's peerDeps should list a vite range that
    includes 7.x. As of late 2025 / 2026, `vite-plugin-pwa@^0.21+` supports
    Vite 7.
  - License: MIT (project README + LICENSE) — compatible.
  - Maintenance: check the npm published-at on `npm view vite-plugin-pwa
    time.modified`; expect last publish within ~12 months. Per CLAUDE.md
    "Validate Before Implementing › Third-party libraries".
  - Run `npm audit --omit=dev` baseline before and after the install in
    Task 1; record diff in the report.
- **Mirror**: CLAUDE.md › Validate Before Implementing › Third-party libraries.
- **Validate**: Record the version chosen, peerDep match, license, last-publish
  date, and `npm audit` baseline in the implementation report (Task 9). If
  the version-compat check fails, STOP and surface to the owner — do NOT
  silently pick an older Vite-incompatible release.

### Task 1: Install the plugin

- **File**: `package.json`, `package-lock.json`
- **Action**: UPDATE
- **Implement**:
  - `npm install --save-dev vite-plugin-pwa@<version-from-task-0>`.
  - Verify `npm audit` shows no new high/critical issues vs. the baseline
    from Task 0.
- **Validate**: `npm run lint && npx tsc --noEmit && npm test` — all
  still green (no source change yet; the install must not break the
  toolchain).

### Task 2: Generate and commit icon assets

- **Files**: `public/icons/icon.svg`, `public/icons/icon-192.png`,
  `public/icons/icon-512.png`, `public/icons/icon-maskable-512.png`,
  `public/icons/apple-touch-icon.png`
- **Action**: CREATE
- **Implement**:
  1. Author `public/icons/icon.svg` by hand: a 512×512 viewBox with a
     gradient circle background (`#0b1726 → #1e3a5f`) + a sun
     (`#f7b500` filled circle, top-right) + a cloud (`#f5f7fa` rounded
     shape, bottom-left half-covering the sun). Keep node count low; no
     filters or text. The maskable variant uses the same artwork on a
     full-bleed background with safe-zone padding (artwork inside the
     inner 80% per Android maskable spec).
  2. Rasterise to PNGs using a one-shot command (the script is NOT
     committed):
     ```bash
     npx --yes sharp-cli@latest \
       -i public/icons/icon.svg \
       -o public/icons/icon-192.png \
       resize 192 192
     # repeat for 512, maskable-512 (with padded SVG variant), and 180 (apple-touch)
     ```
     If `sharp-cli` is unavailable in the sandbox, fall back to a Node
     script with `puppeteer` or `node-canvas` (one-shot, not committed
     as a dep). Worst-case fallback: hand-author minimal PNGs with a
     known-good encoder; the runtime app never depends on the generator.
  3. Verify each PNG's dimensions with `file public/icons/*.png` (or
     equivalent). Record sizes in the report.
  4. Ensure file sizes are reasonable: 192px ≤ ~6 KB, 512px ≤ ~30 KB,
     apple-touch ≤ ~8 KB. If a PNG is unexpectedly large, re-export with
     pngcrush/`zopflipng` or tighter sharp options.
- **Mirror**: N/A — first PWA assets in the repo.
- **Validate**: All five files exist; PNG headers (first 8 bytes
  `89 50 4E 47 0D 0A 1A 0A`) are correct; SVG opens cleanly. No icon is
  larger than ~50 KB. No third-party / licensed asset reused.

### Task 3: Type the virtual SW module — UPDATE `src/vite-env.d.ts`

- **File**: `src/vite-env.d.ts`
- **Action**: UPDATE
- **Implement**: Add the second triple-slash directive per "Public
  contracts › `src/vite-env.d.ts`" above (one new line).
- **Mirror**: existing `/// <reference types="vite/client" />` line.
- **Validate**: `npx tsc --noEmit` passes; opening `src/sw/register.ts`
  in Task 4 must allow `import { registerSW } from 'virtual:pwa-register'`
  without errors.

### Task 4: SW registration wrapper — `src/sw/register.ts`

- **File**: `src/sw/register.ts`
- **Action**: CREATE
- **Implement** per "Public contracts › `src/sw/register.ts`":
  - Export `RegisterResult`, `RegisterSW`, `RegisterServiceWorkerDeps`,
    `registerServiceWorker`.
  - Defaults: `isProd = import.meta.env.PROD`, `hasServiceWorker =
    typeof navigator !== 'undefined' && 'serviceWorker' in navigator`,
    `registerSW = (await import('virtual:pwa-register')).registerSW`.
    Wait — virtual:pwa-register is a synchronous module specifier
    rewritten by the plugin; use a top-level `import { registerSW as
    defaultRegisterSW } from 'virtual:pwa-register';` and pass that as
    the default in the deps. (Confirmed by the plugin's own docs and
    `.d.ts` shipping the function as a named export.)
  - Lifecycle callbacks:
    - `onRegisteredSW(swUrl)`: `console.info('[sw] registered', swUrl)`.
    - `onRegisterError(err)`: `console.error('[sw] register error', err)`.
    - `onNeedRefresh()`: `console.info('[sw] update available (auto-update will apply on next load)')`. We do NOT prompt the user — `registerType: 'autoUpdate'` handles it.
    - `onOfflineReady()`: `console.info('[sw] offline-ready: app shell precached')`.
  - Branches per the behavior spec (unsupported → log + return `{ kind: 'unsupported' }`; success → return `{ kind: 'ready' }`; sync throw → log + return `{ kind: 'error' }`).
  - **Do NOT** read `import.meta.env.MODE` — use `import.meta.env.PROD` (a typed `boolean`) so strict mode does not balk.
- **Mirror**: `src/weather/open-meteo-client.ts:21-28` (`ClientDeps`-style
  injectable defaults); `src/weather/load-forecasts.ts:12-19`
  (`LoadForecastsDeps`).
- **Validate**: `npx tsc --noEmit`; `npm run lint`. The new file must
  not introduce `any`.

### Task 5: SW wrapper tests — `src/sw/register.test.ts`

- **File**: `src/sw/register.test.ts`
- **Action**: CREATE
- **Implement** with these cases (`describe('registerServiceWorker')`):
  1. **Skipped on dev**: pass `{ isProd: false, hasServiceWorker: true,
     registerSW: vi.fn() }` → result `{ kind: 'unsupported' }`; the
     injected `registerSW` mock is NEVER called; `console.info` called
     once with a message containing "skipped" and "dev" (or similar
     diagnostic).
  2. **Skipped on no-SW UA**: pass `{ isProd: true, hasServiceWorker:
     false, registerSW: vi.fn() }` → result `{ kind: 'unsupported' }`;
     the injected `registerSW` mock is NEVER called; `console.info`
     mentions the reason.
  3. **Ready on prod**: pass `{ isProd: true, hasServiceWorker: true,
     registerSW: vi.fn().mockReturnValue(async () => {}) }` → result
     `{ kind: 'ready' }`; the injected `registerSW` was called exactly
     once with an options object containing `immediate: true` and the
     four lifecycle callbacks (`onRegisteredSW`, `onRegisterError`,
     `onNeedRefresh`, `onOfflineReady`).
  4. **Lifecycle callbacks log**: capture the options passed to the
     injected `registerSW`, invoke each callback (`onRegisteredSW('/sw.js')`,
     `onRegisterError(new Error('boom'))`, `onNeedRefresh()`,
     `onOfflineReady()`) and assert each one writes to the correct
     console method (`info`, `error`, `info`, `info`) with `[sw]`
     prefix.
  5. **Sync throw is caught**: pass `{ isProd: true, hasServiceWorker:
     true, registerSW: vi.fn(() => { throw new Error('synthetic'); }) }`
     → result `{ kind: 'error', error: Error }`; `console.error` called
     once; the function does NOT throw.
- **Test setup**:
  - `import { afterEach, describe, expect, it, vi } from 'vitest';`
  - `afterEach(() => { vi.restoreAllMocks(); });`
  - Spy on `console.info`, `console.warn`, `console.error` with
    `mockImplementation(() => {})` per test to keep CI output clean and
    enable assertions.
  - Do NOT import `virtual:pwa-register` in the test — inject a stub
    function via the deps argument instead. (The virtual module is a
    build-time rewrite; pulling it into JSDOM tests would be flaky.)
- **Mirror**: `src/weather/load-forecasts.test.ts:1-30` (dep injection +
  console-spy pattern); `src/ui/footer.test.ts` (clean test file
  structure).
- **Validate**: `npm test` — all green (5 new cases + 114 prior = 119).

### Task 6: Wire SW registration into `src/main.ts`

- **File**: `src/main.ts`
- **Action**: UPDATE (hotspot — single-issue edit)
- **Implement**:
  - Add `import { registerServiceWorker } from './sw/register';` at the
    top alongside the existing imports.
  - After the `if (app === null) { … } else { void bootstrap(app); }`
    block, add ONE line at module top level:
    ```ts
    registerServiceWorker();
    ```
  - Do NOT branch on the result here — the helper already logs; nothing
    else to do at the entry point. Paint MUST NOT depend on SW state.
- **Mirror**: `src/main.ts:9-15` (top-level boundary call pattern).
- **Validate**: `npx tsc --noEmit`; `npm run lint`; `npm test`. The
  smoke test (`src/smoke.test.ts`) still passes (the SW import is
  side-effect-free under the `unsupported` branch in JSDOM, because
  `import.meta.env.PROD` is `false` and `navigator.serviceWorker` is
  absent in jsdom — both yield the early-return path with no real
  registerSW call).

### Task 7: Wire `vite-plugin-pwa` in `vite.config.ts`

- **File**: `vite.config.ts`
- **Action**: UPDATE (hotspot — single-issue edit)
- **Implement** the full config per "Public contracts › `vite.config.ts`"
  above. Key details:
  - `import { VitePWA } from 'vite-plugin-pwa';` at the top.
  - `plugins: [VitePWA({ … })]` — full options block as specified.
  - The existing `test` block stays exactly as it was (Vitest still uses
    JSDOM, no globals, the same `include`).
  - Comment removed: replace the previous "vite-plugin-pwa is
    intentionally NOT wired here — Phase 3 owns PWA setup" comment with
    a short note that STORY-006 wired the plugin and that runtime data
    caching (Open-Meteo) is intentionally absent until STORY-007.
- **Mirror**: existing `vite.config.ts:1-13` structure (single
  `defineConfig` export, comments above the export).
- **Validate**: `npx tsc --noEmit` (the config compiles); `npm run
  build` succeeds and the output includes `dist/manifest.webmanifest`,
  `dist/sw.js` (or `dist/registerSW.js` + `dist/sw.js`), and the icon
  files copied from `public/icons/`. Run the build with a sample
  `VITE_DEFAULT_LOCATIONS` to confirm the env-var path still works (it
  is independent of the PWA plugin).

### Task 8: Update `index.html` with iOS metas + apple-touch-icon

- **File**: `index.html`
- **Action**: UPDATE (hotspot — single-issue edit)
- **Implement**:
  - Add the six `<link>` / `<meta>` tags from "Public contracts ›
    `index.html`" inside `<head>`, BEFORE the existing `<title>`.
  - Do NOT manually add a `<link rel="manifest">` — `vite-plugin-pwa`
    auto-injects it.
  - The existing `<meta name="theme-color" content="#0b1726">` stays
    unchanged.
- **Mirror**: existing `index.html:1-13` structure.
- **Validate**:
  - `npx tsc --noEmit && npm test && npm run build`.
  - Open the built `dist/index.html` and confirm: one `<link
    rel="manifest" href="/manifest.webmanifest">` was injected by the
    plugin; the apple-touch-icon link is present; the four iOS metas
    are present; the existing theme-color meta is intact.
  - Confirm `dist/manifest.webmanifest` parses as JSON and contains the
    `icons`, `name`, `short_name`, `theme_color`, `background_color`,
    `display: "standalone"`, `start_url: "/"`, `scope: "/"` fields.
  - Confirm `dist/icons/icon-192.png`, `dist/icons/icon-512.png`,
    `dist/icons/icon-maskable-512.png`, `dist/icons/apple-touch-icon.png`,
    `dist/icons/icon.svg` all exist (copied from `public/icons/`).
  - Confirm a service-worker file (`dist/sw.js` or whatever the plugin
    emits — check the build log) exists.

### Task 9: End-to-end PWA verification + implementation report

- **Files**: `.agents/reports/pwa-install-manifest-service-worker-report.md`
  (CREATE), plus screenshots under `.agents/reports/screenshots/`
- **Action**: CREATE
- **Implement**:
  1. Run the full validation suite (see "Validation" section below) —
     all four commands exit 0.
  2. Start the preview server with a sample env-var so the full build
     is exercised (CLAUDE.md: PWA only works under `npm run preview`,
     not `npm run dev`):
     ```bash
     VITE_DEFAULT_LOCATIONS='[{"name":"Sample","lat":0,"lon":0}]' \
       npm run build && npm run preview -- --port 5173
     ```
  3. Use the `agent-browser` skill to load `http://127.0.0.1:5173/` and:
     - **Manifest check**: fetch `/manifest.webmanifest`; assert valid
       JSON; assert `name`, `short_name`, `icons` (≥ 192 + 512), `theme_color`,
       `background_color`, `display: "standalone"`, `start_url`, `scope` —
       all present and well-formed.
     - **SW registration check**: open DevTools / inspect runtime; assert
       `navigator.serviceWorker.getRegistration()` returns a registration
       with a `scope` of `http://127.0.0.1:5173/`. Capture a screenshot of
       Application → Service Workers.
     - **HTML head check**: assert `<link rel="manifest">` is present;
       assert apple-touch-icon link + `apple-mobile-web-app-capable` meta
       + status-bar style meta + title meta are present.
     - **Offline shell test**: in DevTools Network panel, switch to
       "Offline"; hard-reload the page; assert the app shell still
       renders (loading or empty state, with footer). Capture a
       screenshot of the offline shell. Note: forecast data may be
       missing — STORY-007's job to cache that. The shell HTML/CSS/JS
       must come from the SW precache.
     - **Lighthouse PWA category** (best effort): if Lighthouse CLI is
       available in the sandbox, run `npx lighthouse http://127.0.0.1:5173/
       --only-categories=pwa --quiet --chrome-flags="--headless"`. Assert
       no installability errors. If Lighthouse is NOT available in the
       sandbox, mark this as **defer-and-record** (owner runs it).
  4. Write the implementation report mirroring
     `.agents/reports/real-default-locations-report.md` exactly:
     Summary, Tasks Completed table, Validation Evidence (paste outputs),
     Acceptance Criteria Mapping (per AC1–AC4), E2E Evidence with
     screenshot paths, Files Changed, Deviations from Plan, Tests
     Written, Re-verification recipe.
  5. Defer-and-record items (per CLAUDE.md › Sandbox-blocked checks):
     - **Real iPhone Safari Add-to-Home-Screen + standalone open**
       (AC2). Owner runs the checklist below on device.
     - **Real iPhone airplane-mode shell test** (AC3 fully — DevTools
       offline is a proxy; only an installed iOS PWA proves the iOS
       cache path). Owner runs on device.
     - **Lighthouse PWA audit on the deployed URL** — STORY-010 covers
       the deployed URL; for this story, the local Lighthouse run (if
       available) is sufficient evidence of installability.
- **Owner manual checklist** (record in the report under "Defer-and-record"):
  ```
  □ On iPhone (iOS 17+), open deployed URL in Safari.
  □ Share → Add to Home Screen → confirm icon preview matches design,
    confirm name reads "Weather".
  □ Tap installed icon → app opens standalone (no Safari chrome).
  □ Enable Airplane Mode → re-open app → shell + last-known data
    still render. (Note: last-known data is STORY-007; for STORY-006 it
    is sufficient that the shell renders.)
  ```

---

## Risks

| Risk | Mitigation |
|------|------------|
| `vite-plugin-pwa` versions before 0.21 don't support Vite 7 | Task 0 verifies peerDep range against the installed Vite version BEFORE running `npm install`. Pinned version recorded in the report. |
| Plugin auto-injecting `<script>` for SW registration when we also call `registerServiceWorker()` from `main.ts` (double-register) | `injectRegister: false` in the plugin options. Confirmed by checking `dist/index.html` for the absence of an auto-injected `registerSW.js` script tag during Task 8 validation. |
| SW runs on `npm run dev` and breaks HMR | `devOptions.enabled: false` in the plugin options + `isProd` check inside `registerServiceWorker`. Two redundant gates — defense in depth. Task 5 case 1 asserts the dev gate. |
| iOS Safari ignores manifest icons → home-screen icon shows white square | Explicit `<link rel="apple-touch-icon" sizes="180x180">` in `index.html`. iOS-specific metas (`apple-mobile-web-app-capable`, `-title`, `-status-bar-style`). Task 8 validates head structure. |
| Service worker over-caches and intercepts Open-Meteo API responses, breaking STORY-007's runtime caching | `workbox.navigateFallbackDenylist: [/^\/api\//, /^https:\/\//]` — keep cross-origin requests off the SW navigation path. `globPatterns` is for static precache only; it does not match cross-origin URLs by definition. STORY-007 will add an explicit `runtimeCaching` route when it lands. |
| `import.meta.env.PROD` resolves to `false` under Vitest/JSDOM → real `registerSW` from `virtual:pwa-register` is never invoked even in production-shaped tests | This is exactly what we want: the unit test injects a stub `registerSW`; the production path is validated by `npm run build` + the agent-browser smoke test against `npm run preview`. Task 5 case 3 covers the "isProd: true" branch by explicit injection. |
| `virtual:pwa-register` typed module missing → `tsc` fails on `import { registerSW }` | Task 3 adds `/// <reference types="vite-plugin-pwa/client" />` to `src/vite-env.d.ts`. tsc validation in Task 4 will catch this immediately if the reference path is wrong. |
| Maskable icon design clipping on Android (Safari ignores maskable; Android crops to a circle) | The maskable PNG keeps all meaningful artwork inside the inner 80% safe zone (Android maskable spec). Even if Android crops, the sun + cloud silhouette survives. |
| PNG icons too large → Workbox precache exceeds 2 MB default | Each icon ≤ ~50 KB; total precache (HTML + CSS + JS + icons + manifest) ~80–100 KB, well under 2 MB. |
| Plugin emits a different SW filename (`sw.js` vs `service-worker.js`) than expected | The plugin defaults to `sw.js` at `dist/sw.js`. The browser does not care — the plugin handles the `<link rel="manifest">` and SW URL injection. Our wrapper does not hard-code a path. Validation in Task 8 just asserts that **some** SW file exists. |
| `navigator.serviceWorker.register()` rejecting because `dist` is served from a non-HTTPS / non-localhost origin | `npm run preview` serves on `localhost:5173` — SW is allowed. Production deploy (STORY-010) lands on HTTPS via Netlify/Cloudflare Pages. Defer-and-record for the real deploy. |
| Browser cache holding an old `index.html` masking a SW update during dev iteration | `workbox.cleanupOutdatedCaches: true` and `skipWaiting: true` + `clientsClaim: true` together force the new SW to take over without a manual reload. |
| Owner accidentally serving the dev server and seeing "SW does not work" | The wrapper logs `[sw] skipped: not production (npm run dev)` to the console. The implementation report's re-verification recipe explicitly uses `npm run preview`, not `dev`. CLAUDE.md already documents this. |
| Adding a dev dependency without `npm audit` review | Task 0 records a pre-install audit baseline; Task 1 verifies no new high/critical findings. The plugin is widely used (millions of weekly downloads, MIT, actively maintained), so the surprise risk is low. |
| Hotspot collision (`vite.config.ts`, `main.ts`, `index.html`) with concurrent work | Per CLAUDE.md › Orchestration "max parallel 3 + hotspot rule". This issue lists all three as hotspots up front — the orchestrator must not run STORY-007 (which will also touch `vite.config.ts` for runtime caching and `main.ts` for cache bootstrap) concurrently. STORY-007 is blocked by THIS story anyway per the stories doc. |
| Plan asked for `sharp-cli` but it's unavailable in the sandbox | Fallback path documented in Task 2: a Node/puppeteer one-shot, or hand-authored PNGs from the SVG via headless Chromium. The runtime app never depends on the generator. |

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

Additional checks (Task 8 / Task 9):

```bash
# Build output sanity — these files MUST exist after `npm run build`:
test -f dist/manifest.webmanifest
test -f dist/icons/icon-192.png
test -f dist/icons/icon-512.png
test -f dist/icons/icon-maskable-512.png
test -f dist/icons/apple-touch-icon.png
test -f dist/icons/icon.svg
# At least one of the plugin's SW filenames:
test -f dist/sw.js || test -f dist/service-worker.js

# Manifest content:
node -e "const m=require('./dist/manifest.webmanifest'); \
  if (m.display!=='standalone') process.exit(1); \
  if (!m.icons.find(i=>i.sizes==='192x192')) process.exit(1); \
  if (!m.icons.find(i=>i.sizes==='512x512')) process.exit(1);"

# index.html head structure:
grep -q 'rel="manifest"' dist/index.html
grep -q 'rel="apple-touch-icon"' dist/index.html
grep -q 'apple-mobile-web-app-capable' dist/index.html
grep -q 'theme-color' dist/index.html
```

Browser-driven checks (agent-browser skill, Task 9):

- `/manifest.webmanifest` returns 200 with `Content-Type:
  application/manifest+json`; parsed JSON satisfies the assertions above.
- `navigator.serviceWorker.getRegistration()` resolves to a non-null
  registration after first page load under `npm run preview`.
- DevTools "Offline" + hard-reload still renders the app shell.

Deferred (CLAUDE.md › Sandbox-blocked checks — recorded, NOT failed):

- **Real-iPhone Add-to-Home-Screen + standalone open** (AC2 fully)
- **Real-iPhone airplane-mode** test of the installed PWA (AC3 fully)
- **Lighthouse PWA audit on the deployed URL** (STORY-010 covers
  deployment; this story validates installability locally under
  `npm run preview`)

---

## Acceptance criteria

Issue #6 ACs → tasks/tests mapping (every AC maps to ≥ 1 task or test):

- [ ] **AC1** — Given prod build (`npm run build && npm run preview`),
  manifest is valid (name, icons 192/512 + apple-touch-icon, theme-color,
  `display: standalone`) AND service worker registers.
  → Task 7 (plugin manifest config), Task 2 (icon assets), Task 8 (head
  metas), Task 4 (SW registration wrapper), Task 6 (main.ts wires it),
  Task 9 (preview server + agent-browser verifies the manifest fetches,
  parses, and the SW is registered). Validation grep gates assert the
  built artifacts.

- [ ] **AC2** — Given Safari on iPhone, Add to Home Screen installs the
  app with the correct icon + name, opens standalone (no Safari chrome).
  → Task 2 (apple-touch-icon 180×180), Task 8 (`apple-touch-icon` link
  + `apple-mobile-web-app-capable` + `apple-mobile-web-app-title="Weather"`
  + `apple-mobile-web-app-status-bar-style="black-translucent"`). Task 9
  records this as **defer-and-record (owner)** with a checklist —
  CLAUDE.md › Sandbox-blocked: real-device iPhone test.

- [ ] **AC3** — Given installed PWA + airplane mode, the app shell (HTML/
  CSS/JS) loads from the SW cache.
  → Task 7 (Workbox precache `globPatterns` + `navigateFallback`),
  Task 4/6 (SW registration), Task 9 (agent-browser offline-test of the
  shell against `npm run preview` as the in-sandbox proxy). Real-iPhone
  install + airplane mode is **defer-and-record (owner)** per CLAUDE.md.

- [ ] **AC4** — Lighthouse PWA audit on the prod build shows no
  installability errors.
  → Task 9 attempts `npx lighthouse … --only-categories=pwa` against
  `npm run preview`. If Lighthouse is unavailable in the sandbox, this
  is recorded as **defer-and-record (owner)** — the owner runs
  Lighthouse on the deployed URL post-STORY-010. Local validations in
  Task 8 (manifest JSON, head metas, SW filename, icon presence) cover
  Lighthouse's installability prerequisites.

Process gates:

- [ ] All tasks completed
- [ ] `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build` pass
- [ ] One new dev dependency added (`vite-plugin-pwa`); zero new
      runtime dependencies (`package.json` `dependencies` stays empty)
- [ ] `npm audit` shows no new high/critical findings vs. the
      pre-install baseline (recorded in the report)
- [ ] No `any` anywhere in new code; lint = 0 errors, 0 warnings
- [ ] No `innerHTML`; all DOM text via `textContent` (no DOM additions
      in this story but the rule still applies)
- [ ] Icon assets in `public/icons/` are hand-rolled — no third-party /
      licensed asset reused
- [ ] No real default-location names or coordinates in `src/`,
      `index.html`, `public/`, `vite.config.ts`, or `.env.example`
      (regression-check the grep gate from STORY-005 still passes)
- [ ] `src/sw/` does NOT import from `src/weather/`, `src/locations/`,
      `src/storage/`, or `src/ui/` (layering)
- [ ] SW registration NEVER blocks paint (Task 6: top-level call, no
      `await`; Task 4: never throws synchronously)
- [ ] PWA tooling is OFF on dev (`devOptions.enabled: false` + the
      `isProd` gate in the wrapper)
- [ ] Sandbox-blocked checks recorded as defer-and-record — NOT treated
      as failures:
      - Real iPhone Add-to-Home-Screen + standalone open (AC2 fully)
      - Real iPhone airplane-mode test (AC3 fully)
      - Lighthouse PWA audit on the deployed URL (AC4 — local
        Lighthouse runs are an in-sandbox proxy)
      - Netlify / Cloudflare Pages deploy (STORY-010 territory)
- [ ] Issue #6 acceptance criteria → tasks/tests mapping above is
      complete
