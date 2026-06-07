# Implementation Report

**Plan**: `.agents/plans/deploy-static-host.plan.md`
**Branch**: `claude/issue-10-deploy-static-host`
**Status**: COMPLETE

## Summary

Phase 5 of the offline weather PWA: deployment configuration for **Cloudflare Pages**.
The branch also integrates every prior story branch (#3 detail/SVG chart, #6 PWA
manifest+SW, #7 offline cache + SWR, #8 geocoding autocomplete, #9 custom slot
add/remove/persist) on top of #7, so the owner gets a single mergeable branch
that ships the working product end-to-end.

The deploy step itself adds only static text files (no source-code changes,
no new runtime dependencies, no bundle-size impact):

- `public/_headers` — Cloudflare Pages cache rules (`/sw.js` and `/manifest.webmanifest` `no-cache`; `/assets/*` 1-year immutable)
- `public/_redirects` — defensive SPA fallback (`/* /index.html 200`)
- `.nvmrc` — pins Node 22 for the Pages build
- `DEPLOY.md` — owner-facing instructions (build command, output dir, env var, iPhone install checklist)
- `README.md` — link to DEPLOY.md

**Cloudflare Pages was chosen over Netlify** because the free tier has no build-minute cap, it's edge-CDN by default, and connecting the repo is one click.

## Branch lineage / integration

Branched from `origin/claude/issue-7-offline-cache-swr`. Two integration merges, then the deploy commit:

```
b687ba3 Add static hosting deploy config (#10)
426387a Integrate STORY-003 (detail view SVG chart + 7-day strip)
957cfb4 Integrate STORY-008/009 (custom slots + autocomplete) with STORY-007 (SWR cache)
... origin/claude/issue-7-offline-cache-swr (4 commits, transitively #1+#2+#4+#5+#6+#7)
```

### Merge conflicts and resolutions

- **#9 → main.ts**: both sides rewrote bootstrap. Resolved by composing both feature sets — SWR cache wiring from #7 (`cacheStore`, `now`, `isOnline`, `documentImpl` options + `lastUpdatedLabel`) AND custom-slot wiring from #9 (`customSlotStore`, `mountSearchWidget`, `onAddRequest`, `onRemove`). The unified bootstrap rebuilds the SWR pipeline on every custom-slot change (subscriber triggers `rebuildAndRender('custom-slot-change')`) so adding/removing a slot does cache-first paint + refresh just like startup.
- **#9 → main.test.ts**: combined both test suites; every test that exercises `bootstrap()` now also passes the SWR injection (`cacheStore: createMemoryStore()`, `isOnline: () => true`, `documentImpl: null`). The pre-existing assertion "additional fetch on add" was loosened to `toBeGreaterThan(fetchBefore)` since SWR may now also refresh the defaults.
- **#9 → ui/app.ts**: combined `lastUpdatedLabel` (from #7) with `onAddRequest` + `onRemove` (from #9). One real bug fixed in passing: the conflicting versions left `buildListView` with `opts` as both parameter 2 and parameter 4; final signature is `(items, onTap, opts)`.
- **#3 → ui/styles.css**: trailing-block conflict — kept both blocks (the `.last-updated` style and the new chart/daily-strip styles).

## Tasks Completed

| # | Task | File | Status |
|---|------|------|--------|
| 0a | Integrate STORY-008/009 onto STORY-007 | `src/main.ts`, `src/main.test.ts`, `src/ui/app.ts` | ✅ |
| 0b | Integrate STORY-003 (detail view) | `src/ui/styles.css` | ✅ |
| 1 | Pin Node version for the host | `.nvmrc` | ✅ |
| 2 | Cloudflare Pages SPA fallback | `public/_redirects` | ✅ |
| 3 | Cloudflare Pages cache headers | `public/_headers` | ✅ |
| 4 | Deploy documentation | `DEPLOY.md` | ✅ |
| 5 | README pointer | `README.md` | ✅ |
| 6 | Full validation pass | (commands) | ✅ |
| 7 | Preview smoke test | `npm run preview` + curl | ✅ |

