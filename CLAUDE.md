# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Personal offline-first weather PWA for iPhone. Shows current conditions, hourly temperature/precipitation (2–3h steps) and a 7-day forecast for 6 location slots: 4 defaults (Lahti, Helsinki, Tallinn, Käsmu — injected at build time from env vars) + 2 custom slots with geocoding autocomplete. Replaces googling the weather 3–6×/day; last fetched data must always render offline. UI language: English. Single user, no accounts, no ads.

Full requirements: `.agents/PRDs/offline-weather-pwa.prd.md` (all key decisions resolved there).

**Status: greenfield.** Phase 1 scaffolds the project; until then the commands below describe the intended setup.

---

## Tech Stack

| Technology | Purpose |
|------------|---------|
| TypeScript (strict) | All source code — compiler is the first reviewer; no `any` unless unavoidable |
| Vite + vite-plugin-pwa | Build tool, dev server, service worker + manifest generation |
| Vanilla DOM (no framework) | 2-screen UI doesn't justify a framework; keep the bundle tiny |
| Hand-rolled SVG | Hourly temperature curve (Google-widget style) — no chart library |
| Vitest | Unit tests |
| ESLint + Prettier | Lint and formatting |
| Open-Meteo API | Weather + geocoding. Free non-commercial, **no API key**. CC-BY 4.0 → footer attribution required |

No backend, no database, no Docker. Deploy target: free static hosting (Netlify / Cloudflare Pages).

---

## Commands

```bash
npm run dev        # Vite dev server
npm run build      # tsc --noEmit && vite build
npm run preview    # serve the production build locally (needed to test the service worker)
npm test           # vitest run
npm run lint       # eslint .
```

Note: service workers don't run under `npm run dev` — test PWA/offline behavior against `npm run preview`.

---

## Validation

Run before every commit:

```bash
npm run lint && npx tsc --noEmit && npm test
```

---

## Architecture

Group by domain feature, not by technical layer. Dependency direction: ui → app services → api/storage → domain types. Never reverse — `weather/` domain types must not import from `ui/` or know about fetch/IndexedDB.

```
src/
├── weather/      # domain: forecast types, Open-Meteo client, WMO weather-code → icon mapping
├── locations/    # domain: default slots (from env), custom slots, geocoding autocomplete
├── storage/      # on-device cache + stale-while-revalidate orchestration
├── ui/           # DOM rendering, SVG chart, styles
├── main.ts       # entry point: wiring only
└── sw.ts         # service worker (via vite-plugin-pwa), if custom logic needed
public/           # PWA icons, static assets
```

### Core data flow (stale-while-revalidate)

1. App opens → render cached forecasts immediately (works offline) with a "last updated" stamp.
2. If online → fetch all slots from Open-Meteo in parallel → update cache → re-render.
3. `visibilitychange` → if data older than ~30 min, refresh.

There is **no scheduled background fetch** — iOS PWAs can't do it. Freshness = last open with network. Don't try to add background sync; it will silently not work on iPhone.

### Configuration

- Default locations: `VITE_DEFAULT_LOCATIONS` env var (JSON: `[{"name":"Lahti","lat":60.98,"lon":25.66},...]`), set in `.env.local` (gitignored) and in the hosting provider's build env. **Never commit real locations to the repo.**
- Custom slots: persisted on-device (localStorage/IndexedDB), never leave the phone.

---

## Code Patterns

### Naming
- Files: kebab-case (`open-meteo-client.ts`); types/interfaces: PascalCase; functions/vars: camelCase.
- Name after the domain concept, not the technology: `ForecastCache`, not `IndexedDbHelper`.

### Error handling
- API client returns typed results; UI must distinguish "offline, showing stale data" (normal state, show stamp) from "no data at all for this slot" (error state).
- Never let one failed location slot break rendering of the others.
- Don't show raw error messages/stack traces in the UI; log to console, render a friendly state.

### Types
- Model the Open-Meteo response shape explicitly (`hourly`, `daily`, `current` — see PRD spike for exact fields). Validate/narrow at the API boundary; everything past `weather/` types is trusted.

---

## Testing

- **Run**: `npm test` (Vitest)
- **Location**: co-located `*.test.ts` next to source
- **Focus**: domain logic (WMO code mapping, staleness calculation, cache merge, geocoding result handling) — not DOM snapshots. Mock `fetch` with recorded Open-Meteo fixtures.

---

## Validate Before Implementing

