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

Production hosts on Cloudflare Pages. See [`DEPLOY.md`](./DEPLOY.md) for build
settings, the `VITE_DEFAULT_LOCATIONS` env shape, and the iPhone install
checklist.
