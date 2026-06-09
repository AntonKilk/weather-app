# Implementation Report

**Plan**: `.agents/plans/deploy-free-static-hosting.plan.md`
**Branch**: `claude/kind-gauss-vudx0k`
**Issue**: #10 (STORY-010)
**Status**: COMPLETE

## Summary

Closed Phase 5 of the offline-weather PWA — the final story. Added the repo-side
prerequisites for one-click auto-deploy to Netlify (primary) or Cloudflare Pages
(drop-in alternative):

- `public/_redirects` with a single portable SPA-fallback rule
  (`/*  /index.html  200`). Vite copies it to `dist/_redirects` at build time;
  both hosts read the same syntax — one file, two hosts.
- `netlify.toml` pinning `npm run build`, `publish = "dist"`, and
  `NODE_VERSION = "22"` (Vite 7 requires Node ≥ 22.12). Two comment lines
  documenting why `VITE_DEFAULT_LOCATIONS` deliberately does NOT live here.
- `README.md` "Deploy" section: provider choice, dashboard-only env-var
  instruction, and the owner's four-step iPhone install + airplane-mode
  checklist that maps to PRD success metrics.

Zero source-code changes. No new dependencies. `vite.config.ts` is untouched —
the PWA precache, `navigateFallback`, runtime cache, and manifest already
shipped in STORY-005/006/007. The footer CC-BY 4.0 attribution
(`src/ui/footer.ts:5-18`) ships unchanged into the production bundle (verified
via curl on the preview server).

Per CLAUDE.md › Sandbox-blocked checks, the actual deploy steps (connect repo
to host, set `VITE_DEFAULT_LOCATIONS` in dashboard, tap "Add to Home Screen"
on iPhone, toggle airplane mode) are recorded as DEFERRED — owner. The
README checklist documents the exact commands for each.

## Tasks Completed

| # | Task | File | Status |
|---|------|------|--------|
| 0 | Verify shipping invariants (no leaked coords; vite.config navigateFallback intact; footer attribution renders; baseline `npm run build` exit 0; dist/ artifacts generated) | grep + Read + Bash | ✅ |
| 1 | Create portable SPA-fallback redirect rule | `public/_redirects` | ✅ |
| 2 | Create Netlify build config (command, publish, Node version) | `netlify.toml` | ✅ |
| 3 | Add "Deploy" section to README (provider choice, env-var instruction, iPhone checklist) | `README.md` | ✅ |
| 4 | Full validation (lint, tsc, tests, build, dist/_redirects assertion) | n/a — commands | ✅ |
| 5 | Implementation report | this file | ✅ |

## Validation Evidence

| Check | Command | Result |
|-------|---------|--------|
| Lint | `npm run lint` | exit 0 (no output, no errors) |
| Type check | `npx tsc --noEmit` | exit 0 (no output, no errors) |
| Tests | `npm test` | **272 passed (20 test files), 0 failed** |
| Build | `npm run build` | exit 0; 40.93 kB JS / 5.71 kB CSS / SW + manifest + 16 precache entries (95.61 KiB) |
| `_redirects` in publish dir | `test -f dist/_redirects && cat dist/_redirects` | `/*  /index.html  200` |
| `netlify.toml` has no secrets | `grep -E 'VITE_DEFAULT_LOCATIONS=\|Lahti\|Helsinki\|Tallinn\|Käsmu\|Kasmu' netlify.toml` | only one match — the comment line that says it MUST be set in the host env, NEVER here |
| `vite.config.ts` untouched (hotspot) | `git diff HEAD -- vite.config.ts` | empty |
| `src/` untouched | `git diff HEAD --stat -- src/` | empty |
| Dependencies unchanged | `git diff HEAD -- package.json package-lock.json` | empty |
| Preview serves built bundle | `curl http://127.0.0.1:4173/` | HTTP 200 |
| Manifest served | `curl http://127.0.0.1:4173/manifest.webmanifest` | HTTP 200 |
| Service worker served | `curl http://127.0.0.1:4173/sw.js` | HTTP 200 |
| Footer attribution baked into bundle | `curl /assets/index-*.js \| grep -c 'Weather data by Open-Meteo'` | 1 |

Key lines from `npm test`:

```
 Test Files  20 passed (20)
      Tests  272 passed (272)
   Duration  5.85s
```

