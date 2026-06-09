# Plan: Deploy to free static hosting (STORY-010)

## Summary

Close Phase 5 — the last story in the PRD. Add the small amount of repo config
needed for one-click deploy to a free static host (Netlify primary, Cloudflare
Pages as drop-in alternative — both auto-build on `git push` to `master`):

- `public/_redirects` with a portable SPA fallback (`/* /index.html 200`) so a
  cold deep-link hit lands on the entry HTML before the service worker is
  installed. Works as-is on both Netlify and Cloudflare Pages.
- `netlify.toml` pinning `npm run build` as the build command, `dist` as the
  publish directory, and `NODE_VERSION = "22"` (Vite 7 requires Node ≥ 22.12 or
  ≥ 20.19 — repo README already says 22). One file; if the owner picks
  Cloudflare Pages instead, the equivalent settings live in the dashboard and
  the toml is simply ignored.
- README "Deploy" section documenting: (a) the two-host choice, (b) where to
  set `VITE_DEFAULT_LOCATIONS` in the hosting build env, (c) the owner's
  iPhone install + airplane-mode checklist (PRD success metric).
- An implementation report recording the deploy itself as a `defer-and-record`
  per CLAUDE.md (the orchestrator cannot connect the GitHub repo to a hosting
  account, set the env var in someone else's dashboard, or tap an iPhone) —
  the deliverables in this story are the repo-side prerequisites that make
  the owner's manual deploy a one-step action.

No source code changes. No new dependencies. `vite.config.ts` is NOT touched —
the PWA precache + `navigateFallback` already shipped in STORY-006, the
runtime cache shipped in STORY-007, the footer attribution shipped in
STORY-005. AC1, AC2 and AC4 are satisfied by repo config + existing build
output; AC3 is owner-manual by design (CLAUDE.md › Sandbox-blocked checks).

## User Story

As the owner, I want the app to auto-deploy to a free static host with the
default locations injected from the hosting env, so I can install the PWA on
my iPhone and use it daily — including offline (PRD success criterion).

## Metadata

| Field | Value |
|-------|-------|
| Type | NEW_CAPABILITY (deploy infrastructure) |
| Complexity | LOW (two config files + a README section + a manual checklist) |
| GitHub Issue | #10 (STORY-010) |
| PRD | `.agents/PRDs/offline-weather-pwa.prd.md` — Phase 5 "Deploy" |
| Stories | `.agents/stories/offline-weather-pwa.stories.md` → STORY-010 |
| Branch | `claude/kind-gauss-vudx0k` (per session instructions) |
| Blocked by | STORY-007 (SWR cache, merged), STORY-009 (custom slots, merged) |
| Blocks | — (final story; closes the PRD) |

---

## Patterns to follow

| Category | File:lines | Pattern |
|----------|-----------|---------|
| CONFIG LOCATION | `vite.config.ts` (root), `.env.example` (root), `.gitignore:11-14` | Build-time + deploy config lives at the repo root, NOT under `src/`. `.env.local` (real coords) stays gitignored. |
| ENV INJECTION | `src/locations/default-locations.ts` + `src/main.ts:39-47` | `VITE_DEFAULT_LOCATIONS` is read via `import.meta.env.VITE_DEFAULT_LOCATIONS`; `parseDefaultLocations` returns a discriminated-union result and main.ts shows an empty state on parse failure. The plan does NOT change this code — only documents where the env var must be set in the hosting dashboard. |
| SPA FALLBACK | `vite.config.ts:46` (Workbox `navigateFallback: '/index.html'`) | Already handles in-app navigation after the SW is installed. The host-level `_redirects` covers the FIRST hit (before SW installs) and any non-PWA browser. Two layers, one source of truth (`index.html`). |
| OBSERVABILITY (deploy) | `CLAUDE.md` › Observability | No analytics, no telemetry — the deploy story does not introduce any. The owner's primary signal remains the in-app "last updated" stamp (STORY-007). |
| SANDBOX-BLOCKED CHECKS | `CLAUDE.md` › Orchestration › "Sandbox-blocked checks (defer-and-record)" | Real deploys to Netlify/Cloudflare Pages and real-device iPhone tests are explicitly listed as defer-and-record. The plan treats them as deliverable documentation (README checklist + report row), NOT as task failures. |
| README STYLE | `README.md:1-54` | Plain prose + fenced bash blocks. No emoji. Mirror the existing "Setup" / "Development" / "Configuration" structure when adding "Deploy". |
| NAMING | `CLAUDE.md` › Code Patterns | New files: `netlify.toml` (the only name Netlify recognises), `public/_redirects` (the only name Netlify and Cloudflare Pages recognise — no extension, no underscore variants). |

(Greenfield deploy — no precedent for `netlify.toml` / `_redirects` in this
repo. Rows above pin the constraints the new files must respect.)

---

## Architecture (locked decisions)

### Hosting choice: Netlify primary, Cloudflare Pages alternative (owner picks)

The PRD says "Netlify / Cloudflare Pages" — both qualify. The plan ships a
config that works on both with zero divergence:

- **Netlify**: reads `netlify.toml` from repo root → uses pinned build
  command + publish dir + Node version. Reads `public/_redirects` (copied
  to `dist/_redirects` at build time) for SPA fallback.
- **Cloudflare Pages**: ignores `netlify.toml`; build command / publish dir /
  Node version are set once in the dashboard (owner does this manually).
  Reads `_redirects` from the publish dir for SPA fallback — identical
  syntax to Netlify.

Owner is free to switch hosts later without touching the repo. README
documents both flows.

### Build runs on the host, NOT in GitHub Actions

PRD AC1: "push to master → CI/hosting builds → published to HTTPS URL
automatically." The simplest path is the hosting provider's built-in
git-triggered build (Netlify/Cloudflare both ship this). No `.github/workflows/`
file is created — adding GitHub Actions would just duplicate the work the
host already does, complicate secrets management for `VITE_DEFAULT_LOCATIONS`,
and require a separate deploy step. Single-source-of-truth: the host owns
the build.

If the owner ever wants pre-deploy CI gates (lint, typecheck, tests on PR),
that's a separate ticket — out of scope for STORY-010.

### `public/_redirects` is the SPA-fallback source of truth

Both Netlify and Cloudflare Pages auto-copy files from `public/` to the
publish dir at build time (Vite default behaviour) AND both recognise
`/* /index.html 200` rules in a root-level `_redirects` file. One file,
two hosts. Avoids the Netlify-only `[[redirects]]` block in `netlify.toml`
that wouldn't apply on Cloudflare.

Caveat: `_redirects` rules apply only to navigations that miss a built
asset (Netlify/Cloudflare check static files first). The PWA's hashed
assets in `/assets/*` keep serving directly; the rule only fires for
deep-link navigations (e.g. someone shares `https://app/whatever`) →
returns `index.html` with 200 (NOT 301/302) so the URL bar is preserved.

### Env var injection is build-time, NOT runtime

Vite inlines `import.meta.env.VITE_DEFAULT_LOCATIONS` at build time. The
owner sets `VITE_DEFAULT_LOCATIONS` once in the hosting dashboard before
the first deploy; subsequent pushes rebuild with the same value automatically.
PRD acknowledges this as "public-by-URL — accepted trade-off."

If `VITE_DEFAULT_LOCATIONS` is missing or malformed at build time,
`parseDefaultLocations` returns a parse error at runtime and main.ts
renders the "No default locations configured." empty state
(`src/main.ts:42-47`). This is the existing, tested fallback — the deploy
plan inherits it; no new error path needed.

### No security headers in this story

Headers (CSP, HSTS, X-Frame-Options) are out of scope. The PRD doesn't
require them; the app has no auth, no secrets, no third-party embeds (Open-
Meteo footer link is just `<a target="_blank">`). Both hosts ship sensible
defaults (HSTS on the apex, TLS auto-renewal). Adding `_headers` /
`[[headers]]` blocks now would be over-engineering — see CLAUDE.md
"Don't add features…beyond what the task requires." Future ticket if needed.

### Owner-manual steps are documented, not automated

The orchestrator cannot:
- Connect the GitHub repo to a Netlify/Cloudflare Pages account (auth flow
  + dashboard).
- Set `VITE_DEFAULT_LOCATIONS` in the hosting build env (the actual values
  must NEVER touch this repo — that's STORY-005's whole point).
- Tap "Add to Home Screen" on an iPhone, then toggle airplane mode, then
  re-open the app.

These are listed in CLAUDE.md › Sandbox-blocked checks as "defer-and-record"
and treated as documentation deliverables: the README has a step-by-step
checklist; the implementation report records the deploy as DEFERRED — owner.

---

## Files to change

| File | Action | Purpose |
|------|--------|---------|
| `public/_redirects` | CREATE | Portable SPA fallback for Netlify + Cloudflare Pages. One rule: `/* /index.html 200`. |
| `netlify.toml` | CREATE | Pin Netlify build command (`npm run build`), publish dir (`dist`), Node version (`22`). One `[build]` table. |
| `README.md` | UPDATE | Add a "Deploy" section: provider choice, env-var-in-dashboard reminder, iPhone owner checklist. |
| `.agents/reports/deploy-free-static-hosting-report.md` | CREATE (during `/implement`) | Implementation report mirroring `.agents/reports/custom-slots-add-remove-persist-report.md`. Includes the defer-and-record entries for the actual deploy + iPhone test. |

**Not touched** (deliberate):

- `vite.config.ts` — PWA manifest, Workbox precache, `navigateFallback`,
  `globPatterns`, and the runtime-cache route are all already correct
  for production. No build-mode change. Confirms the hotspot is untouched
  even though this story closes Phase 5.
- `package.json` / `package-lock.json` — no new deps.
- `src/**/*` — zero source changes; the production build that the host will
  run is the same code that's already on `master`.
- `.env.example` — already has the correct `VITE_DEFAULT_LOCATIONS` sample
  and the warning comment. No change.
- `.gitignore` — already excludes `.env.local`. No change.
- `index.html` — Apple meta tags + manifest auto-injection by
  `vite-plugin-pwa` are already correct.
- `.github/workflows/` — explicitly NOT created (see "Architecture" above).

Counts: **3 CREATE files** (2 deploy config + 1 report), **1 UPDATE file**
(README), **0 source files touched**, **0 DELETE**.

---

## Tasks

Execute in order. Each task is atomic and verifiable.

### Task 0: Verify shipping invariants (defensive lookup)

- **Action**: Read-only checks before adding deploy config.
- **Checks** (Grep / Read / Bash):
  - `Grep` for `"name":` in `src/` and root-level files → confirm no real
    coords / location names leaked (the four default locations must be
    absent from anything tracked by git). Run `git grep -nE 'Lahti|Helsinki|Tallinn|Käsmu|Kasmu'` — expect zero matches outside the
    PRD / CLAUDE.md / `.agents/stories/`. (Those docs reference the
    locations as examples; they are NOT machine-readable defaults.)
  - `Read` `vite.config.ts` → confirm `navigateFallback: '/index.html'`
    is on line 46 (do NOT modify).
  - `Read` `src/ui/footer.ts:5-18` → confirm CC-BY 4.0 attribution still
    renders (AC4).
  - `Read` `.env.example` → confirm the file exists with the
    `VITE_DEFAULT_LOCATIONS` sample (AC2 documentation).
  - Bash: `npm run build` → confirm `dist/index.html`,
    `dist/manifest.webmanifest`, `dist/sw.js` (or `dist/registerSW.js`),
    `dist/assets/*` all generated; bundle JS+CSS combined < 100 kB
    (STORY-009 report logged 40.93 kB JS / 5.71 kB CSS — leave generous
    headroom).
  - Bash: `ls dist/` → confirm what the host will publish.
- **Validate**: every check returns as expected; if `npm run build` fails or
  `git grep` surfaces real coords, STOP and re-plan.

### Task 1: Create `public/_redirects`

- **File**: `public/_redirects`
- **Action**: CREATE
- **Implement**: a single line, then a trailing newline:
  ```
  /*  /index.html  200
  ```
  - Two spaces between fields is the Netlify-recommended convention; a
    single space also works on both hosts (parser is whitespace-tolerant).
  - `200` (not `301`/`302`) preserves the URL bar — required for SPA
    fallback semantics.
  - No comments allowed in `_redirects` (Netlify parser rejects `#` lines
    on some legacy versions); keep the file to one rule.
- **Why under `public/`**: Vite copies `public/*` verbatim to `dist/` at
  build time (Vite default). Netlify's docs accept either a root-level
  `_redirects` OR one in the publish dir; the latter is portable to
  Cloudflare Pages, which ONLY reads from the publish dir. Single file,
  two hosts.
- **Mirror**: N/A — first deploy-config file in the repo. Format is
  pinned by Netlify's documented `_redirects` spec.
- **Validate**:
  - `Read public/_redirects` → exactly one rule, exact format.
  - `npm run build && ls dist/_redirects` → file is in the publish output.

### Task 2: Create `netlify.toml`

- **File**: `netlify.toml` (repo root — Netlify only reads from there)
- **Action**: CREATE
- **Implement**:
  ```toml
  # Netlify build config for the offline weather PWA.
  # Cloudflare Pages users: ignore this file and set the same values
  # (build command, publish directory, NODE_VERSION) in the dashboard.
  # VITE_DEFAULT_LOCATIONS must be set in the hosting build env — never here.

  [build]
    command = "npm run build"
    publish = "dist"

  [build.environment]
    NODE_VERSION = "22"
  ```
  - `command = "npm run build"` matches `package.json:9` (`tsc --noEmit &&
    vite build`) — type-checks before publishing, matching the local
    validation pipeline.
  - `publish = "dist"` is the Vite 7 default output dir.
  - `NODE_VERSION = "22"` matches the README requirement (`>= 22.12`); the
    Netlify image will pick the latest 22.x LTS at build time.
  - SPA redirect is NOT inlined here as `[[redirects]]` — that block is
    Netlify-only. `public/_redirects` (Task 1) is the portable source of
    truth.
  - `VITE_DEFAULT_LOCATIONS` is explicitly NOT in `[build.environment]` —
    putting it here would commit the real coords (the exact thing
    STORY-005 + AC2 forbid). The README (Task 3) tells the owner to set
    it in the dashboard.
  - The two comment lines at the top are the ONLY commentary; this file
    is a deploy contract, comments justify the non-obvious "why not here"
    decisions per CLAUDE.md › "Default to writing no comments. Only add
    one when the WHY is non-obvious."
- **Mirror**: N/A — Netlify's documented `netlify.toml` schema is the
  contract; the file is minimal by design.
- **Validate**:
  - `Read netlify.toml` → exact content matches above.
  - The file does NOT contain any of: `VITE_DEFAULT_LOCATIONS`, real
    location names, lat/lon numbers, secrets. (`git grep -nE
    'VITE_DEFAULT_LOCATIONS|Lahti|Helsinki|Tallinn|Käsmu' netlify.toml` →
    no matches.)

### Task 3: Update `README.md` — Deploy section + iPhone checklist

- **File**: `README.md`
- **Action**: UPDATE
- **Implement**: append a new section after the existing "Data source"
  block (after line 54). New section structure mirrors the existing
  "Setup" / "Development" / "Configuration" headings:

  ```markdown
  ## Deploy

  Free static hosting on Netlify (primary) or Cloudflare Pages
  (drop-in alternative). The repo contains the config needed for either —
  the owner connects the GitHub repo to the host once, sets the env var
  below, and every push to `master` auto-deploys.

  ### One-time setup (owner, manual)

  1. Sign in to Netlify (https://app.netlify.com) or Cloudflare Pages
     (https://pages.cloudflare.com).
  2. "Add new site" → "Import from Git" → select this repo, branch
     `master`. Netlify reads `netlify.toml`; Cloudflare Pages: set
     **Build command** `npm run build`, **Output directory** `dist`,
     **Node version env var** `NODE_VERSION=22` in the dashboard.
  3. **Set the build environment variable** (in the hosting dashboard, NOT
     in this repo):
     - Key: `VITE_DEFAULT_LOCATIONS`
     - Value: JSON array, same shape as `.env.example`, with the real
       coordinates of the four default locations.
  4. Trigger the first deploy (Netlify / Cloudflare does this
     automatically after step 2).

  Repo files involved:

  - `netlify.toml` — Netlify build command + publish dir + Node version
  - `public/_redirects` — SPA fallback for both hosts

  ### iPhone install + offline checklist (owner verifies after each deploy)

  1. Open the deployed HTTPS URL in Safari on iPhone.
  2. Tap Share → "Add to Home Screen" → confirm. App icon appears with
     the name "Weather".
  3. Open the installed app. Wait for all six cards to load real
     forecasts (each card shows a "Updated just now" stamp).
  4. Toggle airplane mode ON. Force-close the app. Re-open from the home
     screen.
  5. Confirm: all six cards still render, each with its last "Updated N
     min ago" stamp; the footer link "Weather data by Open-Meteo" is
     visible; the cached screen paints in under 2 seconds.

  The four steps above map directly to PRD success metrics (offline test,
  time-to-weather < 2 s, CC-BY 4.0 attribution).
  ```

- **Why prose mirrors existing sections**: the README is the only English-
  language doc the owner reads; CLAUDE.md is for the agent. Keep voice +
  fence style consistent (no emoji, no headers above h2 inside the
  section, plain bash blocks where commands appear).
- **What this section does NOT say**:
  - Does NOT name a specific hosting URL — the owner picks it.
  - Does NOT list real coordinates — they live in the hosting dashboard
    only.
  - Does NOT promise PWA installability on non-iOS clients — the PRD
    scope is iPhone.
- **Mirror**: `README.md:30-43` ("Validation" section) for fence + bullet
  style; `README.md:45-49` ("Configuration") for the "set this in the
  hosting env, never in the repo" framing.
- **Validate**:
  - `Read README.md` → new "Deploy" section reads cleanly, no broken
    Markdown.
  - `npm run lint` → repository's linter does not lint Markdown; if any
    accidental code-block typo broke a fence, manual proofread catches
    it.

### Task 4: Full validation

- **Implement**:
  1. `npm run lint && npx tsc --noEmit && npm test` — every command
     exits 0 (CLAUDE.md › Validation). Zero source code changed, so this
     is a regression check, not a new-code check.
  2. `npm run build` — exits 0; `dist/` contains `index.html`,
     `manifest.webmanifest`, `assets/*`, `sw.js` (or generated SW name),
     AND `_redirects` (copied from `public/_redirects`). Confirm the
     final JS bundle is still ~40 kB (no regression from STORY-009's
     baseline).
  3. `npm run preview` (background, port 4173) + `curl
     http://127.0.0.1:4173/whatever-deep-link` → the preview server may
     NOT mirror Netlify's SPA fallback (`vite preview` is its own
     thing); the important assertion is that the BUILT `dist/_redirects`
     file exists and contains `/*  /index.html  200`. The host applies
     the rule at edge — the preview server is not a deploy stand-in.
  4. **Sandbox-blocked checks (record, do NOT fail on)**:
     - Actual `git push origin master` → host webhook → live deploy.
     - Setting `VITE_DEFAULT_LOCATIONS` in the hosting dashboard.
     - iPhone Add-to-Home-Screen + airplane mode test (the four steps in
       the README checklist).
     - Lighthouse PWA audit on the live URL.
