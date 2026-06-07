// Generic debounce.
//
// Used by the geocoding autocomplete controller to coalesce rapid keystrokes
// into a single trailing call (story #8, AC2: ~300 ms debounce).
//
// Trailing-edge only — no leading invocation. The pending call always uses
// the LAST arguments observed (matches user intent: "what they were typing").
//
// The implementation is layer-clean: no DOM, no fetch, no AbortSignal — just
// setTimeout/clearTimeout. The `setTimeoutImpl` and `clearTimeoutImpl`
// overrides exist for tests, not as a feature; in production the global
// timers are used.

export interface DebouncedFunction<TArgs extends readonly unknown[]> {
  /** Schedule a trailing call with these arguments. */
  call(...args: TArgs): void;
  /** Cancel any pending call. Idempotent. */
  cancel(): void;
  /** True if a call is currently pending. */
  isPending(): boolean;
}

export interface DebounceOptions {
  /**
   * Override `globalThis.setTimeout` — for tests that use `vi.useFakeTimers`.
   * Default is the global. Returns a handle used by clearTimeout.
   */
  readonly setTimeoutImpl?: typeof globalThis.setTimeout;
  /** Override `globalThis.clearTimeout`. */
  readonly clearTimeoutImpl?: typeof globalThis.clearTimeout;
}

/**
 * Create a debounced wrapper around `fn`. Each call resets the timer; the
 * underlying `fn` runs once, with the most recent arguments, after `ms`
 * milliseconds of quiet.
 */
export function debounce<TArgs extends readonly unknown[]>(
  fn: (...args: TArgs) => void,
  ms: number,
  opts: DebounceOptions = {},
): DebouncedFunction<TArgs> {
  const setTimeoutImpl = opts.setTimeoutImpl ?? globalThis.setTimeout;
  const clearTimeoutImpl = opts.clearTimeoutImpl ?? globalThis.clearTimeout;

  let handle: ReturnType<typeof globalThis.setTimeout> | null = null;
  let pendingArgs: TArgs | null = null;

  return {
    call(...args: TArgs): void {
      pendingArgs = args;
      if (handle !== null) {
        clearTimeoutImpl(handle);
      }
      handle = setTimeoutImpl(() => {
        handle = null;
        const argsToRun = pendingArgs;
        pendingArgs = null;
        if (argsToRun !== null) {
          fn(...argsToRun);
        }
      }, ms);
    },
    cancel(): void {
      if (handle !== null) {
        clearTimeoutImpl(handle);
        handle = null;
      }
      pendingArgs = null;
    },
    isPending(): boolean {
      return handle !== null;
    },
  };
}