Key lines from `npm run build`:

```
dist/manifest.webmanifest                         0.50 kB
dist/index.html                                   0.95 kB │ gzip:  0.45 kB
dist/assets/index-SIseepv0.css                    5.71 kB │ gzip:  1.69 kB
dist/assets/index-CJcJ60NA.js                    40.93 kB │ gzip: 11.27 kB
PWA v1.3.0
mode      generateSW
precache  16 entries (95.61 KiB)
files generated
  dist/sw.js
  dist/workbox-9c191d2f.js
```

No new tests were added — this story changes deploy config + docs, no
runtime code. The 272 existing tests act as a regression check that
nothing was accidentally broken.

## Acceptance Criteria Mapping

| # | Acceptance criterion (verbatim) | Evidence |
|---|---|---|
| 1 | Given push в `master`, when CI/хостинг собирает проект, then прод-сборка публикуется по HTTPS-URL автоматически | Repo-side contract: `netlify.toml:6-11` pins build command (`npm run build`), publish dir (`dist`), and `NODE_VERSION = "22"`. `public/_redirects` (copied to `dist/_redirects` at build — verified) provides the SPA fallback both hosts honour. **DEFERRED — owner**: the GitHub-to-host connection (Netlify "Add new site" / Cloudflare Pages "Connect to Git") and the first deploy. Documented in `README.md` "One-time setup" steps 1–4. The repo is now in a state where the only remaining manual step is the OAuth handshake with the chosen host. |
| 2 | Given настройки хостинга, when смотрю конфигурацию, then `VITE_DEFAULT_LOCATIONS` задана в env хостинга, а в репозитории реальных локаций нет | Repo-side: `netlify.toml` deliberately omits `VITE_DEFAULT_LOCATIONS` (verified via grep — only the comment line that forbids it appears); `.gitignore:13-14` excludes `.env*` files; `.env.example:1-5` has the sample shape only. README "One-time setup" step 3 explicitly documents the dashboard-only path with the JSON shape. No real default-location coords (Lahti/Käsmu lat/lon) appear in any tracked source file — only public-city-name strings used in tests/fixtures (Helsinki, Tallinn) which the STORY-009 verifier round-2 already cleared as not-the-secret-payload. |
| 3 | Given прод-URL на iPhone, when прохожу чек-лист владельца (Add to Home Screen → открыть → дождаться данных → авиарежим → переоткрыть), then офлайн показываются данные всех слотов со штампом свежести | Underlying capabilities already shipped: PWA install (STORY-006: manifest, icons, service worker), SWR cache + freshness stamp (STORY-007), six-slot grid with custom-slot persistence (STORY-005 + STORY-009). The four-step checklist documented verbatim in `README.md` "iPhone install + offline checklist" steps 1–5. **DEFERRED — owner**: requires real iPhone hardware + real network (CLAUDE.md › Sandbox-blocked checks list this explicitly). |
| 4 | Given прод-сборка, when открываю приложение, then футер-атрибуция Open-Meteo на месте, загрузка кэшированного экрана < 2 с | Footer attribution: `src/ui/footer.ts:5-18` (existing, unchanged) renders the CC-BY 4.0 link as plain `textContent`; verified to be baked into the production bundle via `curl /assets/index-*.js \| grep -c 'Weather data by Open-Meteo'` → 1 match. < 2 s cached load: Workbox precache (`vite.config.ts:43-53`, 16 entries / 95.61 KiB) + SWR cache (STORY-007) deliver the cached screen on first paint. The < 2 s measurement requires real-device timing on the deployed URL — **DEFERRED — owner** (README checklist step 5 covers this on iPhone). |

Every AC maps to ≥ 1 repo-side artefact AND/OR a `DEFERRED — owner` row with
the exact manual command. No AC is silently skipped.

## Independent Verification

**Verdict**: CONFIRMED (round 1 of max 3) — zero findings.

The verifier independently re-ran lint, typecheck, all 272 tests, the
production build, and walked every AC-mapping row against the actual code +
the built `dist/` artefacts. Verifier's evidence (verbatim):

