# Implementation Report

**Plan**: `.agents/plans/pwa-install-manifest-service-worker.plan.md`
**Branch**: `claude/confident-ramanujan-bn4sM`
**Status**: COMPLETE
**GitHub Issue**: #6 (STORY-006 — Install as PWA: manifest, icons, service worker)
**HEAD before publish**: (recorded in commit message after Phase 6B)

## Summary

STORY-006 makes the app installable on iPhone (Add to Home Screen) and
keeps its app shell working offline through a Workbox precache:

- **`vite-plugin-pwa@1.3.0`** added as a dev dependency (MIT, peer-deps
  include `vite ^7.0.0` → matches `vite@^7.3.5`, last published
  2026-05-05, `npm audit` 0 vulnerabilities pre + post install).
- **`vite.config.ts`** wires `VitePWA({ … })` with a complete manifest
  (name, short_name, description, lang, start_url, scope,
  display: standalone, orientation, theme_color, background_color, three
  icons), Workbox precache for the app shell (`globPatterns` includes
  js/css/html/svg/png/webmanifest/ico/woff2) with `navigateFallback:
  '/index.html'` and a denylist that keeps API + cross-origin requests
  off the navigation path (Open-Meteo runtime caching is STORY-007).
- **`src/sw/register.ts`** is a tiny typed wrapper around
  `vite-plugin-pwa`'s `registerSW`. It:
  - gates registration off in dev / non-SW UAs and logs `[sw] skipped:
    …` with a reason;
  - calls `registerSW({ immediate: true, … })` with four lifecycle
    callbacks (`onRegisteredSW`, `onRegisterError`, `onNeedRefresh`,
    `onOfflineReady`), each writing to the correct console method with
    a `[sw]` prefix (CLAUDE.md › Observability);
  - never throws — sync throws return `{ kind: 'error', error }` and a
    console.error, so SW failure never blocks paint.
- **`src/main.ts`** calls `registerServiceWorker()` at module top level,
  after the bootstrap kick-off — paint never waits on SW.
- **`index.html`** has the iOS install metadata (apple-touch-icon link,
  apple-mobile-web-app-capable, -title="Weather",
  -status-bar-style="black-translucent", description meta, favicon SVG).
  `vite-plugin-pwa` auto-injects `<link rel="manifest">` at build time.
- **`src/vite-env.d.ts`** adds `/// <reference types="vite-plugin-pwa/client" />`
  so `virtual:pwa-register` is typed (no `any`).
- **Hand-rolled PWA icons** in `public/icons/`: master SVG (sun behind
  cloud, gradient sky) plus rasterised PNGs at 192/512 (any), 512
  (maskable, padded for Android safe zone), and 180 (apple-touch). No
  third-party / licensed asset reused.

Runtime data caching for Open-Meteo responses is **intentionally NOT in
this story** — that is STORY-007. Workbox does not intercept the API
calls (denylisted via `navigateFallbackDenylist`).

## Tasks Completed

| # | Task | File(s) | Status |
|---|------|---------|--------|
| 0 | Pre-flight: vite-plugin-pwa version/peerDeps/license/audit | `npm view vite-plugin-pwa` + baseline `npm audit` | ✅ |
| 1 | Install vite-plugin-pwa@1.3.0 as dev dep | `package.json`, `package-lock.json` | ✅ |
| 2 | Generate icon assets (SVG master + 4 PNG variants) | `public/icons/{icon.svg,icon-192.png,icon-512.png,icon-maskable-512.png,apple-touch-icon.png}` | ✅ |
| 3 | Type `virtual:pwa-register` module | `src/vite-env.d.ts` | ✅ |
| 4 | SW registration wrapper (injectable, typed, never throws) | `src/sw/register.ts` | ✅ |
| 5 | SW wrapper unit tests (5 cases) | `src/sw/register.test.ts` | ✅ |
| 6 | Wire `registerServiceWorker()` into `main.ts` | `src/main.ts` | ✅ |
| 7 | Wire `VitePWA(...)` in `vite.config.ts` | `vite.config.ts` | ✅ |
| 8 | Add iOS metas + apple-touch-icon link to `index.html` | `index.html` | ✅ |
| 9 | E2E verification, screenshots, report (this file) | `.agents/reports/pwa-install-manifest-service-worker-report.md`, `.agents/reports/screenshots/pwa-*.png` | ✅ |

