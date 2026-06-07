// Unit tests for the debounce helper.
//
// Uses Vitest fake timers — no real time passes.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { debounce } from './debounce';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('debounce', () => {
  it('does not invoke fn before ms have elapsed', () => {
    const fn = vi.fn();
    const d = debounce(fn, 300);

    d.call('a');
    vi.advanceTimersByTime(299);

    expect(fn).not.toHaveBeenCalled();
    expect(d.isPending()).toBe(true);
  });

  it('invokes fn once with the last args after ms of quiet', () => {
    const fn = vi.fn();
    const d = debounce(fn, 300);

    d.call('a');
    vi.advanceTimersByTime(300);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('a');
    expect(d.isPending()).toBe(false);
  });

  it('coalesces rapid calls and uses the most recent args', () => {
    const fn = vi.fn();
    const d = debounce(fn, 300);

    d.call('a');
    vi.advanceTimersByTime(100);
    d.call('b');
    vi.advanceTimersByTime(100);
    d.call('c');
    vi.advanceTimersByTime(299);

    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('c');
  });

  it('cancel() prevents the pending call', () => {
    const fn = vi.fn();
    const d = debounce(fn, 300);

    d.call('a');
    d.cancel();
    vi.advanceTimersByTime(1000);

    expect(fn).not.toHaveBeenCalled();
    expect(d.isPending()).toBe(false);
  });

  it('cancel() is idempotent', () => {
    const fn = vi.fn();
    const d = debounce(fn, 300);

    d.cancel();
    d.cancel();
    d.call('a');
    d.cancel();
    d.cancel();
    vi.advanceTimersByTime(1000);

    expect(fn).not.toHaveBeenCalled();
  });

  it('supports multiple debounce cycles', () => {
    const fn = vi.fn();
    const d = debounce(fn, 300);

    d.call('first');
    vi.advanceTimersByTime(300);
    expect(fn).toHaveBeenCalledWith('first');

    d.call('second');
    vi.advanceTimersByTime(300);
    expect(fn).toHaveBeenCalledWith('second');

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('passes multi-argument signatures through correctly', () => {
    const fn = vi.fn<(a: string, b: number, c: boolean) => void>();
    const d = debounce(fn, 100);

    d.call('x', 7, true);
    vi.advanceTimersByTime(100);

    expect(fn).toHaveBeenCalledWith('x', 7, true);
  });
});