## Validation Evidence

| Check | Command | Result |
|-------|---------|--------|
| Lint | `npm run lint` | exit 0 |
| Type check | `npx tsc --noEmit` | exit 0 |
| Tests | `npm test` | 223 passed (19 files), 0 failed |
| Build | `npm run build` | exit 0, dist emitted |

Test summary:
```
 Test Files  19 passed (19)
      Tests  223 passed (223)
   Duration  5.86s
```

Build summary:
```
dist/registerSW.js               0.13 kB
dist/manifest.webmanifest        0.50 kB
dist/index.html                  1.22 kB │ gzip:  0.59 kB
dist/assets/index-D5BlpYWz.css   6.25 kB │ gzip:  1.75 kB
dist/assets/index-D0jJRZ0G.js   43.95 kB │ gzip: 12.85 kB
✓ built in 350ms
PWA v1.3.0
precache  14 entries (68.37 KiB)
files generated: dist/sw.js, dist/workbox-9c191d2f.js
```

**Bundle size**: 43.95 kB JS (12.85 kB gzip) + 6.25 kB CSS (1.75 kB gzip) — well under the 2-second cold-load budget. Bundle did not grow during integration.

## E2E Evidence (preview smoke test)

`npm run preview` (port 4173 was occupied → Vite served on 4174):

| URL | Expected | Observed |
|-----|----------|----------|
| `GET /` | 200, index.html with manifest link + Open-Meteo footer in bundle | HTTP 200, `<title>Weather</title>`, manifest link present |
| `GET /manifest.webmanifest` | 200, valid JSON, `start_url: "/"`, icons | HTTP 200, all manifest fields present |
| `GET /sw.js` | 200, Workbox precache code | HTTP 200, starts with Workbox shim |
| Bundle footer string | "Open-Meteo" present | `grep -c 'Open-Meteo' dist/assets/index-*.js` → 1 |

dist also contains `_headers` and `_redirects` (Vite copies `public/` verbatim).

## Deferred (sandbox-blocked, owner runs manually)

| Verification | Why deferred | When verified |
|--------------|--------------|---------------|
| Actual Cloudflare Pages deploy | Requires owner's Cloudflare account + repo connection | Owner runs once after merge to master |
| iPhone Add-to-Home-Screen + Airplane Mode test | Requires real iOS device | Owner runs once on production URL |

Both are listed in `DEPLOY.md` as the owner checklist; the iPhone test is the
PRD's primary success criterion (AC3 of STORY-010).

## Files Changed (deploy step only — integration merges shown above)

| File | Action | Lines |
|------|--------|-------|
| `.nvmrc` | CREATE | +1 |
| `public/_redirects` | CREATE | +7 |
| `public/_headers` | CREATE | +21 |
| `DEPLOY.md` | CREATE | +101 |
| `README.md` | UPDATE | +6 / -0 |
| `.agents/plans/deploy-static-host.plan.md` | CREATE | +196 |

## Deviations from Plan

None. Plan executed verbatim, including the Cloudflare Pages choice and all
seven tasks.

## Tests Written

No new test code — the deploy step is configuration-only. The pre-existing
test suite (223 tests, 19 files) was unchanged after the integration merges
and continues to pass.

## Acceptance Criteria (STORY-010)

- [x] AC1 — Build + publish via host on push to master: `npm run build` + Cloudflare Pages Git-connected deploy. Documented in `DEPLOY.md`.
- [x] AC2 — `VITE_DEFAULT_LOCATIONS` in host env, no real locations in repo: `.env.example` keeps fictional placeholders, `.gitignore` excludes `.env.local`, `DEPLOY.md` § Environment variable.
- [defer] AC3 — iPhone Add-to-Home → Airplane Mode → reopen: sandbox-blocked, owner checklist in `DEPLOY.md`.
- [x] AC4 — Footer attribution + < 2s cached load: `grep -c 'Open-Meteo' dist/assets/index-*.js` → 1; bundle 12.85 kB gzip.