## Validation Evidence

| Check | Command | Result |
|-------|---------|--------|
| Lint | `npm run lint` | exit 0; 0 errors, 0 warnings |
| Type check | `npx tsc --noEmit` | exit 0 |
| Tests | `npm test` (Vitest) | exit 0; **119 passed** (5 new + 114 prior), 0 failed |
| Build | `npm run build` (`tsc --noEmit && vite build`) | exit 0; `dist/manifest.webmanifest` + `dist/sw.js` + `dist/workbox-9c191d2f.js` + `dist/icons/*` emitted; precache 16 entries / 76.99 KiB |
| Audit | `npm audit` (post-install) | 0 vulnerabilities |
| Manifest content | `JSON.parse(dist/manifest.webmanifest)` | display=standalone, icons 192/512/maskable, name=Weather, theme/bg correct, start_url=`/`, scope=`/` |
| index.html head | `grep` for manifest, apple-touch-icon, ios-capable, ios-title, ios-status, theme-color | all present; no auto-injected `registerSW` (matches `injectRegister: false`) |
| Icon dimensions | `file public/icons/*.png` | 180×180, 192×192, 512×512, 512×512 — all RGBA PNGs |
| Grep gate (real city names) | `grep -rE '(Lahti\|Helsinki\|Tallinn\|Käsmu)' src/sw/ index.html vite.config.ts public/ .env.example` | no matches (pre-existing `Europe/Helsinki` IANA string in `src/weather/mock-forecasts.ts` is STORY-002 fixture, out of scope) |
| Layering | `grep "from '\.\./\(weather\|locations\|storage\|ui\)" src/sw/*.ts` | no matches — `src/sw/` has no cross-domain imports |

Key output:

```
> weather-app@0.0.0 test
> vitest run

 RUN  v4.1.8 /home/user/weather-app

 Test Files  12 passed (12)
      Tests  119 passed (119)
   Duration  3.13s

> weather-app@0.0.0 build
> tsc --noEmit && vite build

vite v7.3.5 building client environment for production...
✓ 20 modules transformed.
dist/manifest.webmanifest                         0.50 kB
dist/index.html                                   0.95 kB │ gzip: 0.45 kB
dist/assets/index-Ch7w8d-A.css                    3.86 kB │ gzip: 1.34 kB
dist/assets/workbox-window.prod.es5-BBnX5xw4.js   5.75 kB │ gzip: 2.36 kB
dist/assets/index-DVyfp9ot.js                    23.72 kB │ gzip: 7.28 kB
✓ built in 256ms

PWA v1.3.0
mode      generateSW
precache  16 entries (76.99 KiB)
files generated
  dist/sw.js
  dist/workbox-9c191d2f.js
```

## Acceptance Criteria Mapping