> EVIDENCE (commands I ran myself):
>
> - `git show --stat 7b538c1` → exit 0; exactly 4 files changed: `.agents/reports/deploy-free-static-hosting-report.md` (+165), `README.md` (+44/-0), `netlify.toml` (+11), `public/_redirects` (+1). No source files touched.
> - `npm run lint` → exit 0; no errors.
> - `npx tsc --noEmit` → exit 0; no errors.
> - `npm test` → exit 0; 272 passed (20 test files), 0 failed, duration 5.15s.
> - `npm run build` → exit 0; produces `dist/manifest.webmanifest`, `dist/index.html`, `dist/assets/index-CJcJ60NA.js` (40.93 kB), `dist/assets/index-SIseepv0.css` (5.71 kB), `dist/sw.js`, `dist/workbox-9c191d2f.js`, 16 precache entries (95.61 KiB).
> - `test -f dist/_redirects && cat dist/_redirects` → exit 0; `/*  /index.html  200\n` — one rule, two spaces between fields, status 200 (not 301/302), trailing newline.
> - `od -c public/_redirects` → confirms identical byte-for-byte contents.
> - `grep -c 'Weather data by Open-Meteo' dist/assets/index-*.js` → 1 match; attribution baked into production bundle.
> - `grep -nE 'VITE_DEFAULT_LOCATIONS' netlify.toml` → only line 4: a comment line forbidding the variable from being set there. No assignment.
> - `grep -nE 'VITE_DEFAULT_LOCATIONS=|Lahti|Helsinki|Tallinn|Käsmu|Kasmu' netlify.toml` → exit 1 (no matches for the sensitive patterns).
> - `git diff 6d916a3...7b538c1 -- src/ vite.config.ts package.json package-lock.json` → exit 0; empty diff; zero source files changed.
> - `grep -n 'navigateFallback' vite.config.ts` → line 47: `navigateFallback: '/index.html'` — confirms SPA fallback in Workbox is intact.
> - `cat dist/manifest.webmanifest` → valid PWA manifest with `name: "Weather"`, icons, `display: "standalone"`.
> - `git grep -nE '60\.98|25\.66|60\.17|24\.94|59\.44|24\.75|59\.61|25\.97' -- '*.ts' '*.json' '*.toml' '*.env*'` → matches only in test fixtures using publicly known Helsinki/Tallinn coordinates as illustrative test data, not the private `VITE_DEFAULT_LOCATIONS` payload.
> - `cat .env.example` → `VITE_DEFAULT_LOCATIONS=[{"name":"Sample City","lat":0,"lon":0}]` — sample only, no real coordinates.
> - `cat .gitignore` → `.env`, `.env.local`, `.env.*.local` are excluded; real coordinates cannot be accidentally committed.
> - `ls dist/` → all required artefacts present: `_redirects`, `assets/`, `icons/`, `index.html`, `manifest.webmanifest`, `sw.js`, `workbox-*.js`.
> - README lines 56-99: "Deploy" section present with (a) Netlify/Cloudflare provider choice, (b) explicit dashboard-only env-var instruction for `VITE_DEFAULT_LOCATIONS` with correct JSON shape reference, (c) five-step iPhone install + airplane-mode checklist covering all PRD success metrics.
>
> FINDINGS: none.
>
> UNVERIFIABLE (same defer-and-record items the report already records):
> - Actual push to `master` → Netlify/Cloudflare Pages auto-build → live HTTPS URL appearing in dashboard (AC1 deploy execution) — requires OAuth handshake with an external hosting account; sandbox-blocked.
> - Setting `VITE_DEFAULT_LOCATIONS` in the hosting dashboard (AC2 dashboard half) — requires owner credentials.
> - iPhone Add-to-Home-Screen + airplane mode test (AC3) — requires real iOS device and network.
> - Sub-2-second cached-load measurement on the live deployed URL (AC4 performance half) — requires the deployed URL and real-device timing.

The verifier's UNVERIFIABLE list matches this report's "Sandbox-blocked items"
section one-to-one; no AC is silently skipped.

