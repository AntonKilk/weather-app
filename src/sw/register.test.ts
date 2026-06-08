import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerServiceWorker } from './register';
import type { RegisterSW } from './register';

afterEach(() => {
  vi.restoreAllMocks();
});

function fakeRegisterSW(): RegisterSW {
  return () => async () => {};
}

describe('registerServiceWorker', () => {
  it('skips registration on the dev server (isProd=false) and never calls registerSW', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const sw = vi.fn(fakeRegisterSW());

    const result = registerServiceWorker({
      isProd: false,
      hasServiceWorker: true,
      registerSW: sw,
    });

    expect(result).toEqual({ kind: 'unsupported', reason: 'not-production' });
    expect(sw).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledTimes(1);
    const message = String(info.mock.calls[0]?.[0] ?? '');
    expect(message).toContain('[sw]');
    expect(message).toContain('skipped');
    expect(message.toLowerCase()).toContain('production');
  });

  it('skips registration when the user agent lacks navigator.serviceWorker', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const sw = vi.fn(fakeRegisterSW());

    const result = registerServiceWorker({
      isProd: true,
      hasServiceWorker: false,
      registerSW: sw,
    });

    expect(result).toEqual({ kind: 'unsupported', reason: 'no-service-worker-api' });
    expect(sw).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledTimes(1);
    const message = String(info.mock.calls[0]?.[0] ?? '');
    expect(message).toContain('[sw]');
    expect(message).toContain('skipped');
  });

  it('calls registerSW exactly once with the four lifecycle callbacks on prod + SW-capable UA', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const sw = vi.fn(fakeRegisterSW());

    const result = registerServiceWorker({
      isProd: true,
      hasServiceWorker: true,
      registerSW: sw,
    });

    expect(result).toEqual({ kind: 'ready' });
    expect(sw).toHaveBeenCalledTimes(1);
    const options = sw.mock.calls[0]?.[0];
    expect(options).toBeDefined();
    expect(options?.immediate).toBe(true);
    expect(typeof options?.onRegisteredSW).toBe('function');
    expect(typeof options?.onRegisterError).toBe('function');
    expect(typeof options?.onNeedRefresh).toBe('function');
    expect(typeof options?.onOfflineReady).toBe('function');
  });

  it('lifecycle callbacks log to the correct console method with the [sw] prefix', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sw = vi.fn(fakeRegisterSW());

    registerServiceWorker({
      isProd: true,
      hasServiceWorker: true,
      registerSW: sw,
    });
    info.mockClear();
    error.mockClear();

    const options = sw.mock.calls[0]?.[0];
    options?.onRegisteredSW?.('/sw.js', undefined);
    options?.onRegisterError?.(new Error('boom'));
    options?.onNeedRefresh?.();
    options?.onOfflineReady?.();

    expect(info).toHaveBeenCalledTimes(3);
    expect(error).toHaveBeenCalledTimes(1);
    for (const call of info.mock.calls) {
      expect(String(call[0])).toContain('[sw]');
    }
    expect(String(error.mock.calls[0]?.[0] ?? '')).toContain('[sw]');
  });

  it('returns kind:error and logs when registerSW throws synchronously — never re-throws', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const boom = new Error('synthetic');
    const sw = vi.fn(((): never => {
      throw boom;
    }) as unknown as RegisterSW);

    const result = registerServiceWorker({
      isProd: true,
      hasServiceWorker: true,
      registerSW: sw,
    });

    expect(result).toEqual({ kind: 'error', error: boom });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.[0] ?? '')).toContain('[sw]');
  });
});