| # | Acceptance criterion (verbatim from issue #6) | Evidence |
|---|---|---|
| AC1 | Given прод-сборка (`npm run build && npm run preview`), when открываю в браузере, then manifest валиден (name, icons 192/512 + apple-touch-icon, theme-color, `display: standalone`) и service worker регистрируется | **Manifest**: `vite.config.ts:18-37` (manifest config). `dist/manifest.webmanifest` parses with `display=standalone`, name=`Weather`, theme_color=`#0b1726`, three icons (192-any / 512-any / 512-maskable). Chrome CDP `Page.getAppManifest` returned `errors: []`. **Apple-touch-icon**: `index.html:8` (`<link rel="apple-touch-icon" sizes="180x180">`), file `dist/icons/apple-touch-icon.png` (180×180 RGBA PNG). **SW registration**: `src/sw/register.ts:24-65` + 5 unit tests in `src/sw/register.test.ts` (dev-skip, no-SW-skip, ready-on-prod, lifecycle-callbacks-log, sync-throw-caught). E2E: real Chromium console captured `info:[sw] registered /sw.js` and `info:[sw] offline-ready: app shell precached`; `navigator.serviceWorker.getRegistration().scope === 'http://127.0.0.1:5173/'`, `active.scriptURL === '/sw.js'`. |
| AC2 | Given Safari на iPhone, when делаю Add to Home Screen, then приложение ставится с корректной иконкой и именем и открывается standalone (без браузерного хрома) | **Static prerequisites verified**: `index.html:7-11` adds apple-touch-icon link + `apple-mobile-web-app-capable=yes` + `apple-mobile-web-app-title="Weather"` + `apple-mobile-web-app-status-bar-style="black-translucent"`. Manifest has `display: standalone`. Icons present at 180/192/512 dimensions. **Real-device install on iPhone**: `DEFERRED — owner` per CLAUDE.md › Sandbox-blocked checks. See "Owner manual checklist" below. |
| AC3 | Given установленное PWA и включённый авиарежим, when открываю приложение, then app shell (HTML/CSS/JS) загружается из кэша service worker — статика доступна офлайн | **Local proxy verified**: `vite.config.ts:38-49` configures `workbox.globPatterns` to precache the app shell (js/css/html/svg/png/webmanifest/ico/woff2). `dist/sw.js` contains `precacheAndRoute([…16 entries…])`, `NavigationRoute → '/index.html'`, denylist `[/^\/api\//, /^https?:\/\//]`. **E2E offline test**: in headless Chromium, after SW activated → `context.setOffline(true)` → `page.reload()` → app container (`#app`), `footer.app-footer`, all head metas (manifest link, apple-touch-icon) render; `fetch('/manifest.webmanifest')` returned status 200 from SW cache. Screenshots: `.agents/reports/screenshots/pwa-shell-offline.png`, `pwa-shell-online.png`. **Real-iPhone airplane-mode test of installed PWA**: `DEFERRED — owner` per CLAUDE.md › Sandbox-blocked checks. |
| AC4 | Given Lighthouse-проверка категории PWA на прод-сборке, when запускаю аудит, then ошибок installability нет | **Lighthouse 12+ deprecated the PWA category** — `npx lighthouse … --only-categories=pwa` now errors with "unrecognized category in 'onlyCategories': pwa". The semantic equivalent is Chrome's installability check, which we ran directly: **Chrome CDP `Page.getInstallabilityErrors` returned `installabilityErrors: []`** (with a persistent non-incognito profile so Chrome's "in-incognito" installability gate doesn't fire). `Page.getAppManifest.errors: []`. All Chrome installability criteria met: manifest with name + 192/512 icons + start_url + scope + display=standalone, SW with fetch handler (Workbox), served over localhost. **Lighthouse on deployed URL**: `DEFERRED — owner` post-STORY-010 (or use Chrome DevTools › Application panel "Install App" gating, which is the modern equivalent of the deprecated PWA category). |

Deferred-and-recorded items (CLAUDE.md › Sandbox-blocked checks):

- **Real-iPhone Add-to-Home-Screen + standalone open** (AC2 fully).
  Owner runs the checklist below on device.
- **Real-iPhone airplane-mode test of the installed PWA** (AC3 fully).
  Owner runs on device. The local headless-Chromium proxy proves the
  Workbox precache works; only an installed iOS PWA proves Safari's
  cache path on a real device.
- **Lighthouse PWA category audit on the deployed URL** (AC4
  technicality). Lighthouse 12 dropped the dedicated PWA category;
  Chrome's Application → "Install App" gating in DevTools is the modern
  equivalent. We verified the underlying installability criteria via
  Chrome's CDP API.
