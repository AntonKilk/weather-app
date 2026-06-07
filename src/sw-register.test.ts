// Tests for the SW registration boundary. We avoid importing the virtual
// `virtual:pwa-register` module by injecting a stub `register` implementation;
// this also keeps the test suite deterministic (no real navigator.serviceWorker
// access) and fast.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerServiceWorker } from './sw-register';

describe('registerServiceWorker', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does nothing and logs info when serviceWorker is not supported', () => {
    // jsdom doesn't ship `navigator.serviceWorker`. Confirm and assert.
    expect('serviceWorker' in navigator).toBe(false);

    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const register = vi.fn(async (): Promise<void> => undefined);

    expect(() => registerServiceWorker({ register })).not.toThrow();

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy.mock.calls[0]?.[0]).toBe('[sw] not supported by this browser');
    expect(register).not.toHaveBeenCalled();
  });

  it('logs success when the registration promise resolves', async () => {
    // Stub `serviceWorker` onto `navigator` for this test, then restore it.
    const swStub = Object.freeze({});
    Object.defineProperty(navigator, 'serviceWorker', {
      value: swStub,
      configurable: true,
    });

    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    let resolveRegister!: (value: unknown) => void;
    const register = vi.fn(
      (): Promise<unknown> =>
        new Promise((resolve) => {
          resolveRegister = resolve;
        }),
    );

    registerServiceWorker({ register });
    expect(register).toHaveBeenCalledTimes(1);

    resolveRegister(undefined);
    // Let the .then() handler run.
    await vi.waitFor(() => {
      expect(infoSpy).toHaveBeenCalledWith('[sw] registered');
    });

    // Cleanup.
    Reflect.deleteProperty(navigator, 'serviceWorker');
    expect('serviceWorker' in navigator).toBe(false);
  });

  it('logs a warning and does not throw when registration rejects', async () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      value: Object.freeze({}),
      configurable: true,
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = new Error('boom');
    const register = vi.fn((): Promise<unknown> => Promise.reject(error));

    expect(() => registerServiceWorker({ register })).not.toThrow();

    await vi.waitFor(() => {
      expect(warnSpy).toHaveBeenCalled();
    });

    const call = warnSpy.mock.calls[0];
    expect(call?.[0]).toBe('[sw] registration failed');
    expect(call?.[1]).toBe(error);

    Reflect.deleteProperty(navigator, 'serviceWorker');
    expect('serviceWorker' in navigator).toBe(false);
  });
});
