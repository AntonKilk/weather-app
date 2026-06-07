# Plan: Deploy to free static hosting (STORY-010)

## Summary

Ship the offline weather PWA on a free static host. Two phases are covered:
(A) integrate all prior story branches (#3, #6, #7, #8/9) onto a single branch
so the app actually runs end-to-end; (B) add the host-config + docs so the
owner can connect the GitHub repo to **Cloudflare Pages** and deploy from
master. No real coordinates leak — `VITE_DEFAULT_LOCATIONS` is configured in
the host's env, never committed.

## User Story

As the owner of the weather PWA
I want master to auto-deploy to a free static host
So that I can install the PWA on my iPhone from a stable HTTPS URL and use it daily

## Metadata

| Field | Value |
|-------|-------|
| Type | NEW_CAPABILITY (deploy / ops) |
| Complexity | LOW |
| Systems Affected | repo root (host config + docs), `public/` (Cloudflare headers/redirects) |
| GitHub Issue | #10 |

---

## Decision: Cloudflare Pages over Netlify

Both meet the AC. Cloudflare Pages is chosen because:

- Global edge CDN by default (low first-byte from EU + iOS).
- **No build-minute cap on the free tier** (Netlify free has a 300 min/month limit).
- Static-only deploys are trivial: `npm run build` → `dist/` is the publish dir.
- Service workers + custom headers via `public/_headers` (works with Vite static copy).
- Connecting the GitHub repo and setting `VITE_DEFAULT_LOCATIONS` in dashboard env is the only manual step the owner does.

`netlify.toml` is **not** added; we use Cloudflare's convention (publish settings + `_headers`/`_redirects` files). This keeps the repo single-host so there's no ambiguity about which one is authoritative.

---

## Patterns to Follow

### Architecture rule (CLAUDE.md)

> No backend, no database, no Docker. Deploy target: free static hosting (Netlify / Cloudflare Pages).

We respect this — only static config files are added.

### Secrets / env handling

```text
// SOURCE: .env.example:14-17
# The placeholders below are intentionally fictional — DO NOT commit your real
# coordinates anywhere in the repository.
VITE_DEFAULT_LOCATIONS=[{"name":"City One","lat":0,"lon":0}, ...]
```

The deploy doc uses the same fictional shape, and the env var is set in the
Cloudflare Pages dashboard (build env), never in the repo.

### Headers (PWA + SW)

Service worker file (`/sw.js`) must NOT be long-cached or the user is stuck
on an old version; the docs explicitly say `clientsClaim: true` + `autoUpdate`
(vite.config.ts:23, :44). We pin `Cache-Control: no-cache` on `/sw.js` and
`/manifest.webmanifest` so updates take effect on next reload; immutable
assets (`/assets/*`) get the standard 1-year immutable cache.

---

## Files to Change

| File | Action | Purpose |
|------|--------|---------|
| `public/_headers` | CREATE | Cloudflare Pages: cache rules for SW + immutable assets |
| `public/_redirects` | CREATE | SPA-style fallback `/* /index.html 200` (defensive — no client routing today, but safe) |
| `.nvmrc` | CREATE | Pin Node 22 for the Pages build (matches local + README) |
| `DEPLOY.md` | CREATE | Owner-facing deploy instructions (build cmd, output dir, env var, iPhone checklist) |
| `README.md` | UPDATE | Link to DEPLOY.md so the owner finds it from the repo root |

No source files are modified for the deploy step itself. The integration of
the prior story branches is already committed (two integration commits on
this branch).

---

## Tasks

Execute in order.

### Task 1: Pin Node version for the host

- **File**: `.nvmrc`
- **Action**: CREATE
- **Implement**: write `22` (single line). Cloudflare Pages picks this up automatically; matches the >= 22.12 requirement in `README.md:9`.
- **Validate**: `cat .nvmrc` shows `22`.

### Task 2: Cloudflare Pages SPA fallback

- **File**: `public/_redirects`
- **Action**: CREATE
- **Implement**: one line: `/*    /index.html   200`. The app has no client router today, but a stray PWA-Add-to-Home-Screen URL or a manual deep link must not 404. `public/` is copied verbatim into `dist/` by Vite.
- **Validate**: after `npm run build`, `dist/_redirects` exists.

### Task 3: Cloudflare Pages cache headers

- **File**: `public/_headers`
- **Action**: CREATE
- **Implement**: three rules:
  - `/sw.js` → `Cache-Control: no-cache` (Workbox `clientsClaim` + autoUpdate need a fresh SW on every reload).
  - `/manifest.webmanifest` → `Cache-Control: no-cache` (install metadata must be current).
  - `/assets/*` → `Cache-Control: public, max-age=31536000, immutable` (Vite emits hashed filenames).
- **Validate**: after `npm run build`, `dist/_headers` exists.

### Task 4: Deploy documentation

- **File**: `DEPLOY.md`
- **Action**: CREATE
- **Implement**: owner-facing doc with sections:
  - **Why Cloudflare Pages** (1 paragraph)
  - **One-time setup** (connect repo → Pages project → set framework "None" / build `npm run build` / output `dist`)
  - **Environment variable**: `VITE_DEFAULT_LOCATIONS` — paste the JSON shape from `.env.example` with the same fictional placeholder values; emphasise that real coordinates ONLY live in the dashboard, never in git.
  - **Node version**: explain `.nvmrc` already pins it.
  - **Verifying the deploy locally** (`npm run build && npm run preview`; curl `/`, `/manifest.webmanifest`, `/sw.js`).
  - **iPhone install checklist** (Safari → Share → Add to Home Screen → open from home screen → wait for data → Airplane Mode → reopen → all slots render with freshness stamp).
  - **What's NOT committed**: the env var. Re-emphasise.
- **Validate**: file exists, mentions `VITE_DEFAULT_LOCATIONS`, `npm run build`, `dist`, `Add to Home Screen`, `Open-Meteo`.

### Task 5: README pointer

- **File**: `README.md`
- **Action**: UPDATE
- **Implement**: add a `## Deploy` section near the end pointing to `DEPLOY.md`. One-line per CLAUDE.md style.
- **Validate**: `grep DEPLOY.md README.md`.

### Task 6: Full validation pass

- **Action**: run all four checks from `CLAUDE.md` › Validation
- **Validate**:
  ```bash
  npm run lint && npx tsc --noEmit && npm test && npm run build
  ```
  All four must pass. The build must still emit `dist/sw.js`, `dist/manifest.webmanifest`, `dist/index.html`. Also assert `dist/_headers` and `dist/_redirects` are present (copied from `public/`).

### Task 7: Preview smoke test

- **Action**: `npm run preview` in background; curl the three URLs.
- **Validate**: HTTP 200 on `/`, `/manifest.webmanifest`, `/sw.js`. The HTML contains the Open-Meteo footer string (already produced by the UI; assertion guards against accidental removal).

---

## Validation

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
```

Plus the preview smoke test (Task 7).

---

## Environment & Verification

| Verification | Runs in env? | If blocked: where/when verified |
|--------------|--------------|---------------------------------|
| lint + tsc + vitest + build | yes | — |
| `npm run preview` + curl `/`, `/manifest.webmanifest`, `/sw.js` | yes | — |
| Actual deploy to Cloudflare Pages | **no** (defer-and-record) | owner runs manually after merge |
| iPhone PWA install + airplane-mode offline check | **no** (sandbox-blocked) | owner runs manually on device |

---

## Risks

| Risk | Mitigation |
|------|------------|
| Owner picks Netlify instead | Both hosts work. Cloudflare's `_headers`/`_redirects` would be ignored by Netlify, but they don't hurt; for Netlify the owner can copy the build cmd + env from `DEPLOY.md` and the headers map cleanly. Document that the host config is Cloudflare-flavoured. |
| SW caching too aggressively | `_headers` pins `no-cache` on `/sw.js` + `/manifest.webmanifest`. |
| Build picks wrong Node version | `.nvmrc` pins major 22 (matches `README.md:9` requirement). |
| Bundle balloons during deploy task | Deploy adds zero JS — only static text files. Bundle size is recorded in the report after the merges. |

---

## Acceptance Criteria

- [ ] All tasks completed
- [ ] Lint passes
- [ ] tsc --noEmit passes
- [ ] Tests pass (post-integration, all 223)
- [ ] Build produces `dist/` with `index.html`, `sw.js`, `manifest.webmanifest`, `_headers`, `_redirects`
- [ ] Preview responds 200 on `/`, `/manifest.webmanifest`, `/sw.js`
- [ ] `DEPLOY.md` covers build cmd, output dir, env var, Node version, iPhone install checklist
- [ ] No real coordinates anywhere in the repo
- [ ] Environment-blocked verifications recorded as defer-and-record (actual deploy + iPhone test)
