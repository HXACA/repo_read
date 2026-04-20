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
  options?: { timeoutMs?: number },
): typeof globalThis.fetch {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_WALL_CLOCK_TIMEOUT_MS;

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

    const timer = setTimeout(
      () => abortWith(new WallClockTimeoutError(timeoutMs)),
      timeoutMs,
    );
    const finish = () => {
      clearTimeout(timer);
      if (unlinkCaller) unlinkCaller();
    };

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
    const reader = response.body.getReader();
    const wrappedBody = new ReadableStream<Uint8Array>({
      async pull(ctrl) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            finish();
            ctrl.close();
          } else {
            ctrl.enqueue(value);
          }
        } catch (err) {
          finish();
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

