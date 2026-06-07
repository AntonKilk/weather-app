# Offline Weather PWA

## Problem Statement

The user googles the weather 3–6 times a day across multiple locations (Finland/Estonia), each time repeating: open browser → type query → wait → repeat per location. Existing weather apps are ad-cluttered, and neither they nor Google work offline. The cost of not solving it: dozens of wasted micro-interactions daily and zero weather access without network.

## Key Hypothesis

We believe a personal, ad-free, offline-capable PWA showing all tracked locations at a glance will eliminate the need to google weather.
We'll know we're right when, after install and an offline test, the user stops googling weather entirely (≈0 searches/day within 2 weeks).

## Users

**Primary User**: The author (possibly family later). iPhone user, lives in the Lahti/Helsinki ↔ Tallinn/Käsmu region, technical (Go, Docker, Tailscale).

**Job to Be Done**: When I'm about to leave home or plan my day (possibly without network), I want to see temperature and precipitation for my locations at a glance, so I can decide what to wear and whether to take an umbrella.

**Non-Users**: General public. Not a product — a personal tool. No accounts, no multi-tenancy.

## Solution

A PWA installed on iPhone showing weather for 6 location slots: 4 defaults (Lahti, Helsinki, Tallinn, Käsmu — configured via `.env`, kept out of the public repo) + 2 free slots with a geocoding autocomplete input (suggestions on each keystroke). Per location: current conditions, hourly temperature + precipitation chart in 2–3h steps, and a 7-day forecast — visual reference: Google's weather widget (`examples/weather-lahti.png`). Data is fetched from Open-Meteo (free, keyless) and cached on-device so the last-known forecast is always visible offline. UI language: English.

**Architecture (decided 2026-06-07): frontend-only static PWA on free hosting** (Netlify / Cloudflare Pages). No Go backend, no Docker, no Tailscale — Open-Meteo requires no API key, so there is no secret to proxy. Default locations are injected at build time from hosting env vars: the repo stays clean, but the deployed bundle is public-by-URL — accepted trade-off (locations are mostly cities; URL is obscure but not secret).

### iOS Reality Check (drives architecture)

iOS Safari PWAs cannot reliably fetch in the background ("2–3 scheduled fetches/day" is not enforceable on-device), and Safari may evict storage of PWAs unused for ~7 days (installed-to-home-screen apps are largely exempt, but this needs verification). Therefore the working model is **stale-while-revalidate**: open app → instantly render cached data (with a "last updated" stamp) → silently refresh if online.

### MVP Scope

| Priority | Capability | Rationale |
|----------|------------|-----------|
| Must | Multi-location view: 6 slots (4 default + 2 custom) | Core value — all locations at a glance, the reason Google loses |
| Must | Current temp + hourly temp/precipitation (2–3h step) + 7-day forecast | The data the user actually checks; matches Google-widget reference |
| Must | Installable PWA on iPhone (manifest, icons, service worker) | "App on my phone" is the premise |
| Must | Offline: last fetched data always renders, with "last updated" timestamp | The #1 differentiator vs. Google/apps |
| Must | Stale-while-revalidate refresh on open | The only reliable update mechanism on iOS PWA |
| Must | Custom-slot location search with autocomplete (suggest per keystroke) | Travel use case, explicitly in scope |
| Must | Clean, beautiful, ad-free UI; demoable from the first 1–2 issues | Stated quality bar; early visual feedback required |
| Should | Deploy to free static hosting (Netlify / Cloudflare Pages), default locations from build-time env vars | Zero cost, zero ops; repo stays clean of locations |
| Won't | Go backend proxy, Docker, Tailscale | Dropped 2026-06-07: keyless API leaves nothing to proxy; public-URL trade-off accepted |
| Won't | Push notifications / weather alerts | Explicitly out of scope |
| Won't | Home-screen widget | iOS PWAs can't do this |
| Won't | Weather history, precipitation maps | Out of scope |
| Won't | Multi-language (English only), accounts/auth | Personal tool |

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| Weather googling after adoption | ≈0 searches/day | Self-observation over 2 weeks |
| Offline test | Cached weather for all 6 slots renders in airplane mode | Manual test right after install |
| Time-to-weather | < 2 s from tap to visible data (cached) | Manual check on phone |
| Running cost | 0 €/month | API + hosting bills |

## Open Questions

- [x] **Weather API choice**: ~~Needs a comparison spike.~~ **RESOLVED (spike 2026-06-07): Open-Meteo.** Verified live: forecast for Lahti matched the Google widget reference within ~1 °C on current temp (19.0 °C hourly vs Google 19 °C, humidity 57 % vs 59 %, wind 4.5 vs 4 m/s) and within 1–2 °C on the first 4 daily max/min; MET Norway cross-check agreed within ~0.1 °C (shared nordic model data). Hourly temp + precipitation + precipitation probability + WMO weather codes + 7-day daily — all in one call, with `timezone=auto` and `wind_speed_unit=ms`. Geocoding API works: finds Käsmu (pop. 112), responds from 2 characters. Caveat: fuzzy match is weak on short prefixes — "Käs" does NOT surface Käsmu in top 5 (needs ~4+ chars); UI should not promise great suggestions at 2–3 chars.
- [x] **API cost at our volume**: **RESOLVED: free.** Our load is ~18 calls/day (6 locations × 3) vs Open-Meteo free-tier limits of 10,000/day, 300,000/month. No API key required. Conditions: non-commercial use (personal app without ads/subscriptions qualifies explicitly) + CC-BY 4.0 attribution → add a "Weather data by Open-Meteo" footer link.
- [x] **Backend or frontend-only?** **RESOLVED (2026-06-07): frontend-only on free static hosting, public URL.** Open-Meteo needs no API key, so there is nothing to proxy. Default locations come from build-time env vars (clean repo); their visibility in the public bundle is an accepted trade-off. Go proxy / Docker / Tailscale dropped from scope.
- [ ] **iOS storage eviction**: Confirm that installed (Add to Home Screen) PWAs are exempt from Safari's 7-day storage eviction in current iOS, and pick storage accordingly (Cache API vs IndexedDB vs localStorage for the weather payload).
- [x] **"2–3 fetches/day" semantics**: **RESOLVED: refresh-on-open (stale-while-revalidate), no scheduler.** Follows from frontend-only: direct Open-Meteo calls are free, keyless and fast (~6 calls per refresh, well under limits). With no backend there is nowhere to schedule anyway; data freshness = last time the app was opened online.

## Implementation Phases

| # | Phase | Description | Status | Depends |
|---|-------|-------------|--------|---------|
| 1 | UI skeleton with mock data | Static frontend, 6-slot layout, hourly chart + 7-day row per Google-widget reference; demoable and visually testable immediately | pending | - |
| 2 | API spike + integration | Choose weather API (Open-Meteo vs alternatives), wire real data for 4 default locations | pending | 1 |
| 3 | PWA + offline | Manifest, icons, service worker, on-device cache, stale-while-revalidate, "last updated" stamp; airplane-mode test on iPhone | pending | 2 |
| 4 | Custom location slots | Geocoding autocomplete input, add/remove temporary locations, persist locally | pending | 2 |
| 5 | Deploy | Free static hosting (Netlify / Cloudflare Pages), build-time env vars for default locations; install + end-to-end test from iPhone incl. airplane mode | pending | 3, 4 |

---

*Generated: 2026-06-07 13:43*
*Status: DRAFT - needs validation*