- **Validate**: lint + typecheck + test + build all exit 0; the four
  defer-and-record items are written to the implementation report (Task
  5) under a clearly-marked "DEFERRED — owner" section, NOT counted as
  failures.

### Task 5: Implementation report

- **File**: `.agents/reports/deploy-free-static-hosting-report.md`
- **Action**: CREATE
- **Implement**: mirror the structure of
  `.agents/reports/custom-slots-add-remove-persist-report.md`:
  - Header (Plan / Branch / Issue / Status).
  - Summary (one paragraph).
  - Tasks Completed table.
  - Validation Evidence (commands + outputs from Task 4).
  - Acceptance Criteria Mapping (every AC → file + evidence row).
  - Files Changed (3 created, 1 updated, 0 source changes).
  - Sandbox-blocked items: the four DEFERRED — owner rows from Task 4.
  - Independent Verification: leave the slot for the verifier round (it
    is filled in during the verify pass, not by this plan).
- **Mirror**: `.agents/reports/custom-slots-add-remove-persist-report.md`
  for the section ordering and tone.
- **Validate**: file exists at the expected path; AC mapping table is
  complete (4 ACs → at least one file:line OR DEFERRED row each).

---

## Risks

| Risk | Mitigation |
|------|------------|
| Owner picks Cloudflare Pages and forgets to set `NODE_VERSION=22` in the dashboard → build runs on default Node, may break Vite 7 | README Task 3 step 2 explicitly calls out the `NODE_VERSION=22` env var for Cloudflare Pages. The `netlify.toml` pins it for Netlify; Cloudflare must be done in the dashboard (no `cloudflare.toml` exists). |
| `VITE_DEFAULT_LOCATIONS` is forgotten in the hosting dashboard → first deploy renders the "No default locations configured." empty state | Existing behaviour (`src/main.ts:42-47`); not a regression. README step 3 emphasises this. The empty state is a graceful fail, not a crash. |
| `_redirects` syntax change breaks future deploys | The rule format is stable across Netlify versions (documented since 2017). Cloudflare Pages adopted the same syntax verbatim. Risk is ~zero in the personal-app horizon. |
| Building on the host uses a different Node minor than the developer's machine, surfaces a tsc/Vite incompatibility | `NODE_VERSION = "22"` pin in `netlify.toml`; README mirrors the requirement. Local dev uses the same line per README. Cloudflare requires the same dashboard setting. |
| The owner's iPhone has Safari version with quirks (e.g. no storage for non-installed PWAs) | PRD already flags iOS storage eviction as an open question; the README checklist puts the install step BEFORE the offline test specifically because installed PWAs are largely exempt. If the test fails, it's product feedback, not a deploy bug. |
| `npm run build` runs `tsc --noEmit` first — if hosting Node has older TypeScript via a stale lockfile, build fails on the host | `npm ci` (the default on Netlify/Cloudflare) installs from `package-lock.json`, pinning `typescript@^5.6.3`. No risk if lockfile is committed (it is — `package-lock.json` is tracked). |
| Real default-location coords leak via a future README edit or commit | `.gitignore` already excludes `.env*` files. Task 0 includes a `git grep` to confirm no leak. The README explicitly says "value: …" without listing real values. |
| Hosting provider rate-limits the build, causing flaky deploys | Both providers offer generous free-tier build minutes (Netlify 300 min/month; Cloudflare 500 builds/month) — comfortably above this project's expected push frequency. |
| Service worker from an old deploy serves stale assets after a new deploy | `vite.config.ts:51-52` enables `skipWaiting: true` and `clientsClaim: true` — new SW takes over immediately on next page load. STORY-006 territory; deploy story inherits the correct behaviour. |
| Adding `netlify.toml` accidentally enables Netlify-specific behaviours (e.g. snippet injection, form detection) on Cloudflare | Both features require explicit opt-in via the toml; the file contains only `[build]` + `[build.environment]`. Nothing implicit. |
| AC1 ("push to master → published automatically") is not testable in this session | Defer-and-record: the connection step is owner-only. The plan ships the repo-side prerequisites; the owner verifies the URL appears in their hosting dashboard. Report row documents this honestly. |