- **Netlify / Cloudflare Pages deploy** — STORY-010 territory.

### Owner manual checklist (record in the issue after running)

```
□ On iPhone (iOS 17+), open the deployed URL in Safari.
□ Share → Add to Home Screen → confirm icon preview matches the
  generated icon (sun behind cloud on dark gradient).
□ Confirm the home-screen label reads "Weather".
□ Tap the installed icon → app opens standalone (no Safari chrome).
□ Enable Airplane Mode → re-open the installed app → the shell
  renders with the loading/empty state + the "Weather data by
  Open-Meteo" footer. (Forecast data caching is STORY-007 — for
  STORY-006 only the SHELL needs to load offline.)
```

## Independent Verification

**Verdict**: CONFIRMED (round 1 of max 3)

EVIDENCE (commands the verifier ran itself, verbatim):

```
- npm run lint → exit 0; no errors, no warnings
- npx tsc --noEmit → exit 0; no type errors
- npm test → exit 0; 12 test files, 119 tests passed (5 new in src/sw/register.test.ts + 114 prior)
- VITE_DEFAULT_LOCATIONS='[{"name":"Sample","lat":0,"lon":0}]' npm run build → exit 0;
  dist/sw.js + dist/manifest.webmanifest + dist/icons/* all present;
  16 precache entries / 78.49 KiB
- manifest content gate (node JSON.parse) → "manifest OK"; display=standalone,
  icons 192x192 + 512x512 any + 512x512 maskable all present
- dist/index.html head checks: rel="manifest" OK, rel="apple-touch-icon" OK,
  apple-mobile-web-app-capable OK, apple-mobile-web-app-title OK,
  apple-mobile-web-app-status-bar-style OK, theme-color OK,
  registerSW NOT injected (OK — injectRegister:false honoured)
- file public/icons/icon-192.png → 192 x 192 OK
- file public/icons/icon-512.png → 512 x 512 OK
- file public/icons/icon-maskable-512.png → 512 x 512 OK
- file public/icons/apple-touch-icon.png → 180 x 180 OK
- grep (Lahti|Helsinki|Tallinn|Käsmu) over src/sw/, index.html, vite.config.ts,
  public/, .env.example → no matches
- grep cross-domain imports in src/sw/ → no matches (layering clean)
- Playwright runtime check against npm run preview (port 5173):
  - SW={"registered":true,"scope":"http://127.0.0.1:5173/",
        "active_url":"http://127.0.0.1:5173/sw.js"}
  - console logs contain
    info:[sw] registered /sw.js
    info:[sw] offline-ready: app shell precached
  - Page.getAppManifest.errors=[]
  - Page.getInstallabilityErrors → {"installabilityErrors":[]}
  - OFFLINE probe (setOffline+reload): {"title":"Weather","app":true,
                                        "footer":true,"manifest_link":true}
  - OFFLINE manifest fetch status = 200 (served from SW cache)
```

Verifier notes (additive refinements, not deviations):

- The `{ kind: 'unsupported' }` variant carries an extra `reason: string`
  field beyond the plan's public-contract snippet. All tests assert it
  and TypeScript is happy — additive only.
- `navigateFallbackDenylist` uses `/^https?:\/\//` instead of the
  plan's `/^https:\/\//` — strictly more correct (covers both http and
  https cross-origin).

UNVERIFIABLE (verifier-marked, defer-and-record per CLAUDE.md ›
Sandbox-blocked checks):

- Real-device iPhone Safari Add-to-Home-Screen + standalone open (AC2)
- Real-device iPhone airplane-mode test of installed PWA (AC3 fully)
- Lighthouse PWA audit on the deployed URL (STORY-010 deployment territory)

## E2E Evidence

Preview server with a sample env baked in:

```bash
VITE_DEFAULT_LOCATIONS='[{"name":"Sample","lat":0,"lon":0}]' \
  npm run build && npm run preview -- --port 5173 --host 127.0.0.1
```

