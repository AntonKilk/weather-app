import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

// Vite + Vitest config.
// STORY-006 wires `vite-plugin-pwa` for the installable PWA surface:
// valid manifest, maskable + apple-touch icons, Workbox-precached app
// shell. Runtime data caching (Open-Meteo) is intentionally NOT here —
// STORY-007 owns the runtime route in `workbox.runtimeCaching`.
//
// SW does not run on `npm run dev` — by design (CLAUDE.md). Test
// against `npm run preview` after a build.
export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      // We register manually from src/sw/register.ts so the SW lifecycle
      // is observable (CLAUDE.md › Observability) and unit-testable.
      injectRegister: false,
      devOptions: { enabled: false },
      includeAssets: ['icons/apple-touch-icon.png', 'icons/icon.svg'],
      manifest: {
        name: 'Weather',
        short_name: 'Weather',
        description: 'Personal offline-first weather',
        lang: 'en',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#0b1726',
        background_color: '#f5f7fa',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Precache the app shell only. Open-Meteo runtime caching = STORY-007.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,ico,woff2}'],
        // SPA: fall back to the entry HTML for unknown navigations.
        navigateFallback: '/index.html',
        // Keep cross-origin (Open-Meteo) requests off the navigation path.
        navigateFallbackDenylist: [/^\/api\//, /^https?:\/\//],
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
      },
    }),
  ],
  preview: {
    allowedHosts: ['.ts.net'],
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    globals: false,
    css: false,
  },
});