Note: the verifier inspected commit SHA `7b538c1`. The commit was subsequently
amended to `ebb7877` (`git commit --amend --no-edit --reset-author` to satisfy
the repo's signature/identity stop-hook); the file contents are byte-identical,
so the verifier's evidence applies to `ebb7877` without re-verification.

## E2E Evidence

| Test | Action performed | Observed result |
|------|------------------|-----------------|
| Build smoke | `rm -rf dist && npm run build` | exit 0; PWA SW + manifest + 16 precache entries; bundle 40.93 kB / CSS 5.71 kB |
| `_redirects` propagation | `test -f dist/_redirects && cat dist/_redirects` | file present; contents = `/*  /index.html  200\n` (matches `public/_redirects` byte-for-byte) |
| Production preview boots | `npm run preview -- --port 4173 --host 127.0.0.1` (background) | server starts; `/`, `/manifest.webmanifest`, `/sw.js` all HTTP 200 |
| Footer attribution in built bundle | `curl http://127.0.0.1:4173/assets/index-*.js \| grep -c 'Weather data by Open-Meteo'` | 1 match |
| Visual / real-device walkthrough (deploy + iPhone install + airplane mode + Lighthouse PWA audit) | DEFERRED — owner | Documented step-by-step in `README.md` "iPhone install + offline checklist". Sandbox cannot simulate iOS Safari install + airplane mode + on-device performance — per CLAUDE.md › Sandbox-blocked checks. |

## Files Changed

| File | Action | Lines |
|------|--------|-------|
| `public/_redirects` | CREATE | +1 |
| `netlify.toml` | CREATE | +11 |
| `README.md` | UPDATE | +44 / −0 |
| `.agents/reports/deploy-free-static-hosting-report.md` | CREATE | this file |

Totals: **2 CREATE source/config files** + **1 UPDATE doc** + **1 CREATE report**.
**Zero source files changed; zero `vite.config.ts` changes; zero new
dependencies.**

## Deviations from Plan

| Plan asked for | What was done | Why |
|---|---|---|
| Task 0 included a `git grep` check that surfaces zero coord-string matches outside `.agents/` + `CLAUDE.md` | `git grep` surfaced 30+ matches of `Helsinki` / `Tallinn` / `Käsmu` strings inside `src/**/*.test.ts`, `src/locations/fixtures/`, `src/weather/mock-forecasts.ts`, `src/ui/search-input.test.ts` | These are illustrative public-city strings inside tests and mock forecasts, NOT the real `VITE_DEFAULT_LOCATIONS` payload. STORY-009's verifier round-2 already accepted this distinction (CLAUDE.md › Configuration: "Never commit real locations" — meaning the env-var JSON value, not every mention of a Nordic city). The plan's intent is preserved; the grep result was inspected line-by-line. |
| Task 4 final-validation step suggested `test -f dist/_redirects && grep -q '/\\*' dist/_redirects` | Used `test -f dist/_redirects && cat dist/_redirects` instead | Same coverage, more diagnostic on failure (you see the actual content). No semantic difference. |
| Plan listed `npm ci` as implicit (it's in CLAUDE.md › Commands) | The sandbox container started without `node_modules/`; `npm ci` was run explicitly before any validation could pass | Standard remote-execution setup; not a deviation in intent. Recorded for transparency. |

## Tests Written

No new tests in this story (deploy config + docs only; no runtime code
changed). The 272 existing tests across 20 test files act as a regression
check that the deploy artefacts don't accidentally affect runtime behaviour.
The `_redirects` file is verified by the build pipeline (`dist/_redirects`
assertion) and by the published-URL check (the host honours the rule at
edge — verified by the owner after deploy).

## Sandbox-blocked items (defer-and-record per CLAUDE.md)

These are NOT failures; they are owner-manual steps documented in the
`README.md` "Deploy" section:

1. **GitHub-to-host connection**: owner signs in to Netlify or Cloudflare
   Pages, clicks "Add new site" → "Import from Git", selects this repo +
   branch `master`. (README "One-time setup" steps 1–2.)
2. **Set `VITE_DEFAULT_LOCATIONS` in the hosting dashboard**: owner enters
   the JSON value (real coords) in the hosting build env. The value must
   never appear in this repo. (README step 3.)
3. **First deploy**: triggered automatically by step 2 on both hosts. Owner
   confirms the HTTPS URL appears in the dashboard. (README step 4.)
4. **iPhone install + airplane-mode test**: owner runs the four-step
   checklist on real hardware. (README "iPhone install + offline checklist"
   steps 1–5.) This closes the PRD's `Success Metrics` row "Offline test —
   cached weather for all 6 slots renders in airplane mode".
5. **Lighthouse PWA audit on the live URL**: optional polish; not in the
   issue ACs. Owner can run when convenient.
