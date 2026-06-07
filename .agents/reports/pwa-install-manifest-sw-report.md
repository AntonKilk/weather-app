# Implementation Report

**Plan**: `.agents/plans/pwa-install-manifest-sw.plan.md`
**Branch**: `claude/issue-6-pwa-install-manifest-sw`
**Status**: COMPLETE

## Summary

Wired `vite-plugin-pwa@1.3.0` into the existing Vite + TypeScript-strict
project so production builds emit a valid web app manifest, a Workbox-based
precaching service worker for the app shell, and the icon set referenced by
both. Three PNG icons (192/512/180) + an SVG favicon were generated locally
via a hand-rolled, dependency-free Node script and committed under `public/`.
A small `src/sw-register.ts` boundary registers the SW at module load —
guarded, log-only on failure, never throws. `src/main.ts` gained exactly two
lines (one import + one call) so the merge with concurrent issue #9 stays
trivial. `vite.config.ts` is the new PWA-config hotspot, owned by this story.

## Tasks Completed

| # | Task | File | Status |
|---|------|------|--------|
| 1 | Install `vite-plugin-pwa` | `package.json`, `package-lock.json` | OK |
| 2 | Augment TS types for `virtual:pwa-register` | `src/vite-env.d.ts` | OK |
| 3 | SW registration boundary | `src/sw-register.ts` | OK |
| 4 | Tests for SW registration | `src/sw-register.test.ts` | OK |
| 5 | Generate PWA icons | `scripts/generate-icons.mjs` + `public/*` | OK |
| 6 | Update `index.html` (icon + iOS meta) | `index.html` | OK |
| 7 | Wire `VitePWA` into Vite config | `vite.config.ts` | OK |
| 8 | One-line SW registration call | `src/main.ts` | OK |
| 9 | Final validation + build artifact spot-check | n/a | OK |

## Validation Evidence

| Check | Command | Result |
|-------|---------|--------|
| Lint | `npm run lint` | exit 0 (no findings) |
| Type check | `npx tsc --noEmit` | exit 0 (silent) |
| Tests | `npm test` | 8 files, 76 passed, 0 failed (was 73; +3 from `sw-register.test.ts`) |
| Build | `npm run build` | exit 0; `dist/sw.js`, `dist/manifest.webmanifest`, three PNGs + favicon emitted; PWA precache 14 entries / 40.29 KiB |
| npm audit | `npm audit` | 0 vulnerabilities |

Key build output:
```
PWA v1.3.0
mode      generateSW
precache  14 entries (40.29 KiB)
files generated
  dist/sw.js
  dist/workbox-9c191d2f.js
```

Manifest spot-check (`node -e "JSON.parse(...)"`):
```
OK name (Weather)
OK short_name (Weather)
OK display (standalone)
OK theme_color (#0b1726)
OK background_color (#0b1726)
OK scope (/)
OK start_url (/)
OK icon 192 present
OK icon 512 maskable (purpose: "any maskable")
OK icon 180 present
```

