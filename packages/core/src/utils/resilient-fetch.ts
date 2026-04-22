import { asError } from "./abort.js";

const DEFAULT_SSE_TIMEOUT_MS = 120_000; // 2 minutes
const DEFAULT_WALL_CLOCK_TIMEOUT_MS = 600_000; // 10 minutes — hard ceiling per HTTP call

export class SSETimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`SSE stream stalled: no data received for ${timeoutMs}ms`);
    this.name = "SSETimeoutError";
  }
}

export class WallClockTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Request exceeded ${timeoutMs}ms wall-clock timeout`);
    this.name = "WallClockTimeoutError";
  }
}

export function createResilientFetch(
  baseFetch: typeof globalThis.fetch,
  options?: { sseReadTimeoutMs?: number },
): typeof globalThis.fetch {
  const timeoutMs = options?.sseReadTimeoutMs ?? DEFAULT_SSE_TIMEOUT_MS;

  return async (input, init) => {
    const response = await baseFetch(input, init);
    const contentType = response.headers.get("content-type") ?? "";
    const isStreaming =
      contentType.includes("text/event-stream") || contentType.includes("application/x-ndjson");

    if (!isStreaming || !response.body) {
      return response;
    }

    const reader = response.body.getReader();
    const wrappedBody = new ReadableStream<Uint8Array>({
      async pull(controller) {
        // Use a manual race to avoid PromiseRejectionHandledWarning from
        // Promise.race when fake timers fire the timeout synchronously.
        const result = await new Promise<Awaited<ReturnType<typeof reader.read>>>(
          (resolve, reject) => {
            const timerId = setTimeout(
              () => reject(new SSETimeoutError(timeoutMs)),
              timeoutMs,
            );
            reader.read().then(
              (r) => { clearTimeout(timerId); resolve(r); },
              (e) => { clearTimeout(timerId); reject(e); },
            );
          },
        );

        if (result.done) {
          controller.close();
        } else {
          controller.enqueue(result.value);
        }
      },
      cancel(reason) {
        // Propagate the caller's cancel reason so upstream consumers get the
        // real AbortError (e.g., `WallClockTimeoutError`) instead of an
        // opaque cancel. Critical for post-mortem diagnostics.
        reader.cancel(reason);
      },
    });

    return new Response(wrappedBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

/**
 * Wrap `inner` with a per-request wall-clock timeout.
 *
 * Addresses the gap the SSE inter-chunk timeout cannot close: a server that
 * slowly drips tokens (or the ai-sdk that finishes reading but never resolves
 * its internal step promise) never trips the inter-chunk timer, and every
 * downstream wait — including `bucket.acquire()` when permits leak — is
 * unbounded. This sits OUTERMOST in the fetch chain so its signal propagates
 * through rate-limiter buckets and resilient-fetch all the way to the
 * platform fetch.
 *
 * The timer is cleared when the body is fully consumed, cancelled, or errored.
 * When it fires, the AbortController aborts the signal, unsticking any await
 * in the chain and raising a `WallClockTimeoutError`.
 */
export function createWallClockFetch(
  inner: typeof globalThis.fetch,
  options?: {
    timeoutMs?: number;
    /**
     * Source of a wake-from-sleep `AbortSignal`. Called once per fetch so
     * callers that rotate their controller on every wake event (see
     * `Diagnostics.wakeSignal`) deliver a fresh signal to every new
     * request. Provided to unstick in-flight fetches that were paused
     * with the process during macOS Idle Sleep — `setTimeout` counts
     * runtime not wall-clock, so the `timeoutMs` ceiling above doesn't
     * help for a 7-hour system sleep.
     */
    wakeSignal?: () => AbortSignal;
  },
): typeof globalThis.fetch {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_WALL_CLOCK_TIMEOUT_MS;
  const getWakeSignal = options?.wakeSignal;

  return async (input, init) => {
    const controller = new AbortController();
    const abortWith = (err: Error) => {
      try { controller.abort(err); } catch { /* already aborted */ }
    };

    // Chain caller-supplied signal so both the external cancel and our
    // timeout can reach downstream consumers.
    let unlinkCaller: (() => void) | undefined;
    if (init?.signal) {
      if (init.signal.aborted) {
        abortWith(asError(init.signal.reason));
      } else {
        const onCallerAbort = () => abortWith(asError(init.signal!.reason));
        init.signal.addEventListener("abort", onCallerAbort, { once: true });
        unlinkCaller = () => init.signal!.removeEventListener("abort", onCallerAbort);
      }
    }

    // Chain the wake signal the same way. Re-read the getter per call
    // because the upstream controller rotates on every wake event.
    let unlinkWake: (() => void) | undefined;
    if (getWakeSignal) {
      const wakeSignal = getWakeSignal();
      if (wakeSignal.aborted) {
        abortWith(asError(wakeSignal.reason));
      } else {
        const onWakeAbort = () => abortWith(asError(wakeSignal.reason));
        wakeSignal.addEventListener("abort", onWakeAbort, { once: true });
        unlinkWake = () => wakeSignal.removeEventListener("abort", onWakeAbort);
      }
    }

    const timer = setTimeout(
      () => abortWith(new WallClockTimeoutError(timeoutMs)),
      timeoutMs,
    );
    const finish = () => {
      clearTimeout(timer);
      if (unlinkCaller) unlinkCaller();
      if (unlinkWake) unlinkWake();
    };

    // If any source signal was already aborted above (caller cancel or a
    // stale wake signal), short-circuit before invoking the real fetch.
    // Real HTTP fetch honors an already-aborted signal, but thin test
    // doubles and some minimal clients don't — either way, issuing the
    // request is wasted work once the controller is done.
    if (controller.signal.aborted) {
      finish();
      throw asError(controller.signal.reason);
    }

    const mergedInit = { ...init, signal: controller.signal };

    let response: Response;
    try {
      response = await inner(input, mergedInit);
    } catch (err) {
      finish();
      throw err;
    }

    if (!response.body) {
      finish();
      return response;
    }

    // Clear the timer when the body finishes streaming — mirror resilient-fetch's
    // passthrough but with the additional finish() hook on close/cancel/error.
    //
    // The pull() below races `reader.read()` against `controller.signal`.
    // Racing is required because `controller.abort()` on an in-flight body
    // stream does NOT propagate to `reader.read()` at the WHATWG Streams
    // level — it only affects the request/headers phase. Real-world bug
    // reproduced 2026-04-22 (CubeSandbox): the remote TCP peer sent FIN
    // (socket went to CLOSE_WAIT), but Node's undici-backed fetch never
    // noticed because no keepalive read was pending. `reader.read()` hung
    // forever; our timer fired `controller.abort()` but the read promise
    // was unaffected. Racing against the signal's abort event breaks
    // `reader.read()` with the AbortError (or WallClockTimeoutError) reason.
    const reader = response.body.getReader();
    const wrappedBody = new ReadableStream<Uint8Array>({
      async pull(ctrl) {
        try {
          const result = await new Promise<Awaited<ReturnType<typeof reader.read>>>(
            (resolve, reject) => {
              if (controller.signal.aborted) {
                reject(asError(controller.signal.reason));
                return;
              }
              const onAbort = () => reject(asError(controller.signal.reason));
              controller.signal.addEventListener("abort", onAbort, { once: true });
              reader.read().then(
                (r) => {
                  controller.signal.removeEventListener("abort", onAbort);
                  resolve(r);
                },
                (e) => {
                  controller.signal.removeEventListener("abort", onAbort);
                  reject(e);
                },
              );
            },
          );
          if (result.done) {
            finish();
            ctrl.close();
          } else {
            ctrl.enqueue(result.value);
          }
        } catch (err) {
          finish();
          // Best-effort cancel of the underlying reader so its socket is
          // torn down rather than left dangling on CLOSE_WAIT.
          reader.cancel(err as Error).catch(() => {});
          ctrl.error(err);
        }
      },
      cancel(reason) {
        finish();
        return reader.cancel(reason);
      },
    });

    return new Response(wrappedBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

