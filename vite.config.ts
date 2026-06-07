import { defineConfig } from 'vitest/config';

// Vite + Vitest config.
// vite-plugin-pwa is intentionally NOT wired here — Phase 3 owns PWA setup
// (manifest, service worker, offline cache). See PRD.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    globals: false,
    css: false,
  },
});
