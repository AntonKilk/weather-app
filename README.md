# weather-app

Personal offline-first weather PWA for iPhone — 6 locations at a glance, last-known
forecast renders without network. See `CLAUDE.md` for engineering rules and
`.agents/PRDs/offline-weather-pwa.prd.md` for product requirements.

## Prerequisites

- Node.js >= 22.12 (or >= 20.19) — required by Vite 7

## Setup

```bash
npm install
```

## Development

```bash
npm run dev        # Vite dev server (no service worker)
npm run build      # tsc --noEmit && vite build (production build → dist/)
npm run preview    # serve the production build locally (use this to test PWA/offline)
```

Note: service workers don't run under `npm run dev` — test PWA/offline behavior
against `npm run preview` once Phase 3 introduces `vite-plugin-pwa`.

## Validation

Run before every commit:

```bash
npm run lint && npx tsc --noEmit && npm test
```

Individual commands:

```bash
npm run lint       # ESLint
npm test           # Vitest (run once)
npm run test:watch # Vitest watch mode
npm run format     # Prettier --write
```

## Configuration

Default locations are injected at build time from `VITE_DEFAULT_LOCATIONS` in
`.env.local` (gitignored) or the hosting provider's build env. Never commit real
locations to the repo. Wiring lands in a later story.

## Data source

Weather and geocoding via [Open-Meteo](https://open-meteo.com) — free, keyless,
CC-BY 4.0 (attribution required in the UI footer).

## Deploy

Free static hosting on Netlify (primary) or Cloudflare Pages (drop-in
alternative). The repo contains the config needed for either — the owner
connects the GitHub repo to the host once, sets the env var below, and every
push to `master` auto-deploys.

### One-time setup (owner, manual)

1. Sign in to Netlify (https://app.netlify.com) or Cloudflare Pages
   (https://pages.cloudflare.com).
2. "Add new site" → "Import from Git" → select this repo, branch `master`.
   Netlify reads `netlify.toml`. Cloudflare Pages: set **Build command**
   `npm run build`, **Output directory** `dist`, and **Node version env var**
   `NODE_VERSION=22` in the dashboard.
3. **Set the build environment variable** (in the hosting dashboard, NOT in
   this repo):
   - Key: `VITE_DEFAULT_LOCATIONS`
   - Value: JSON array, same shape as `.env.example`, with the real
     coordinates of the four default locations.
4. Trigger the first deploy (Netlify / Cloudflare does this automatically
   after step 2).

Repo files involved:

- `netlify.toml` — Netlify build command + publish dir + Node version.
- `public/_redirects` — SPA fallback for both hosts (`/* /index.html 200`).

### iPhone install + offline checklist (owner verifies after each deploy)

1. Open the deployed HTTPS URL in Safari on iPhone.
2. Tap Share → "Add to Home Screen" → confirm. App icon appears with the
   name "Weather".
3. Open the installed app. Wait for all six cards to load real forecasts
   (each card shows a "Updated just now" stamp).
4. Toggle airplane mode ON. Force-close the app. Re-open from the home
   screen.
5. Confirm: all six cards still render, each with its last "Updated N min
   ago" stamp; the footer link "Weather data by Open-Meteo" is visible; the
   cached screen paints in under 2 seconds.

The four steps above map directly to PRD success metrics (offline test,
time-to-weather < 2 s, CC-BY 4.0 attribution).
