import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

// Vite + Vitest config.
//
// STORY-006: vite-plugin-pwa generates a Workbox-based service worker and a
// web app manifest at build time. SW runs against `npm run preview`, NEVER
// `npm run dev` (per CLAUDE.md > Notes). The `devOptions.enabled: false`
// setting keeps the dev server SW-free.
//
// Manifest fields are tuned for iPhone Add-to-Home-Screen + Android install:
//   - display: 'standalone' hides browser chrome on launch
//   - 192/512 PNG icons cover Android/Chrome install
//   - 512 also marked 'any maskable' for Android adaptive icons
//   - 180x180 apple-touch-icon is the one Safari actually shows on iOS
//
// Precaching: globPatterns picks up the entire emitted shell (HTML/CSS/JS +
// icons). Open-Meteo API responses are NOT cached here — STORY-007 owns the
// runtime weather-data cache (stale-while-revalidate IndexedDB layer).
export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon-180.png'],
      manifest: {
        name: 'Weather',
        short_name: 'Weather',
        description: 'Personal offline-first weather PWA.',
        lang: 'en',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0b1726',
        theme_color: '#0b1726',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
          { src: '/apple-touch-icon-180.png', sizes: '180x180', type: 'image/png', purpose: 'any' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
      },
      devOptions: {
        // CLAUDE.md: SW must be tested against `npm run preview`, not `dev`.
        enabled: false,
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    globals: false,
    css: false,
  },
});
