import { registerSW as defaultRegisterSW } from 'virtual:pwa-register';
import type { RegisterSWOptions } from 'virtual:pwa-register';

// Typed wrapper around `vite-plugin-pwa`'s `registerSW` so SW lifecycle
// is observable (CLAUDE.md › Observability) and the registration call
// is unit-testable via dep injection. Never throws — SW failure must
// NEVER block paint (CLAUDE.md › Error handling). Runtime data caching
// (Open-Meteo) is out of scope here — that is STORY-007.

export type RegisterResult =
  | { kind: 'ready' }
  | { kind: 'unsupported'; reason: string }
  | { kind: 'error'; error: unknown };

export type RegisterSW = (options?: RegisterSWOptions) => (reloadPage?: boolean) => Promise<void>;

export interface RegisterServiceWorkerDeps {
  registerSW?: RegisterSW;
  isProd?: boolean;
  hasServiceWorker?: boolean;
}

export function registerServiceWorker(deps: RegisterServiceWorkerDeps = {}): RegisterResult {
  const isProd = deps.isProd ?? import.meta.env.PROD;
  const hasServiceWorker =
    deps.hasServiceWorker ?? (typeof navigator !== 'undefined' && 'serviceWorker' in navigator);
  const registerSW = deps.registerSW ?? defaultRegisterSW;

  if (!isProd) {
    console.info('[sw] skipped: not production (dev server / test env)');
    return { kind: 'unsupported', reason: 'not-production' };
  }
  if (!hasServiceWorker) {
    console.info('[sw] skipped: navigator.serviceWorker is unavailable in this user agent');
    return { kind: 'unsupported', reason: 'no-service-worker-api' };
  }

  try {
    registerSW({
      immediate: true,
      onRegisteredSW(swScriptUrl) {
        console.info('[sw] registered', swScriptUrl);
      },
      onRegisterError(error) {
        console.error('[sw] register error', error);
      },
      onNeedRefresh() {
        console.info('[sw] update available (auto-update applies on next load)');
      },
      onOfflineReady() {
        console.info('[sw] offline-ready: app shell precached');
      },
    });
    return { kind: 'ready' };
  } catch (err) {
    console.error('[sw] register threw', err);
    return { kind: 'error', error: err };
  }
}
