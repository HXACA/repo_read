/**
 * Shared primitives for abort-aware async work. Deduplicated from earlier
 * ad-hoc copies in `semaphore.ts`, `rate-limiter.ts`, and `resilient-fetch.ts`
 * so future signal-aware primitives reuse one implementation.
 */

/**
 * Coerce an AbortSignal's `reason` into an Error for downstream throw paths.
 * - `reason` already an Error → returned as-is so existing stacks are preserved
 * - `reason` defined but non-Error → stringified into a fresh Error
 * - `reason` undefined → generic AbortError (covers `signal.abort()` without arg)
 */
export function signalAbortReason(signal: AbortSignal): Error {
  const reason = signal.reason;
  if (reason instanceof Error) return reason;
  if (reason !== undefined) return new Error(String(reason));
  return new DOMException("The operation was aborted.", "AbortError");
}

/**
 * Coerce an arbitrary thrown value (e.g. `AbortController.abort(reason)`'s
 * `reason` argument) into an Error. Mirrors `signalAbortReason` but works
 * when you have the raw value rather than a signal. Used by
 * `createWallClockFetch` where the caller's abort reason is attached to
 * the internal controller via listener.
 */
export function asError(reason: unknown): Error {
  if (reason instanceof Error) return reason;
  if (reason !== undefined) return new Error(String(reason));
  return new DOMException("The operation was aborted.", "AbortError");
}

/**
 * Sleep for `ms` milliseconds, rejecting early if `signal` aborts. When
 * `signal` is undefined, behaves like a plain `setTimeout` promise.
 */
export function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return new Promise((r) => setTimeout(r, ms));
  }
  if (signal.aborted) {
    return Promise.reject(signalAbortReason(signal));
  }
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signalAbortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
