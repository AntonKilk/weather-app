# Deploy

This is a personal, single-user offline-first PWA. Hosting is free static —
**Cloudflare Pages** is the chosen target.

## Why Cloudflare Pages

- Global edge by default (low first-byte from EU + iOS).
- Free tier has **no build-minute cap** (Netlify free is 300 min/month).
- Static-only deploys are trivial: build → `dist/`, no Functions, no server.
- Custom cache headers and SPA fallback via `public/_headers` and `public/_redirects` (already committed; Vite copies `public/` into `dist/` at build time).

If you ever switch to Netlify, the build settings below transfer 1:1; the
`_headers` / `_redirects` files are Cloudflare-flavoured but Netlify
understands the same filenames with very similar syntax.

## One-time setup

1. Push this repo to GitHub (already there: `AntonKilk/weather-app`).
2. Cloudflare dashboard → **Workers & Pages** → **Create application** → **Pages** → **Connect to Git** → pick the repo, the `master` branch.
3. Build settings:
   - Framework preset: **None**
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Root directory: (leave blank — repo root)
4. Node version: `.nvmrc` pins Node 22, and Cloudflare Pages reads it automatically. No env override needed.
5. **Environment variables** (Production scope): set `VITE_DEFAULT_LOCATIONS` — see next section.
6. Click **Save and Deploy**. First build takes ~1 minute.

After the first deploy, Cloudflare assigns a `*.pages.dev` URL. Every push to
`master` re-deploys automatically.

## Environment variable: `VITE_DEFAULT_LOCATIONS`

This is the **only** env var the app needs. Open-Meteo is keyless, so there
are no API tokens.

**Format**: a single-line JSON array of `{name, lat, lon}` objects. Same shape
as `.env.example` in the repo (which uses fictional placeholder values).

Set it in **Cloudflare Pages → Project → Settings → Environment variables →
Production**:

```
VITE_DEFAULT_LOCATIONS=[{"name":"City One","lat":0,"lon":0},{"name":"City Two","lat":0,"lon":0},{"name":"City Three","lat":0,"lon":0},{"name":"City Four","lat":0,"lon":0}]
```

Replace the fictional values with the four cities you actually want. **Never
commit real coordinates to git** — they only live in the Cloudflare dashboard
(per `CLAUDE.md` › Configuration).

After changing this variable, trigger a redeploy (Cloudflare → Deployments →
"Retry deployment") so the env value is baked into the new build.

## Local verification before pushing

Always run the full validation suite before pushing to `master` (per
`CLAUDE.md` › Validation):

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
```

Then preview the production build locally — this is the only way to exercise
the service worker (Vite dev server has SW disabled):

```bash
npm run preview
```

Smoke-check the three URLs that must return 200:

- `/` (index.html with the Open-Meteo footer attribution)
- `/manifest.webmanifest` (PWA install metadata)
- `/sw.js` (service worker)

## iPhone install checklist (owner-only)

Run this once after Cloudflare gives you the production URL:

1. Open Safari on iPhone, navigate to the `*.pages.dev` URL.
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Tap the new home-screen icon (must launch standalone, no Safari chrome).
4. Wait for all six slots to populate — they fetch in parallel.
5. Enable **Airplane Mode**.
6. Close the PWA (swipe up) and reopen it from the home screen.
7. **Expected**: all six slots still render the last-known forecast, with the
   "Updated N ago" stamp visible in the header. No "Unavailable" anywhere.
8. Disable Airplane Mode, reopen — slots refresh; stamp resets.

This satisfies AC3 of STORY-010 (and the PRD success criterion).

## What lives where

| Thing | Where |
|-------|-------|
| Source code | this repo |
| Build artifacts | `dist/` (gitignored — Cloudflare builds them) |
| Real default coordinates | Cloudflare Pages env var — **never** in git |
| Custom slots (per-user) | the iPhone's localStorage — never leaves the device |
| Weather data | Open-Meteo (keyless, CC-BY 4.0 — footer attribution required) |