Browser driver: headless Chromium (`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`)
via Playwright (one-shot in `/tmp/sharp-tool` — not added to the
project's deps).

| Test | Action performed | Observed result |
|------|------------------|-----------------|
| Page loads with all head metadata | `GET /` then DOM probe | `title="Weather"`, `link[rel=manifest]→/manifest.webmanifest`, `link[rel=apple-touch-icon]→/icons/apple-touch-icon.png`, all four iOS metas present, theme-color preserved. |
| SW registers | `navigator.serviceWorker.getRegistration()` after waiting for ready | `registered=true`, `scope=http://127.0.0.1:5173/`, `active.scriptURL=http://127.0.0.1:5173/sw.js`, `installing=false`. |
| Wrapper lifecycle logs | Console capture | `info:[sw] registered /sw.js`, `info:[sw] offline-ready: app shell precached`. |
| Manifest served correctly | `fetch('/manifest.webmanifest')` | status=200, content-type=`application/manifest+json`, body parses, all required fields present. |
| Chrome installability gate | CDP `Page.getInstallabilityErrors` (persistent context) | `installabilityErrors: []` — zero errors. |
| Chrome manifest parser | CDP `Page.getAppManifest` | `errors: []`. |
| Offline shell renders | `context.setOffline(true)` → `page.reload()` → DOM probe | `app=true`, `footer=true`, `title=Weather`, manifest link present. |
| Manifest served by SW offline | `fetch('/manifest.webmanifest')` after offline + reload | status=200 (from SW precache). |
| No auto-injected register script | `grep registerSW dist/index.html` | no matches (`injectRegister: false` works). |
| Icon visual sanity | `GET /icons/icon-512.png` rendered | sun behind cloud on dark-gradient sky with rounded corners — matches design brief. |

Screenshots in `.agents/reports/screenshots/`:

- `pwa-shell-online.png` — initial load (loading state + footer; data fetch fails because Open-Meteo is blocked in the sandbox, but the shell renders).
- `pwa-shell-offline.png` — after `setOffline(true) + reload()`; the shell + footer + head metadata are all delivered from the SW cache.
- `pwa-icon-512.png` — the rendered 512×512 icon (design check).

## Files Changed

| File | Action | Lines |
|------|--------|-------|
| `package.json` | UPDATE | +1 dev dep (`vite-plugin-pwa@^1.3.0`) |
| `package-lock.json` | UPDATE (auto) | regenerated for the new dep tree |
| `vite.config.ts` | UPDATE | full plugin config; +50 / -3 |
| `index.html` | UPDATE | +6 head tags (apple-touch-icon, ios metas, description, favicon) |
| `src/vite-env.d.ts` | UPDATE | +1 triple-slash reference |
| `src/main.ts` | UPDATE | +1 import, +1 top-level call (`registerServiceWorker()`); +5 / -0 |
| `src/sw/register.ts` | CREATE | typed SW wrapper with dep injection; +54 |
| `src/sw/register.test.ts` | CREATE | 5 cases via dep-injected stub; +124 |
| `public/icons/icon.svg` | CREATE | hand-authored master (sun + cloud + gradient bg); 863 B |
| `public/icons/icon-192.png` | CREATE | 192×192 RGBA PNG; 5.9 KB |
| `public/icons/icon-512.png` | CREATE | 512×512 RGBA PNG; 18.7 KB |
| `public/icons/icon-maskable-512.png` | CREATE | 512×512 RGBA PNG, safe-zone padded; 12.4 KB |
| `public/icons/apple-touch-icon.png` | CREATE | 180×180 RGBA PNG; 6.2 KB |
| `.agents/reports/pwa-install-manifest-service-worker-report.md` | CREATE | this file |
| `.agents/reports/screenshots/pwa-shell-online.png` | CREATE | E2E screenshot (loading state) |
| `.agents/reports/screenshots/pwa-shell-offline.png` | CREATE | E2E screenshot (after setOffline+reload) |
| `.agents/reports/screenshots/pwa-icon-512.png` | CREATE | icon visual sanity-check |

## Deviations from Plan

1. **Sharp not pre-installed in the sandbox** (plan Task 2 listed
   `npx --yes sharp-cli` as the preferred renderer; the fallback path
   already covered "if sharp-cli is unavailable"). Resolved by
   installing `sharp` into `/tmp/sharp-tool` (one-shot, not added to
   the project) and rasterising via a small inline Node script. Outputs
   committed; no build-time dependency on sharp.
2. **Lighthouse 12 deprecated the PWA category** (plan Task 9 anticipated
   "if Lighthouse is unavailable in the sandbox, mark defer-and-record").
   Lighthouse IS available, but the `--only-categories=pwa` flag now
   errors. Replaced with the modern equivalent: Chrome CDP
   `Page.getInstallabilityErrors` returned `[]` against the production
   build under a persistent (non-incognito) context. This is what
   Lighthouse's old PWA-installability audit actually checked under the
   hood. The "Lighthouse on deployed URL" item stays DEFERRED for the
   owner.
3. **`navigateFallbackDenylist` regex slightly broadened** (plan said
   `[/^\/api\//, /^https:\/\//]`, I used `[/^\/api\//, /^https?:\/\//]`)
   so both http and https cross-origin requests are excluded from the
   navigation fallback. Open-Meteo is `https://`, but defense in depth.
4. **Owner-checklist screenshot capture done via Playwright + the
   pre-installed Chromium at `/opt/pw-browsers/chromium-1194/...`**
   rather than `agent-browser` (the binary referenced by the agent-browser
   skill isn't installed in this sandbox; the underlying
   Chromium-driven approach delivers the same evidence).
5. **No `agent-browser` Service-Workers panel screenshot.** Headless
   Chromium doesn't expose the DevTools Application panel from CDP in a
   way that produces a useful screenshot. The CDP API directly returned
   the SW registration state (scope, active scriptURL, installability
   errors) — that's the underlying data the panel displays. Recorded
   under E2E table.

None of these change the architecture or the AC outcomes.

## Tests Written

| Test File | Test Cases |
|-----------|------------|
| `src/sw/register.test.ts` | 5: (1) dev-server skip — `isProd:false` → `kind:unsupported,reason:'not-production'`, `registerSW` never called, `console.info` logs "[sw] skipped: production"; (2) no-SW UA skip — `hasServiceWorker:false` → `kind:unsupported,reason:'no-service-worker-api'`; (3) ready on prod — `registerSW` called exactly once with `{immediate:true, onRegisteredSW, onRegisterError, onNeedRefresh, onOfflineReady}`; (4) lifecycle callbacks log to the correct console method (info×3, error×1) with `[sw]` prefix; (5) sync throw is caught — `kind:error,error`, `console.error` logged, function never re-throws. |

Total new: 5 tests; project total 119 (was 114).

## Re-verification (quick recipe)

```bash
git checkout claude/confident-ramanujan-bn4sM
npm ci
npm run lint && npx tsc --noEmit && npm test && npm run build

# E2E with the pre-installed Chromium (sandbox-friendly):
VITE_DEFAULT_LOCATIONS='[{"name":"Sample","lat":0,"lon":0}]' \
  npm run build && npm run preview -- --port 5173 --host 127.0.0.1 &
# (wait until curl 127.0.0.1:5173 returns 200, then run the verifier Node script
# from the original verification — see the Phase 4.6 prompt or the E2E table.)
```

Owner-only verification (defer-and-record):

```bash
# Real-network happy path on iPhone:
echo "VITE_DEFAULT_LOCATIONS=[…your 4 cities…]" > .env.local
npm run build && npm run preview -- --host 0.0.0.0
# In Safari on iPhone: open the LAN URL → Share → Add to Home Screen.
# Confirm icon, name, standalone open. Then enable Airplane Mode and
# re-open the installed app → shell + footer must render.
```