### External integrations and data sources
Never write code for an integration without completing this checklist:
1. **Data is accessible** — get a real response (curl / browser / Postman). Confirm the needed data is present without extra steps.
2. **Authorization** — does it require an API key, registration, B2B agreement, or paid plan? If yes — stop and confirm with the owner before writing any code.
3. **Still works** — verify the endpoint/version is live right now. Unofficial APIs and versioned endpoints disappear without warning.
4. **Fields are parseable** — confirm that the required fields (price, date, ID, etc.) are actually in the response and can be extracted.

Open-Meteo was spike-verified 2026-06-07 (endpoints, fields, limits — see PRD). Re-verify with a live call if a new endpoint/parameter is introduced.

### Third-party libraries
Before proposing a library:
- Check it is actively maintained (last commit date, open issues)
- Verify compatibility with the runtime version in use
- Check for conflicts with existing dependencies
- Default stance for this project: **avoid adding dependencies** — the bundle must stay small for instant offline loads.

### Use agent-browser for web inspection
When inspecting page markup, finding CSS selectors, checking rendered UI, or testing PWA behavior — use the `agent-browser` skill directly. Do NOT ask the user to save HTML manually and do NOT guess selectors.

Triggers for agent-browser:
- Verifying the app's UI renders correctly (screenshots for the owner)
- Testing offline/service-worker behavior in a real browser
- Inspecting any external page's markup

---

## Security

- **Secrets**: none exist in this project (Open-Meteo is keyless). If that ever changes — stop: a static frontend cannot hold a secret; the decision to add a backend goes back to the owner.
- **Input validation**: sanitize the geocoding search input; render API-sourced strings (location names) as text, never as HTML (`textContent`, not `innerHTML`).
- **Errors**: no internal details in the UI; console-log internally.
- **Dependencies**: run `npm audit` before adding any library.

---

## Fault Tolerance

### External calls (Open-Meteo)
- **Timeouts**: every `fetch` gets an explicit timeout via `AbortSignal.timeout(...)` (~10 s). Nothing blocks indefinitely.
- **Retry with exponential backoff**: retry transient failures (network, 5xx) — 2s → 4s → 8s, 3 attempts max. Do NOT retry 4xx.
- **Graceful degradation is the product**: any fetch failure → keep showing cached data with its honest "last updated" stamp. Never blank the screen because the network failed.
- **Per-slot isolation**: fetch slots in parallel; one slot's failure must not affect others.
- **Geocoding autocomplete**: debounce input (~300 ms) and abort in-flight requests on each keystroke — stay polite to the free API.

---

## Observability

Client-side app — keep it lightweight:
- `console` logging at boundaries (fetch start/success/failure, cache read/write) with the location name as context.
- The UI's "last updated" stamp is the primary user-facing health signal.
- No analytics, no external telemetry — personal app.

---

## Key Files

| File | Purpose |
|------|---------|
| `.agents/PRDs/offline-weather-pwa.prd.md` | Requirements, resolved decisions, API spike results |
| `examples/weather-lahti.png` | Visual reference (Google weather widget) for the UI |
| `vite.config.ts` | Build + PWA manifest/service-worker config (hotspot) |
| `src/main.ts` | App wiring (hotspot) |
| `.env.local` | Real default locations — gitignored, never commit |

---

## Orchestration

| Setting | Value |
|---------|-------|
| Branch naming | `claude/issue-{N}-{slug}` |
| Publish policy | After `/implement` returns COMPLETE + verifier CONFIRMED, the implement command fast-forward merges the feature branch into `master` and pushes (Phase 6B). Never force-push, never merge-commit; if FF isn't possible, stop and surface the divergence. |
| Max parallel | 3 |

### Hotspot files (never run two issues touching the same one concurrently)

- `src/main.ts` (app wiring — almost every feature touches it)
- `vite.config.ts` (PWA manifest / service-worker config)
- `src/ui/` global styles file

### Sandbox-blocked checks (defer-and-record, do NOT treat as failures)

- Real-device iPhone tests (PWA install, airplane-mode offline check) — owner runs manually
- Deploys to Netlify / Cloudflare Pages

---

## Notes

- **iOS PWA constraints are load-bearing**: no background fetch, possible storage eviction for non-installed PWAs. Architecture decisions that look odd (refresh-on-open, no scheduler) are deliberate — see PRD.
- **Open-Meteo geocoding fuzzy search is weak on short prefixes** ("Käs" doesn't surface Käsmu in top 5; ~4+ chars needed). Don't promise great suggestions at 2–3 chars; just pass through API results.
- **CC-BY 4.0 attribution** ("Weather data by Open-Meteo" footer link) is a license requirement, not a nicety.
- Every phase must produce something visually demoable — the owner tests UI from the first issues.