Generated `dist/index.html` contains the auto-injected `<link rel="manifest" href="/manifest.webmanifest">` and the manual `<link rel="apple-touch-icon">` line, plus the iOS meta tags (`apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, `apple-mobile-web-app-title`) and the forward-compatible `mobile-web-app-capable`.

Preview-server smoke test (`vite preview --port 4173`):
```
manifest.webmanifest        → HTTP 200
sw.js                       → HTTP 200
pwa-192.png                 → HTTP 200
apple-touch-icon-180.png    → HTTP 200
favicon.svg                 → HTTP 200
/                           → HTTP 200
```

## Independent Verification

**Verdict**: CONFIRMED (self-verified — no separate `Agent` tool surfaced in
this session; verifier subagent could not be dispatched. I re-ran every
validation command myself and inspected the diff and build artifacts.)

**Evidence (commands I ran):**
- `npm run lint` → exit 0
- `npx tsc --noEmit` → exit 0
- `npm test` → exit 0, 76/76 passed
- `npm run build` → exit 0, PWA artifacts emitted
- `npm audit` → exit 0, 0 vulnerabilities
- `node scripts/generate-icons.mjs` → exit 0, 3 PNGs + favicon written
- `file public/*.png` → all three reported as valid PNG image data with
  expected dimensions (192/512/180)
- `vite preview --port 4173` + `curl` → manifest/sw/icons all 200

**UNVERIFIABLE (sandbox-blocked, defer-and-record per CLAUDE.md):**
- Lighthouse PWA installability audit — owner runs locally and/or at
  Netlify/Cloudflare deploy gate (CH-21).
- iPhone Safari "Add to Home Screen" install → standalone launch, correct
  icon/name — owner runs on real device.
- iPhone airplane-mode test — installed PWA loads app shell from SW cache —
  owner runs on real device.

## E2E Evidence

| Test | Action performed | Observed result |
|------|------------------|-----------------|
| Production build emits SW + manifest | `npm run build`, `ls dist/` | `dist/sw.js`, `dist/workbox-*.js`, `dist/manifest.webmanifest`, `dist/registerSW.js` all present |
| Manifest is a valid JSON object with required PWA fields | `node -e "JSON.parse(fs.readFileSync('dist/manifest.webmanifest','utf8'))"` + field assertions | All 10 checks (name, short_name, display=standalone, theme/bg color, scope, start_url, icons 192/512-maskable/180) PASS |
| Preview server serves manifest + SW + icons | `vite preview --port 4173` then curl each asset | All HTTP 200 |
| `index.html` carries the PWA install metadata | `cat dist/index.html` | Contains injected `<link rel="manifest">`, manual `apple-touch-icon`, iOS meta tags, and the auto-injected `registerSW.js` script |
| Existing app still works (no regression) | `npm test` (76 tests, including `app.test.ts`/`main.test.ts`) | Pass — CC-BY footer assertion still green |
| SW registration is safe under tests | `npm test -- src/sw-register.test.ts` | 3/3 pass: no-SW-support path, success log, failure log (no throw) |

## Files Changed

| File | Action | Notes |
|------|--------|-------|
| `package.json` | UPDATE | +1 devDep (`vite-plugin-pwa`), +1 script (`gen:icons`) |
| `package-lock.json` | UPDATE | npm install resolved |
| `vite.config.ts` | UPDATE | `VitePWA(...)` plugin block; existing Vitest config retained |
| `index.html` | UPDATE | +4 lines: icon link, apple-touch-icon, iOS meta tags |
| `src/main.ts` | UPDATE | +2 functional lines (import + `registerServiceWorker()` call) — hotspot-minimal for #9 merge |
| `src/sw-register.ts` | CREATE | SW boundary (guarded, log-only, never throws) |
| `src/sw-register.test.ts` | CREATE | 3 unit tests |
| `src/vite-env.d.ts` | UPDATE | `/// <reference types="vite-plugin-pwa/client" />` |
| `scripts/generate-icons.mjs` | CREATE | Dependency-free PNG/SVG generator (zlib + hand-rolled PNG encoder) |
| `public/pwa-192.png` | CREATE | 192×192 brand icon (sun+cloud on `#0b1726`) |
| `public/pwa-512.png` | CREATE | 512×512 maskable variant |
| `public/apple-touch-icon-180.png` | CREATE | 180×180 iOS home-screen icon |
| `public/favicon.svg` | CREATE | Vector favicon |
| `.gitignore` | UPDATE | Add `dev-dist/` defensively |

## Deviations from Plan

None. The plan was executed task-for-task. Minor implementation detail
clarified during Task 3: the dynamic import of `virtual:pwa-register` was
implemented through an indirect (variable) specifier with a
`/* @vite-ignore */` comment so Vitest's import-analysis doesn't try to
pre-resolve the virtual module under jsdom. Without this, the very first
test run failed with `Failed to resolve import "virtual:pwa-register"`. The
fix is the canonical Vite escape hatch for build-time-only virtual modules
and matches the plan's intent ("inject `register` in tests, dynamic-import
the virtual module in production").

## Tests Written

| Test File | Test Cases |
|-----------|------------|
| `src/sw-register.test.ts` | (1) no-op + info log when `serviceWorker` absent from `navigator`; (2) success path logs `[sw] registered`; (3) failure path logs `[sw] registration failed` and does not throw |

Existing tests untouched. Final tally: 76 passing (73 prior + 3 new), 0 failed.

## Notes / Hand-off

- **Owner manual checks (defer-and-record):**
  1. Run `npm run preview`, open `http://localhost:4173/` in Chrome,
     DevTools → Application tab → confirm manifest parses and SW is
     registered. (Lighthouse PWA audit also fine here.)
  2. Deploy and open the URL on iPhone Safari → Add to Home Screen →
     confirm icon/name and standalone launch.
  3. Enable airplane mode → re-launch installed PWA → confirm the app
     shell loads (cards may show "Unavailable" — that's expected; STORY-007
     adds the API response cache).
- Re-run `npm run gen:icons` if the brand glyph ever needs replacing; the
  generator is deterministic and dependency-free.
