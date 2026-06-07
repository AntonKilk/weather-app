// Service worker registration boundary (CLAUDE.md > Architecture).
//
// STORY-006: register the vite-plugin-pwa-generated SW so the app shell is
// available offline once the user has loaded the app once. This file is the
// ONLY browser-side touchpoint of the SW (besides `vite.config.ts`).
//
// Design rules:
//   - Never throw. If registration fails (no SW support, file 404, security
//     error, file-system error), we log internally and continue rendering.
//     The app must work without a SW (degraded: no offline shell), not crash.
//   - Guarded against test envs: under jsdom there is no `serviceWorker` on
//     `navigator`; the function returns early after a single info log.
//   - The `registerSW` impl is loaded via dynamic import of the virtual module
//     `virtual:pwa-register` (provided by vite-plugin-pwa). Tests inject a
//     stub via `opts.register` to avoid touching the virtual module entirely.
//
// CLAUDE.md > Notes: SW does not run under `npm run dev` — verify against
// `npm run preview`.

export interface RegisterServiceWorkerOptions {
  /**
   * Custom registration implementation. Tests inject a stub to avoid the
   * `virtual:pwa-register` module (which is only resolvable inside a Vite
   * build). When omitted, the default implementation dynamically imports
   * `virtual:pwa-register` and calls its `registerSW({ immediate: true })`.
   */
  readonly register?: () => Promise<unknown>;
}

/**
 * Register the production service worker. Safe to call in any environment:
 * no-ops under SSR/tests and on browsers without SW support. Never throws —
 * failures are console-logged so the page keeps rendering.
 */
export function registerServiceWorker(opts: RegisterServiceWorkerOptions = {}): void {
  // SSR / test guard: jsdom has `window` but no real SW. Be doubly defensive.
  if (typeof window === 'undefined') {
    return;
  }
  if (!('serviceWorker' in navigator)) {
    // eslint-disable-next-line no-console
    console.info('[sw] not supported by this browser');
    return;
  }

  const register = opts.register ?? defaultRegister;

  // Fire-and-forget: we never await the registration. Errors are logged.
  void register().then(
    () => {
      // eslint-disable-next-line no-console
      console.info('[sw] registered');
    },
    (err: unknown) => {
      // eslint-disable-next-line no-console
      console.warn('[sw] registration failed', err);
    },
  );
}

// ---------------------------------------------------------------------------
// Default implementation — kept out of the public API so tests can replace it
// without ever importing `virtual:pwa-register`.
// ---------------------------------------------------------------------------

async function defaultRegister(): Promise<unknown> {
  // Dynamic import via a variable specifier keeps Vite's import-analysis from
  // pre-resolving `virtual:pwa-register` in the test environment (where the
  // PWA plugin isn't loaded). The `@vite-ignore` comment is the canonical way
  // to tell Vite "do not try to crawl this dynamic import at build time".
  // At runtime in a real Vite build the virtual module IS resolvable.
  const specifier = 'virtual:pwa-register';
  const mod = (await import(/* @vite-ignore */ specifier)) as {
    registerSW: (opts?: { immediate?: boolean }) => (reloadPage?: boolean) => Promise<void>;
  };
  // `immediate: true` triggers registration without waiting for a manual call.
  return mod.registerSW({ immediate: true });
}