---

## Validation

Run before declaring done — exact commands from CLAUDE.md › Commands /
Validation:

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
```

Plus a build-output assertion (no source changed, but the new `_redirects`
file must reach `dist/`):

```bash
test -f dist/_redirects && grep -q '/\*' dist/_redirects
```

Deferred (CLAUDE.md › Sandbox-blocked checks — recorded, NOT failed):

- `git push origin master` → Netlify/Cloudflare webhook → live deploy.
- Setting `VITE_DEFAULT_LOCATIONS` in the hosting dashboard.
- iPhone Add-to-Home-Screen → wait for data → airplane mode → re-open
  (the four-step README checklist).
- Lighthouse PWA audit on the live URL.

---

## Acceptance criteria

Issue #10 ACs → tasks/tests mapping (every AC maps to ≥ 1 task or a
recorded DEFERRED — owner row):

- [ ] **AC1** — Given push to `master`, when CI/hosting builds, then the
      prod build publishes on an HTTPS URL automatically.
      → Tasks 1 + 2 ship the repo-side build contract (`netlify.toml` +
      `public/_redirects`); the actual GitHub-to-host connection and the
      first deploy are DEFERRED — owner (Task 5 report row).
- [ ] **AC2** — Given hosting settings, when I inspect the config, then
      `VITE_DEFAULT_LOCATIONS` is set in the host env and no real
      locations are in the repo.
      → Task 0 (git grep proves no leaked coords); Task 2 (`netlify.toml`
      deliberately omits the env var); Task 3 README step 3 documents
      the dashboard-only path; existing `.gitignore` + `.env.example`
      enforce the repo-side half.
- [ ] **AC3** — Given the prod URL on iPhone, when I run the owner
      checklist (Add to Home Screen → open → wait for data → airplane
      mode → re-open), then all slots render offline with the freshness
      stamp.
      → Task 3 README "iPhone install + offline checklist" documents the
      exact four steps. Execution is DEFERRED — owner (Task 5 report
      row). The underlying capability is delivered by STORY-006 (PWA
      install) + STORY-007 (SWR cache + freshness stamp) + STORY-009
      (custom slots persisted).
- [ ] **AC4** — Given the prod build, when I open the app, then the
      Open-Meteo footer attribution is present and the cached screen
      loads in < 2 s.
      → Footer attribution: existing `src/ui/footer.ts:5-18` (verified
      in Task 0); the prod build inherits it unchanged. < 2 s cached
      load: existing STORY-007 SWR cache + STORY-006 Workbox precache;
      the measurement on the live URL is DEFERRED — owner (Task 5
      report row).

Process gates:

- [ ] All tasks completed
- [ ] `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build` all
      pass
- [ ] No new runtime dependencies (`package.json` `dependencies` stays
      empty)
- [ ] No source code changes in `src/**` (verify via `git diff master --
      src/`)
- [ ] `vite.config.ts` untouched (hotspot — confirm via `git diff master
      -- vite.config.ts`)
- [ ] `public/_redirects` exists, contains `/*  /index.html  200`, AND is
      copied to `dist/_redirects` by `vite build`
- [ ] `netlify.toml` exists, contains exactly `[build]` (command +
      publish) + `[build.environment]` (NODE_VERSION = "22"); does NOT
      contain `VITE_DEFAULT_LOCATIONS`, location names, lat/lon
- [ ] README has a "Deploy" section with: (a) provider choice, (b)
      env-var-in-dashboard instruction, (c) iPhone owner checklist
- [ ] No real default-location coordinates appear in any tracked file
      (re-run Task 0's `git grep`)
- [ ] Sandbox-blocked checks (deploy, env-var-in-dashboard, iPhone test,
      Lighthouse) recorded in the implementation report as DEFERRED —
      owner, NOT treated as failures
- [ ] Issue #10 acceptance criteria → tasks/tests mapping above is
      complete (every AC has ≥ 1 task or one explicit DEFERRED — owner
      row)
